const fs = require("node:fs");
const path = require("node:path");
const assert = require("node:assert/strict");
const { chromium } = require("playwright");
const root = path.resolve(__dirname, "..");
const config = JSON.parse(
  fs.readFileSync(
    process.env.FORGE_CONFIG ||
      path.resolve(root, "../forge-tenant-api/.local/deployment.json"),
    "utf8",
  ),
);
const base = config.publicURL;
(async () => {
  const browser = await chromium.launch({
    executablePath:
      process.env.CHROME_EXECUTABLE ||
      (process.platform === "darwin"
        ? "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome"
        : undefined),
    headless: true,
    args: ["--no-proxy-server"],
  });
  const context = await browser.newContext();
  let passwordSubmissions = 0;
  context.on("request", (r) => {
    if (
      new URL(r.url()).pathname === "/api/login" &&
      r.method() === "POST" &&
      r.postDataJSON()?.password
    )
      passwordSubmissions++;
  });
  try {
    const page = await context.newPage();
    await page.goto(base);
    await page.locator("#username").fill(config.adminUsername);
    await page.locator("#password").fill(config.adminPassword);
    await page.locator("#submit").click();
    await page.waitForURL((u) => u.pathname === "/");
    async function get(uri) {
      const r = await context.request.get(base + uri);
      assert.equal(r.status(), 200, uri);
      return r.json();
    }
    const me = (await get("/api/v1/me")).user;
    let selected;
    for (const tenant of (await get("/api/v1/tenants")).items) {
      const snapshot = await get("/api/v1/tenants/" + tenant.id);
      for (const project of snapshot.projects) {
        const prefix = `/api/v1/tenants/${tenant.id}/projects/${project.id}/tasks`;
        const response = await context.request.get(base + prefix);
        if (response.status() === 404) continue;
        assert.equal(response.status(), 200);
        const task = (await response.json()).items.find((t) =>
          process.env.SSO_TASK_ID
            ? t.id === process.env.SSO_TASK_ID
            : t.mrIid > 0,
        );
        if (task) {
          selected = {
            tenant,
            project,
            task,
            detail: await get(prefix + "/" + task.id),
            gitlabId: snapshot.members.find((m) => m.user_id === me.id)
              ?.gitlab_id,
          };
          break;
        }
      }
      if (selected) break;
    }
    assert.ok(
      selected,
      "An existing accessible task matching the test selection is required",
    );
    const { tenant, project, task, detail, gitlabId } = selected;
    const tenantLoaded = page.waitForResponse(
      (r) => new URL(r.url()).pathname === `/api/v1/tenants/${tenant.id}`,
    );
    await page.locator("#tenant-switch").selectOption(tenant.id);
    await tenantLoaded;
    await page.goto(`${base}/#task/${tenant.id}/${project.id}/${task.id}`);
    const targetKind = process.env.SSO_EXPECT_TARGET || "mergeRequest";
    assert.equal(detail.gitlabTarget, targetKind);
    const link = page.getByRole("link", {
      name: {
        mergeRequest: "打开 GitLab MR",
        branch: "打开工作分支",
        project: "打开 GitLab 项目",
      }[targetKind],
      exact: true,
    });
    if (targetKind === "project") {
      await page
        .getByText("工作分支尚未发布到 GitLab，当前可查看项目。", {
          exact: true,
        })
        .waitFor();
      assert.ok(!detail.gitlabUrl.includes("/-/tree/"));
      assert.equal(
        await page
          .getByRole("link", { name: "打开工作分支", exact: true })
          .count(),
        0,
      );
    }
    await link.waitFor();
    assert.equal(await link.getAttribute("href"), detail.gitlabUrl);
    const evidence = path.join(root, ".local/sso-evidence");
    fs.mkdirSync(evidence, { recursive: true });
    await page.screenshot({
      path: path.join(evidence, `forge-${targetKind}.png`),
      fullPage: true,
    });
    const popupPromise = context.waitForEvent("page");
    await link.click();
    const gitlabPage = await popupPromise;
    await gitlabPage.waitForURL(detail.gitlabUrl, { timeout: 45000 });
    await gitlabPage
      .locator('meta[name="csrf-token"]')
      .waitFor({ state: "attached" });
    const user = await gitlabPage.evaluate(async () => {
      const r = await fetch("/api/v4/user", {
        headers: {
          "X-CSRF-Token": document.querySelector('meta[name="csrf-token"]')
            .content,
        },
      });
      return { status: r.status, body: await r.json() };
    });
    assert.equal(user.status, 200);
    assert.equal(
      user.body.id,
      gitlabId,
      "GitLab must match the Forge identity",
    );
    assert.equal(
      passwordSubmissions,
      1,
      "Credentials must only be submitted once at Forge",
    );
    await gitlabPage.reload();
    assert.equal(gitlabPage.url(), detail.gitlabUrl);
    const cookies = await context.cookies(base);
    const identity = cookies.find((c) => c.name === "forge_identity");
    assert.ok(identity?.httpOnly && identity.sameSite === "Lax");
    await gitlabPage.screenshot({
      path: path.join(evidence, `gitlab-${targetKind}.png`),
      fullPage: true,
    });
    // A separate anonymous browser must still require authentication.
    const anonymous = await browser.newContext();
    const anonPage = await anonymous.newPage();
    await anonPage.goto(detail.gitlabUrl);
    await anonPage.locator("#username").waitFor();
    assert.equal(new URL(anonPage.url()).origin, new URL(base).origin);
    await anonymous.close();
    const session = await get("/api/v1/me");
    const logout = await context.request.post(base + "/auth/logout", {
      headers: { Origin: base, "X-CSRF-Token": session.csrf_token },
    });
    assert.equal(logout.status(), 200);
    assert.ok(
      !(await context.cookies(base)).some((c) =>
        ["forge_identity", "forge_session"].includes(c.name),
      ),
    );
    await page.goto(base + "/auth/login");
    await page.locator("#username").waitFor();
    assert.equal(await page.locator("#username").inputValue(), "");
    // A stale identity cookie must return to the login form, not redirect in a loop.
    await context.addCookies([
      {
        name: "forge_identity",
        value: "expired-session",
        url: base,
        httpOnly: true,
        sameSite: "Lax",
      },
    ]);
    await page.goto(base + "/auth/login");
    await page.locator("#submit:not([disabled])").waitFor();
    assert.ok((await page.locator("#status").textContent()).includes("已过期"));
    const result = {
      passed: true,
      passwordSubmissions,
      taskId: task.id,
      gitlabTarget: targetKind,
      mrIid: task.mrIid,
      gitlabUserId: gitlabId,
      checks: [
        `Forge 登录一次后点击任务的 ${targetKind} 链接，直接进入对应资源`,
        "GitLab 用户 ID 与 Forge 绑定身份一致",
        "刷新 GitLab 页面保持登录",
        "匿名访问仍要求企业登录",
        "退出 Forge 清除应用与身份 Cookie",
        "过期身份会话回到登录表单",
        "普通浏览器配置，无自定义 DNS 或证书例外",
      ],
    };
    fs.writeFileSync(
      path.join(evidence, `result-${targetKind}.json`),
      JSON.stringify(result, null, 2),
    );
    console.log(JSON.stringify(result, null, 2));
  } catch (e) {
    console.error(
      String(e.stack)
        .replace(
          /(cookie|authorization|private-token):[^\n]*/gi,
          "$1: [redacted]",
        )
        .replace(/https?:\/\/\S+/g, "[URL]")
        .replace(/[a-f0-9]{32,}/g, "[redacted]"),
    );
    process.exitCode = 1;
  } finally {
    await browser.close();
  }
})();
