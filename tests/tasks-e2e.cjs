const fs = require("fs"),
  assert = require("assert/strict"),
  { chromium } = require("playwright");
const cfg = JSON.parse(
    fs.readFileSync(
      process.env.FORGE_CONFIG || "../forge-tenant-api/.local/deployment.json",
    ),
  ),
  pilot = JSON.parse(
    fs.readFileSync(process.env.TASK_PILOT_CONFIG || ".local/task-pilot.json"),
  ),
  base = cfg.publicURL,
  evidence = ".local/task-evidence";
fs.mkdirSync(evidence, { recursive: true });
(async () => {
  const browser = await chromium.launch({
    executablePath:
      "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome",
    headless: true,
    args: [
      "--no-proxy-server",
      "--host-resolver-rules=MAP identity.tenant-lab.svc.cluster.local 127.0.0.1",
    ],
  });
  let page;
  try {
    const ctx = await browser.newContext({
      viewport: { width: 1440, height: 1100 },
    });
    page = await ctx.newPage();
    const errors = [],
      checks = [];
    page.on("pageerror", (e) => errors.push(e.message));
    await page.goto(base);
    await page.locator("#username").fill(cfg.adminUsername);
    await page.locator("#password").fill(cfg.adminPassword);
    await page.locator("#submit").click();
    await page.waitForURL((u) => u.pathname === "/", { timeout: 45000 });
    async function api(method, url, body) {
      const me = await (await ctx.request.get(base + "/api/v1/me")).json();
      const r = await ctx.request.fetch(base + url, {
        method,
        headers: { Origin: base, "X-CSRF-Token": me.csrf_token },
        ...(body ? { data: body } : {}),
      });
      const v = await r.json();
      if (!r.ok()) throw Error("API " + r.status() + " " + JSON.stringify(v));
      return v;
    }
    const detail = () => api("GET", pilot.path);
    async function until(test, label, timeout = 90000) {
      const end = Date.now() + timeout;
      while (Date.now() < end) {
        const d = await detail();
        if (test(d)) return d;
        await new Promise((r) => setTimeout(r, 700));
      }
      throw Error("Timeout: " + label);
    }
    async function open() {
      await page.goto(base + "/tasks");
      await page.locator("#tenant").selectOption(pilot.tenantId);
      await page.locator(`[data-open="${pilot.taskId}"]`).waitFor();
      await page.locator(`[data-open="${pilot.taskId}"]`).click();
      await page
        .locator('[data-action="Resume"], [data-action="Intervene"]')
        .first()
        .waitFor();
    }
    async function action(kind, text) {
      await page.locator('[data-action="' + kind + '"]').click();
      if (text) await page.locator('#dialog textarea[name="text"]').fill(text);
      await page.locator('#dialog button[type="submit"]').click();
      await page
        .locator("#dialog")
        .waitFor({ state: "hidden", timeout: 30000 });
    }
    await open();
    let d = await detail();
    if (d.task.control === "Agent" && !d.task.activeRun) {
      await action("Intervene");
      d = await detail();
    }
    assert.equal(d.task.synthetic, true);
    assert.equal(d.task.control, "Human");
    assert.equal(d.task.mrIid, 1);
    let startHead = d.task.head;
    checks.push("真实身份与项目授权进入持久化任务，关联既有 MR !1");
    const synced = page.waitForResponse(
      (r) =>
        r.request().method() === "POST" &&
        new URL(r.url()).pathname.endsWith("/sync"),
    );
    await page.locator('[data-action="sync"]').click();
    await synced;
    await page.locator("#refresh").click();
    await page.locator('[data-tab="comments"]').click();
    await page
      .getByText(/storagepath.go:69/)
      .first()
      .waitFor();
    d = await detail();
    assert.ok(
      d.task.discussions.some((x) =>
        x.notes.some(
          (n) => n.position?.new_line === 69 && n.position?.head_sha,
        ),
      ),
    );
    checks.push(
      "真实 GitLab 行评论保留文件、行号和 commit，历史讨论未自动执行",
    );
    d = await detail();
    startHead = d.task.head;
    await page.locator('[data-tab="checks"]').click();
    await action("Approve");
    d = await detail();
    assert.equal(d.task.approvalHead, d.task.head);
    assert.notEqual(d.task.status, "Completed");
    checks.push("人工认可绑定当前代码版本，MR 未合入前任务保持待审查");
    const requirement =
      "保留现有所有实现与测试，仅在 TestSandboxToS3 表驱动用例中新增一条中文路径正常反转测试：/mnt/juicefs-vol-001/目录/文件.txt，挂载根 /mnt，期望 s3://juicefs-vol-001/目录/文件.txt，wantErr=false。不要改其他用例，不修改生产代码。此为 UI 与执行器联调。";
    await page.locator('[data-tab="overview"]').click();
    await action("Resume", requirement);
    d = await until((d) => d.task.status === "Running", "runner claim");
    fs.writeFileSync(evidence + "/running.json", JSON.stringify(d, null, 2));
    await new Promise((r) => setTimeout(r, 2000));
    await page.locator("#refresh").click();
    await action("Intervene");
    d = await until(
      (d) =>
        d.task.control === "Human" && d.task.stopConfirmed && !d.task.activeRun,
      "real child stop",
    );
    assert.equal(d.task.head, startHead);
    assert.equal(d.runs[0].status, "Stopped");
    fs.writeFileSync(evidence + "/stopped.json", JSON.stringify(d, null, 2));
    checks.push(
      "页面人工介入撤销执行权限，真实子进程停止并确认；原分支 commit 保持不变",
    );
    console.log(JSON.stringify({ phase: "human-stop-passed" }));
    await page.reload();
    await page.locator(`[data-open="${pilot.taskId}"]`).waitFor();
    await page.locator(`[data-open="${pilot.taskId}"]`).click();
    await page.locator('[data-action="Resume"]').waitFor();
    d = await detail();
    assert.equal(d.task.control, "Human");
    checks.push("刷新页面从 PostgreSQL 恢复人工控制状态，不自动恢复执行");
    await action("Resume", requirement);
    d = await until(
      (d) => !d.task.activeRun && ["Review", "Failed"].includes(d.task.status),
      "model repair and publish",
      600000,
    );
    fs.writeFileSync(evidence + "/result.json", JSON.stringify(d, null, 2));
    assert.equal(d.task.checks, "Passed", JSON.stringify(d.runs[0].output));
    assert.notEqual(d.task.head, startHead);
    assert.equal(d.task.checkedHead, d.task.head);
    assert.equal(d.task.mrIid, 1);
    assert.equal(d.task.status, "Review");
    assert.equal(d.task.approvalHead, "");
    checks.push(
      "显式恢复后实际调用 Ollama、执行测试与 vet、更新同一 MR，检查绑定新 commit，旧认可失效",
    );
    await page.locator("#refresh").click();
    await page.locator('[data-tab="checks"]').click();
    await page.screenshot({ path: evidence + "/desktop.png", fullPage: true });
    for (const width of [375, 768, 1024, 1440]) {
      await page.setViewportSize({ width, height: 1000 });
      assert.equal(
        await page.evaluate(
          () => document.documentElement.scrollWidth > innerWidth,
        ),
        false,
        "overflow " + width,
      );
      if (width === 375)
        await page.screenshot({
          path: evidence + "/mobile.png",
          fullPage: true,
        });
    }
    assert.deepEqual(errors, []);
    checks.push("375、768、1024、1440 宽度无页面横向溢出和脚本异常");
    await page.setViewportSize({ width: 1440, height: 1100 });
    await page.locator('[data-tab="overview"]').click();
    await page.locator('[data-action="Intervene"]').click();
    await page.keyboard.press("Escape");
    await page.locator("#dialog").waitFor({ state: "hidden" });
    assert.equal(
      await page
        .locator('[data-action="Intervene"]')
        .evaluate((e) => e === document.activeElement),
      true,
    );
    checks.push("原生弹窗 Escape 关闭后焦点回到发起按钮");
    // Leave the trial ready for the user to inspect and edit.
    await action("Intervene");
    d = await detail();
    assert.equal(d.task.control, "Human");
    assert.equal(d.task.checks, "Passed");
    fs.writeFileSync(
      evidence + "/e2e.json",
      JSON.stringify(
        {
          passed: true,
          checks,
          taskId: pilot.taskId,
          head: d.task.head,
          realBugCount: 0,
          synthetic: true,
          mrMerged: false,
        },
        null,
        2,
      ),
    );
    console.log(
      JSON.stringify({ passed: true, checks, head: d.task.head }, null, 2),
    );
  } catch (e) {
    if (page)
      await page
        .screenshot({ path: evidence + "/failure.png", fullPage: true })
        .catch(() => {});
    console.error(
      e.message
        .replaceAll(cfg.serviceToken, "[REDACTED]")
        .replace(/forge_session=[^\s]+/g, "forge_session=[REDACTED]")
        .replace(/https?:\/\/\S+/g, "[URL]"),
    );
    process.exitCode = 1;
  } finally {
    await browser.close();
  }
})();
