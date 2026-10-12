const fs = require("node:fs");
const path = require("node:path");
const assert = require("node:assert/strict");
const { execFileSync } = require("node:child_process");
const { chromium } = require("playwright");
const root = path.resolve(__dirname, "..");
const privateConfig = JSON.parse(
  fs.readFileSync(
    process.env.FORGE_CONFIG ||
      path.resolve(root, "../forge-tenant-api/.local/deployment.json"),
    "utf8",
  ),
);
const lab = JSON.parse(fs.readFileSync(process.env.LAB_CONFIG, "utf8"));
const base = privateConfig.publicURL,
  gl = process.env.GITLAB_TEST_URL || "http://127.0.0.1:18080";
const evidence = path.join(root, ".local/evidence");
fs.mkdirSync(evidence, { recursive: true });
const suffix = Date.now().toString(36),
  email = `forge-${suffix}@example.test`,
  password = require("crypto").randomBytes(24).toString("base64url");
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
  const admin = await browser.newContext({
      viewport: { width: 1440, height: 1000 },
    }),
    member = await browser.newContext({
      viewport: { width: 1280, height: 900 },
    });
  const page = await admin.newPage(),
    memberPage = await member.newPage();
  const checks = [];
  let paused = false;
  const errors = [];
  page.on("pageerror", (e) => errors.push(e.message));
  memberPage.on("pageerror", (e) => errors.push(e.message));
  const button = (name, scope = page) =>
    scope.getByRole("button", { name, exact: true });
  const modal = () => page.locator("#dialog");
  const field = (n) => modal().locator(`[name="${n}"]`);
  async function login(p, username, pw) {
    await p.goto(base);
    await p.locator("#username").fill(username);
    await p.locator("#password").fill(pw);
    await p.locator("#submit").click();
    await p.waitForURL((u) => u.pathname === "/", { timeout: 30000 });
    await p.locator("#operator-name").filter({ hasText: /\S/ }).waitFor();
  }
  async function api(ctx, method, url, body, expected = 200, custom = {}) {
    let csrf = "";
    if (method !== "GET") {
      const m = await ctx.request.get(base + "/api/v1/me");
      if (m.ok()) csrf = (await m.json()).csrf_token;
    }
    const options = {
      method,
      headers: {
        Origin: base,
        "X-CSRF-Token": csrf,
        "Idempotency-Key": require("crypto").randomUUID(),
        ...custom,
      },
    };
    if (body !== undefined) options.data = body;
    const response = await ctx.request.fetch(base + url, options);
    const value = await response.json();
    assert.equal(
      response.status(),
      expected,
      `${method} ${url}: ${value.error?.code || "unexpected status"}`,
    );
    return value;
  }
  async function snap(tid) {
    return api(admin, "GET", "/api/v1/tenants/" + tid);
  }
  async function change(tid, method, tail, body = {}, expected = 202) {
    const current = await snap(tid);
    return api(
      admin,
      method,
      `${method === "PATCH" && !tail ? "/api/v1/platform/tenants" : "/api/v1/tenants"}/${tid}${tail}`,
      body,
      expected,
      {
        "If-Match": String(current.tenant.version),
      },
    );
  }
  async function sync(tid, want = "succeeded") {
    const end = Date.now() + 90000;
    while (Date.now() < end) {
      const s = await snap(tid),
        op = s.operations.find((o) => o.version === s.tenant.version);
      if (op?.status === want) return s;
      if (["failed", "conflict"].includes(op?.status) && op.status !== want)
        throw new Error(`sync ${op.status}: ${op.error_code}`);
      await new Promise((r) => setTimeout(r, 350));
    }
    throw new Error("sync deadline exceeded");
  }
  async function git(method, uri, data, expected = 200) {
    const r = await admin.request.fetch(gl + "/api/v4" + uri, {
      method,
      headers: { "PRIVATE-TOKEN": lab.gitlabToken },
      ...(data ? { data } : {}),
    });
    assert.equal(r.status(), expected, `GitLab ${method} ${uri}`);
    return expected === 204 || expected === 404 ? null : r.json();
  }
  function worker(replicas) {
    execFileSync(
      "helm",
      [
        "upgrade",
        "forge-tenant",
        path.resolve(
          process.env.FORGE_API_ROOT || path.join(root, "../forge-tenant-api"),
          "charts/forge-tenant",
        ),
        "--kube-context",
        "orbstack",
        "--namespace",
        process.env.FORGE_NAMESPACE || "forge-tenant-split",
        "--reuse-values",
        "--set",
        `worker.replicas=${replicas}`,
        "--wait",
        "--timeout",
        "90s",
      ],
      { stdio: "pipe" },
    );
    paused = replicas === 0;
  }
  try {
    await login(page, privateConfig.adminUsername, privateConfig.adminPassword);
    checks.push("真实 OIDC 授权码、PKCE 和服务端会话登录");
    const me = (await api(admin, "GET", "/api/v1/me")).user;
    await button("平台管理 ↗").click();
    await button("创建租户").click();
    await field("name").fill("Forge 研发示例");
    await field("slug").fill("forge-a-" + suffix);
    await field("admin_user_id").selectOption(me.id);
    await button("创建租户", modal()).click();
    await modal().waitFor({ state: "hidden" });
    const tenants = (await api(admin, "GET", "/api/v1/tenants")).items;
    const tid = tenants.find((t) => t.slug === "forge-a-" + suffix).id;
    await sync(tid);
    await page
      .locator("tr")
      .filter({ hasText: "forge-a-" + suffix })
      .getByRole("button", { name: "进入工作区" })
      .click();
    await button("成员与团队").click();
    await button("邀请成员").click();
    await field("name").fill("联调工程师");
    await field("email").fill(email);
    await button("创建邀请", modal()).click();
    await page.locator("#invite-link").waitFor();
    const invitation = await page.locator("#invite-link").inputValue();
    await button("关闭弹窗", modal()).click();
    await memberPage.goto(invitation);
    await memberPage.locator("#password").fill(password);
    const acceptedPromise = memberPage.waitForResponse(
      (r) => new URL(r.url()).pathname === "/api/v1/invitations/accept",
    );
    await memberPage.locator("#accept").click();
    const accepted = await (await acceptedPromise).json();
    assert.equal(accepted.accepted, true);
    const username = accepted.username;
    await login(memberPage, username, password);
    let s = await sync(tid);
    const m = s.members.find((m) => m.email === email);
    assert.ok(m.gitlab_id);
    checks.push("新成员接受一次性邀请，真实创建 Casdoor 与 GitLab 绑定账号");
    await api(
      member,
      "POST",
      "/api/v1/invitations/accept",
      { token: new URL(invitation).hash.slice(1) },
      410,
    );
    await page.goto(base + "#spaces");
    await page.reload();
    await button("接入项目").first().click();
    await field("name").fill("订单服务");
    await field("path").fill("order-service");
    await button("接入项目", modal()).click();
    await modal().waitFor({ state: "hidden" });
    s = await sync(tid);
    const p = s.projects[0];
    assert.ok(p.gitlab_id);
    await button("刷新数据").click();
    await page.goto(base + "#project/" + p.id + "/members");
    await button("添加项目成员").click();
    await field("member").selectOption(m.id);
    await field("role").selectOption("developer");
    await modal().locator("[type=submit]").click();
    await modal().waitFor({ state: "hidden" });
    await sync(tid);
    assert.equal(
      (await git("GET", `/projects/${p.gitlab_id}/members/all/${m.gitlab_id}`))
        .access_level,
      30,
    );
    assert.equal(
      (
        await api(
          member,
          "GET",
          `/api/v1/tenants/${tid}/projects/${p.id}/access`,
        )
      ).write,
      true,
    );
    assert.equal(
      (
        await api(
          admin,
          "GET",
          `/api/v1/tenants/${tid}/projects/${p.id}/access`,
        )
      ).allowed,
      false,
    );
    checks.push("自有 UI 创建项目并授予 Developer，运营角色无隐式代码权限");
    await button("角色与权限").click();
    await page.getByRole("heading", { name: "开发者", exact: true }).waitFor();
    await button("成员与团队").click();
    await page
      .locator("tr")
      .filter({ hasText: email })
      .getByRole("button", { name: "查看权限" })
      .click();
    await modal().getByText("当前有效：开发者", { exact: true }).waitFor();
    await button("关闭弹窗", modal()).click();
    await button("团队").click();
    await button("创建团队").click();
    await field("name").fill("研发团队");
    await modal().locator("[type=submit]").click();
    await modal().waitFor({ state: "hidden" });
    s = await sync(tid);
    const devTeam = s.teams.find((t) => t.name === "研发团队");
    await page
      .locator("tr")
      .filter({ hasText: "研发团队" })
      .getByRole("button", { name: "查看成员" })
      .click();
    await button("添加团队成员").click();
    await field("member").selectOption(m.id);
    await modal().locator("[type=submit]").click();
    await modal().waitFor({ state: "hidden" });
    await sync(tid);
    await page.goto(base + "#project/" + p.id + "/members");
    await button("分配团队角色").click();
    await field("team").selectOption(devTeam.id);
    await field("role").selectOption("admin");
    await modal().locator("[type=submit]").click();
    await modal().waitFor({ state: "hidden" });
    await sync(tid);
    const qaTeam = await change(tid, "POST", "/teams", { name: "质量团队" });
    await change(tid, "PUT", `/teams/${qaTeam.team_id}/members/${m.id}`);
    await change(
      tid,
      "PUT",
      `/projects/${p.id}/team-grants/${qaTeam.team_id}`,
      { role: "reviewer" },
    );
    await sync(tid);
    let report = await api(
      member,
      "GET",
      `/api/v1/tenants/${tid}/permissions/me`,
    );
    assert.equal(report.teams.length, 2);
    assert.equal(report.projects[0].sources.length, 3);
    assert.equal(report.projects[0].effectiveRole, "admin");
    assert.equal(
      (await git("GET", `/projects/${p.gitlab_id}/members/all/${m.gitlab_id}`))
        .access_level,
      40,
    );
    await memberPage.goto(base + "#my-permissions");
    await memberPage
      .getByText("当前有效：项目管理员", { exact: true })
      .waitFor();
    await memberPage
      .getByText("团队 · 研发团队 → 项目管理员", { exact: true })
      .waitFor();
    await memberPage.screenshot({
      path: path.join(evidence, "my-permissions.png"),
      fullPage: true,
    });
    await api(
      member,
      "GET",
      `/api/v1/tenants/${tid}/members/${s.members.find((x) => x.user_id === me.id).id}/permissions`,
      undefined,
      404,
    );
    await change(tid, "DELETE", `/projects/${p.id}/grants/${m.id}`);
    report = await api(member, "GET", `/api/v1/tenants/${tid}/permissions/me`);
    assert.equal(report.projects[0].effectiveRole, "admin");
    assert.equal(report.projects[0].sources.length, 2);
    await change(tid, "DELETE", `/teams/${devTeam.id}/members/${m.id}`);
    assert.equal(
      (
        await api(
          member,
          "GET",
          `/api/v1/tenants/${tid}/projects/${p.id}/access`,
        )
      ).write,
      false,
    );
    await sync(tid);
    assert.equal(
      (await git("GET", `/projects/${p.gitlab_id}/members/all/${m.gitlab_id}`))
        .access_level,
      20,
    );
    report = await api(member, "GET", `/api/v1/tenants/${tid}/permissions/me`);
    assert.equal(report.projects[0].sources.length, 1);
    assert.equal(report.projects[0].sources[0].name, "质量团队");
    await change(tid, "PUT", `/projects/${p.id}/grants/${m.id}`, {
      role: "developer",
    });
    await sync(tid);
    checks.push(
      "真实团队成员 UI、项目团队角色、个人权限与来源展示；成员不可查看他人权限",
    );
    checks.push(
      "双团队与直接角色叠加；撤销单一来源保留其他授权，移出团队立即降权并同步 GitLab",
    );
    const second = await api(
      admin,
      "POST",
      "/api/v1/platform/tenants",
      {
        name: "跨企业协作示例",
        slug: "forge-b-" + suffix,
        admin_user_id: me.id,
      },
      202,
    );
    const tid2 = second.tenant_id;
    await api(member, "GET", "/api/v1/tenants/" + tid2, undefined, 404);
    await api(
      member,
      "POST",
      `/api/v1/tenants/${tid}/teams`,
      { name: "越权创建" },
      404,
      { "If-Match": String((await snap(tid)).tenant.version) },
    );
    const inv2 = await change(tid2, "POST", "/members", {
        name: "联调工程师",
        email,
        role: "member",
      }),
      token2 = new URL(inv2.invitation_url).hash.slice(1);
    await api(
      admin,
      "POST",
      "/api/v1/invitations/accept",
      { token: token2 },
      403,
    );
    await api(
      member,
      "POST",
      "/api/v1/invitations/accept",
      { token: token2 },
      202,
    );
    const p2res = await change(tid2, "POST", "/projects", {
      name: "数据服务",
      path: "data-service",
      mode: "create",
    });
    let s2 = await sync(tid2);
    const p2 = s2.projects.find((p) => p.id === p2res.project_id),
      m2 = s2.members.find((m) => m.email === email);
    assert.equal(m.gitlab_id, m2.gitlab_id);
    await change(tid2, "PUT", `/projects/${p2.id}/grants/${m2.id}`, {
      role: "reviewer",
    });
    await sync(tid2);
    assert.equal(
      (await git("GET", `/projects/${p2.gitlab_id}/members/all/${m.gitlab_id}`))
        .access_level,
      20,
    );
    checks.push("同一统一账号跨企业复用；未加入的企业不可读取或修改");
    worker(0);
    await change(tid, "PUT", `/projects/${p.id}/grants/${m.id}`, {
      role: "reviewer",
    });
    assert.equal(
      (
        await api(
          member,
          "GET",
          `/api/v1/tenants/${tid}/projects/${p.id}/access`,
        )
      ).write,
      false,
    );
    assert.equal(
      (await git("GET", `/projects/${p.gitlab_id}/members/all/${m.gitlab_id}`))
        .access_level,
      30,
    );
    await change(tid, "PUT", `/projects/${p.id}/grants/${m.id}`, {
      role: "developer",
    });
    assert.equal(
      (
        await api(
          member,
          "GET",
          `/api/v1/tenants/${tid}/projects/${p.id}/access`,
        )
      ).write,
      false,
    );
    assert.equal((await snap(tid)).operations[0].status, "pending");
    worker(1);
    await sync(tid);
    assert.equal(
      (
        await api(
          member,
          "GET",
          `/api/v1/tenants/${tid}/projects/${p.id}/access`,
        )
      ).write,
      true,
    );
    checks.push(
      "Worker 停止期间本地降级立即生效；重启恢复持久化任务，升级等待当前版本确认",
    );
    s = await snap(tid);
    await git(
      "POST",
      `/groups/${s.tenant.gitlab_id}/members`,
      { user_id: m.gitlab_id, access_level: 30 },
      201,
    );
    await change(tid, "DELETE", `/members/${m.id}`);
    assert.equal(
      (
        await api(
          member,
          "GET",
          `/api/v1/tenants/${tid}/projects/${p.id}/access`,
        )
      ).allowed,
      false,
    );
    s = await sync(tid, "conflict");
    assert.equal(
      s.operations[0].error_code,
      "gitlab_EFFECTIVE_PERMISSION_CONFLICT",
    );
    await git(
      "DELETE",
      `/groups/${s.tenant.gitlab_id}/members/${m.gitlab_id}`,
      undefined,
      204,
    );
    await change(tid, "POST", `/operations/${s.operations[0].id}/retry`);
    await sync(tid);
    await git(
      "GET",
      `/projects/${p.gitlab_id}/members/all/${m.gitlab_id}`,
      undefined,
      404,
    );
    assert.equal(
      (await git("GET", `/projects/${p2.gitlab_id}/members/all/${m.gitlab_id}`))
        .access_level,
      20,
    );
    assert.equal((await git("GET", `/users/${m.gitlab_id}`)).state, "active");
    checks.push(
      "真实继承权限导致撤权冲突；修复后重试成功，另一企业授权和账号保留",
    );
    await change(tid2, "PATCH", "", { status: "suspended" });
    assert.equal(
      (
        await api(
          member,
          "GET",
          `/api/v1/tenants/${tid2}/projects/${p2.id}/access`,
        )
      ).allowed,
      false,
    );
    await sync(tid2);
    await git(
      "GET",
      `/projects/${p2.gitlab_id}/members/all/${m.gitlab_id}`,
      undefined,
      404,
    );
    await change(tid2, "PATCH", "", { status: "active" });
    await sync(tid2);
    assert.equal(
      (await git("GET", `/projects/${p2.gitlab_id}/members/all/${m.gitlab_id}`))
        .access_level,
      20,
    );
    checks.push("企业停用撤销实际 GitLab 项目授权；启用重新核验目标权限");
    const snapshot = await snap(tid2),
      key = require("crypto").randomUUID(),
      headers = {
        "If-Match": String(snapshot.tenant.version),
        "Idempotency-Key": key,
      };
    const team = await api(
      admin,
      "POST",
      `/api/v1/tenants/${tid2}/teams`,
      { name: "平台研发" },
      202,
      headers,
    );
    const replay = await api(
      admin,
      "POST",
      `/api/v1/tenants/${tid2}/teams`,
      { name: "平台研发" },
      202,
      headers,
    );
    assert.equal(team.team_id, replay.team_id);
    assert.equal(team.operation_id, replay.operation_id);
    await api(
      admin,
      "POST",
      `/api/v1/tenants/${tid2}/teams`,
      { name: "不同内容" },
      409,
      headers,
    );
    const csrfResponse = await admin.request.post(
      base + "/api/v1/platform/tenants",
      {
        data: { name: "bad", slug: "bad" },
        headers: { Origin: "https://untrusted.test" },
      },
    );
    assert.equal(csrfResponse.status(), 403);
    checks.push("真实服务重复请求复用结果；请求内容冲突与 CSRF 被拒绝");
    // Same browser session as Forge; never enter credentials on the GitLab path.
    const gp = await member.newPage();
    const gitlabProject = await git("GET", `/projects/${p2.gitlab_id}`);
    const target = gl + "/" + gitlabProject.path_with_namespace;
    await gp.goto(target);
    await gp.waitForURL((u) => u.href === target, { timeout: 45000 });
    await gp.locator('meta[name="csrf-token"]').waitFor({ state: "attached" });
    const gitlabMe = await gp.evaluate(async () => {
      const csrf = document.querySelector('meta[name="csrf-token"]')?.content;
      const r = await fetch("/api/v4/user", {
        headers: { "X-CSRF-Token": csrf || "" },
      });
      return r.json();
    });
    assert.equal(gitlabMe.id, m.gitlab_id);
    await gp.screenshot({
      path: path.join(evidence, "gitlab-real-user.png"),
      fullPage: true,
    });
    await gp.close();
    checks.push(
      "Forge 已登录成员直接进入 GitLab 项目，无需再次输入密码，用户 ID 与预配置绑定一致",
    );
    await page.goto(base);
    await page.locator("#tenant-switch").selectOption(tid2);
    await page
      .locator("#nav")
      .getByRole("button", { name: "成员与团队", exact: true })
      .click();
    await page.screenshot({
      path: path.join(evidence, "console-desktop.png"),
      fullPage: true,
    });
    const mobilePage = await admin.newPage();
    await mobilePage.setViewportSize({ width: 390, height: 844 });
    await mobilePage.goto(base + "#members");
    await mobilePage.locator("tbody tr").first().waitFor();
    await mobilePage.screenshot({
      path: path.join(evidence, "console-mobile.png"),
      fullPage: true,
    });
    assert.equal(
      await mobilePage.evaluate(
        () => document.documentElement.scrollWidth > innerWidth,
      ),
      false,
    );
    await mobilePage.close();
    assert.deepEqual(errors, []);
    checks.push("真实控制台桌面与移动端无页面级横向溢出或脚本异常");
    const blocked = await admin.request.get(
      base + "/internal/v1/access/events?after=0",
    );
    assert.equal(blocked.status(), 404);
    if (!process.env.FORGE_INTERNAL_URL)
      throw new Error(
        "FORGE_INTERNAL_URL must point to the tenant backend, separate from the public gateway",
      );
    const eventResponse = await admin.request.get(
      process.env.FORGE_INTERNAL_URL + "/internal/v1/access/events?after=0",
      { headers: { Authorization: "Bearer " + privateConfig.serviceToken } },
    );
    assert.equal(eventResponse.status(), 200);
    assert.ok(
      (await eventResponse.json()).items.some(
        (e) => e.reason === "remove_member",
      ),
    );
    checks.push("Coding Agent 服务接口能读取持久化撤权事件");
    fs.writeFileSync(
      path.join(evidence, "e2e.json"),
      JSON.stringify(
        {
          passed: true,
          checks,
          tenant_ids: [tid, tid2],
          project_ids: [p.gitlab_id, p2.gitlab_id],
          gitlab_user_id: m.gitlab_id,
          scope: "真实 PostgreSQL / Casdoor / GitLab CE；未连接 Agent 执行器",
          gitlabBrowserUsesLabCAException: false,
        },
        null,
        2,
      ),
    );
    fs.writeFileSync(
      path.join(root, ".local/e2e-account.json"),
      JSON.stringify(
        { username, password, email, tenant_ids: [tid, tid2] },
        null,
        2,
      ),
      { mode: 0o600 },
    );
    console.log(JSON.stringify({ passed: true, checks }, null, 2));
  } catch (e) {
    await page
      .screenshot({ path: path.join(evidence, "failure.png"), fullPage: true })
      .catch(() => {});
    let safe = String(e.stack);
    for (const v of [...Object.values(privateConfig), ...Object.values(lab)])
      if (typeof v === "string" && v.length >= 12)
        safe = safe.replaceAll(v, "[redacted]");
    console.error(
      safe
        .replace(/https?:\/\/\S+/g, "[URL]")
        .replace(
          /(cookie|authorization|private-token):[^\n]*/gi,
          "$1: [redacted]",
        )
        .replace(/[a-f0-9]{32,}/g, "[redacted]"),
    );
    process.exitCode = 1;
  } finally {
    if (paused) {
      try {
        worker(1);
      } catch {
        console.error("Restore worker with Helm required");
        process.exitCode = 1;
      }
    }
    await browser.close();
  }
})();
