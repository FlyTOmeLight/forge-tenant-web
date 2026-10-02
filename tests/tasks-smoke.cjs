const fs = require("node:fs"),
  path = require("node:path"),
  assert = require("node:assert/strict"),
  { chromium } = require("playwright");
const root = path.resolve(__dirname, ".."),
  cfg = JSON.parse(
    fs.readFileSync(
      process.env.FORGE_CONFIG ||
        path.resolve(root, "../forge-tenant-api/.local/deployment.json"),
    ),
  ),
  lab = JSON.parse(fs.readFileSync(process.env.LAB_CONFIG)),
  prior = JSON.parse(
    fs.readFileSync(path.join(root, ".local/evidence/e2e.json")),
  ),
  base = cfg.publicURL,
  gl = process.env.GITLAB_TEST_URL || "http://127.0.0.1:8181";
(async () => {
  const browser = await chromium.launch({
    headless: true,
    executablePath:
      process.env.CHROME_EXECUTABLE ||
      (process.platform === "darwin"
        ? "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome"
        : undefined),
    args: ["--no-proxy-server"],
  });
  const ctx = await browser.newContext({
      viewport: { width: 1440, height: 1000 },
    }),
    p = await ctx.newPage(),
    errors = [],
    checks = [];
  p.on("pageerror", (e) => errors.push(e.message));
  try {
    await p.goto(base);
    await p.locator("#username").fill(cfg.adminUsername);
    await p.locator("#password").fill(cfg.adminPassword);
    await p.locator("#submit").click();
    await p.waitForURL((u) => u.pathname === "/");
    await p.getByRole("heading", { name: "企业管理", exact: true }).waitFor();
    const me = await (await ctx.request.get(base + "/api/v1/me")).json();
    async function api(method, url, body, headers = {}) {
      const r = await ctx.request.fetch(base + url, {
        method,
        headers: {
          Origin: base,
          "X-CSRF-Token": me.csrf_token,
          "Idempotency-Key": require("node:crypto").randomUUID(),
          ...headers,
        },
        ...(body !== undefined ? { data: body } : {}),
      });
      const v = await r.json();
      assert.ok(
        r.ok(),
        `${method} ${url}: ${r.status()} ${v.error?.code || ""}`,
      );
      return v;
    }
    async function git(method, url, body) {
      const r = await ctx.request.fetch(gl + "/api/v4" + url, {
        method,
        headers: { "PRIVATE-TOKEN": lab.gitlabToken },
        ...(body ? { data: body } : {}),
      });
      const v = await r.json();
      assert.ok(r.ok(), `GitLab ${r.status()}`);
      return v;
    }
    const tid = prior.tenant_ids[1];
    let snapshot = await api("GET", "/api/v1/tenants/" + tid);
    const project = snapshot.projects[0],
      member = snapshot.members.find((m) => m.user_id === me.user.id);
    await api(
      "PUT",
      `/api/v1/tenants/${tid}/projects/${project.id}/grants/${member.id}`,
      { role: "admin" },
      { "If-Match": String(snapshot.tenant.version) },
    );
    const deadline = Date.now() + 90000;
    while (Date.now() < deadline) {
      snapshot = await api("GET", "/api/v1/tenants/" + tid);
      if (
        snapshot.operations.find((o) => o.version === snapshot.tenant.version)
          ?.status === "succeeded"
      )
        break;
      await new Promise((r) => setTimeout(r, 300));
    }
    assert.equal(
      (await api("GET", `/api/v1/tenants/${tid}/projects/${project.id}/access`))
        .write,
      true,
    );
    const remote = await git("GET", `/projects/${project.gitlab_id}`),
      branch = "fix/vue-smoke-" + Date.now().toString(36);
    await git("POST", `/projects/${project.gitlab_id}/repository/commits`, {
      branch,
      start_branch: remote.default_branch,
      commit_message: "Prepare task UI fixture",
      actions: [
        {
          action: "create",
          file_path: "vue-smoke.txt",
          content: "Split verification with Vue\n",
        },
      ],
    });
    const mr = await git(
      "POST",
      `/projects/${project.gitlab_id}/merge_requests`,
      {
        source_branch: branch,
        target_branch: remote.default_branch,
        title: "Vue task UI verification",
      },
    );
    await p.goto(base + "/tasks");
    await p.locator("#tenant").selectOption(tid);
    await p
      .getByRole("button", { name: "关联修复任务", exact: true })
      .waitFor();
    await p.getByRole("button", { name: "关联修复任务", exact: true }).click();
    const dialog = p.locator("#dialog");
    await dialog.locator("[name=title]").fill("Vue 拆分任务验收");
    await dialog.locator("[name=description]").fill("验证新的任务页面交互");
    await dialog
      .locator("[name=criteria]")
      .fill("任务状态持久化，停止确认与操作权限保持一致");
    await dialog.locator("[name=mrIid]").fill(String(mr.iid));
    await dialog.locator("[name=synthetic]").selectOption("true");
    await dialog.locator("[type=submit]").click();
    await dialog.waitFor({ state: "hidden" });
    await p.getByRole("heading", { name: "Vue 拆分任务验收" }).waitFor();
    checks.push("Vue 表单关联真实 GitLab MR，任务与审计持久化");
    const taskPath = `/api/v1/tenants/${tid}/projects/${project.id}/tasks`,
      tasks = (await api("GET", taskPath)).items,
      t = tasks.find((t) => t.mrIid === mr.iid);
    const detail = () => api("GET", taskPath + "/" + t.id);
    async function action(kind, text) {
      await p.locator(`[data-action="${kind}"]`).click();
      if (text) await dialog.locator("[name=text]").fill(text);
      await dialog.locator("[type=submit]").click();
      await dialog.waitFor({ state: "hidden" });
    }
    await p.locator("[data-tab=checks]").click();
    await action("Approve");
    let d = await detail();
    assert.equal(d.task.approvalHead, d.task.head);
    assert.notEqual(d.task.status, "Completed");
    checks.push("人工审查认可绑定当前版本，未提前完成任务");
    await action("Resume", "仅验证队列与控制权，不运行模型");
    d = await detail();
    assert.equal(d.task.control, "Agent");
    assert.equal(d.task.status, "Queued");
    // This is a protocol test client, not a real model executor.
    const run = (
      await api(
        "POST",
        "/internal/v1/tasks/claim",
        {
          worker: "split-ui-protocol-test",
          gitlabProjectId: project.gitlab_id,
        },
        { Authorization: "Bearer " + cfg.serviceToken },
      )
    ).run;
    assert.ok(run);
    await p.locator("#refresh").click();
    await action("Intervene");
    d = await detail();
    assert.equal(d.task.control, "Stopping");
    assert.equal(d.task.stopConfirmed, false);
    await api(
      "POST",
      `/internal/v1/tasks/${t.id}/finish`,
      {
        worker: "split-ui-protocol-test",
        runId: run.id,
        epoch: run.epoch,
        status: "Stopped",
        gitlabProjectId: project.gitlab_id,
        output: { stopConfirmed: true },
      },
      { Authorization: "Bearer " + cfg.serviceToken },
    );
    await p.locator("#refresh").click();
    await p.locator("[data-action=Resume]").waitFor();
    d = await detail();
    assert.equal(d.task.control, "Human");
    assert.equal(d.task.stopConfirmed, true);
    checks.push(
      "Vue 人工介入与后端停止确认协议一致；使用协议测试客户端，未调用模型",
    );
    await p.locator("[data-action=Resume]").click();
    await p.keyboard.press("Escape");
    await dialog.waitFor({ state: "hidden" });
    assert.equal(
      await p
        .locator("[data-action=Resume]")
        .evaluate((el) => el === document.activeElement),
      true,
    );
    for (const width of [375, 768, 1024, 1440]) {
      await p.setViewportSize({ width, height: 1000 });
      await p.reload();
      await p.locator(`[data-open="${t.id}"]`).click();
      await p.locator("[data-tab=checks]").click();
      await p.locator("[data-action=Resume]").waitFor();
      assert.equal(
        await p.evaluate(
          () => document.documentElement.scrollWidth > innerWidth,
        ),
        false,
        `task overflow ${width}`,
      );
      if (width === 375 || width === 1440)
        await p.screenshot({
          path: path.join(root, `.local/evidence/tasks-${width}.png`),
          fullPage: true,
        });
    }
    assert.deepEqual(errors, []);
    checks.push("任务页四档宽度无溢出或脚本异常，弹窗 Escape 恢复焦点");
    fs.writeFileSync(
      path.join(root, ".local/evidence/tasks-smoke.json"),
      JSON.stringify(
        {
          passed: true,
          checks,
          modelExecuted: false,
          gitlab_project_id: project.gitlab_id,
          mr_iid: mr.iid,
          task_id: t.id,
        },
        null,
        2,
      ),
    );
    console.log(JSON.stringify({ passed: true, checks }, null, 2));
  } catch (e) {
    let safe = String(e.stack);
    for (const v of [...Object.values(cfg), ...Object.values(lab)])
      if (typeof v === "string" && v.length >= 12)
        safe = safe.replaceAll(v, "[redacted]");
    console.error(safe.replace(/https?:\/\/\S+/g, "[URL]"));
    await p
      .screenshot({
        path: path.join(root, ".local/evidence/tasks-failure.png"),
        fullPage: true,
      })
      .catch(() => {});
    process.exitCode = 1;
  } finally {
    await browser.close();
  }
})();
