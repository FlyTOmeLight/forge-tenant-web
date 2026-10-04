const fs = require("fs"),
  assert = require("assert/strict"),
  { chromium } = require("playwright");
const cfg = JSON.parse(
    fs.readFileSync(
      process.env.FORGE_CONFIG || "../forge-tenant-api/.local/deployment.json",
    ),
  ),
  pilot = JSON.parse(
    fs.readFileSync(
      process.env.FORGE_TASK_PILOT ||
        "../forge-tenant-api/.local/task-pilot.json",
    ),
  ),
  base = cfg.publicURL,
  dir = ".local/whole-app-evidence";
fs.mkdirSync(dir, { recursive: true });
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
  const ctx = await browser.newContext({
      viewport: { width: 1440, height: 1080 },
    }),
    page = await ctx.newPage(),
    errors = [],
    checks = [];
  page.on("pageerror", (e) => errors.push(e.message));
  try {
    await page.goto(base);
    await page.locator("#username").fill(cfg.adminUsername);
    await page.locator("#password").fill(cfg.adminPassword);
    await page.locator("#submit").click();
    await page.waitForURL((u) => u.pathname === "/", { timeout: 45000 });
    await page.locator("#tenant-switch").selectOption(pilot.tenantId);
    await page.goto(base + "#tasks");
    await page
      .getByRole("heading", { name: "我的任务", exact: true })
      .waitFor();
    async function api(method, path, body) {
      const m = await (await ctx.request.get(base + "/api/v1/me")).json(),
        r = await ctx.request.fetch(base + path, {
          method,
          headers: { Origin: base, "X-CSRF-Token": m.csrf_token },
          ...(body ? { data: body } : {}),
        });
      const d = await r.json();
      if (!r.ok()) throw Error("API " + r.status() + ": " + JSON.stringify(d));
      return d;
    }
    const root =
      "/api/v1/tenants/" + pilot.tenantId + "/projects/" + pilot.projectId;
    await page.goto(base + "#project/" + pilot.projectId + "/execution");
    await page
      .getByRole("heading", { name: /agentic-kit 试点.*执行配置/ })
      .waitFor();
    await page
      .getByRole("button", { name: "编辑执行配置", exact: true })
      .click();
    await page.locator('#dialog [name="baseBranch"]').selectOption("master");
    await page
      .locator('#dialog [name="model"]')
      .selectOption("qwen3.8:27b-mlx");
    await page
      .locator('#dialog [name="allowedPaths"]')
      .fill("internal/pkg/storagepath/");
    await page
      .locator('#dialog [name="checks"]')
      .fill(
        "go test ./internal/pkg/storagepath -count=1\ngo vet ./internal/pkg/storagepath",
      );
    await page.locator('#dialog [type="submit"]').click();
    await page.locator("#dialog").waitFor({ state: "hidden" });
    await page.getByRole("button", { name: "检查接入", exact: true }).click();
    await page
      .getByRole("status")
      .filter({ hasText: "接入检查通过" })
      .waitFor();
    checks.push(
      "真实仓库分支与 Ollama 模型接入复检，项目范围与检查命令保存到 PostgreSQL",
    );
    const existing = process.env.REUSE_TASK_ID;
    if (existing) {
      await page.goto(
        base +
          "#task/" +
          pilot.tenantId +
          "/" +
          pilot.projectId +
          "/" +
          existing,
      );
    } else {
      await page
        .getByRole("button", { name: "新建修复任务", exact: true })
        .click();
      const fields = {
        title: "修复 S3 转沙箱路径中的原始父级目录穿越（联调）",
        description:
          "人工注入故障分支删除了原始路径中 .. 段的拒绝校验，path.Clean 将越界意图掩盖，允许 s3://bucket/../etc 转为挂载目录内路径。",
        reproduce:
          "运行 go test ./internal/pkg/storagepath -count=1；现有 TestS3ToSandbox 的原始父级路径用例失败。",
        criteria:
          "S3ToSandbox 对原始路径包含完整 .. 段时返回错误；已有合法路径与包含 .. 的普通文件名行为保持不变；现有全部测试和 vet 通过。",
        constraints:
          "仅修复 internal/pkg/storagepath/storagepath.go 中的原始路径检查。保留所有已有生产接口和测试，不删除或降低测试断言。无需修改其他文件。",
      };
      for (const [n, v] of Object.entries(fields))
        await page.locator('#dialog [name="' + n + '"]').fill(v);
      await page
        .locator('#dialog [name="baseBranch"]')
        .selectOption("pilot/injected-storagepath");
      await page.locator('#dialog [name="synthetic"]').selectOption("true");
      await page.locator('#dialog [type="submit"]').click();
      await page.locator("#dialog").waitFor({ state: "hidden" });
    }
    await page.getByRole("heading", { name: /原始父级目录穿越/ }).waitFor();
    const id = await page.evaluate(() => location.hash.split("/")[3]),
      path = root + "/tasks/" + id;
    fs.writeFileSync(
      dir + "/new-task.json",
      JSON.stringify({ ...pilot, taskId: id, path }, null, 2),
    );
    let d = await api("GET", path);
    assert.equal(d.task.synthetic, true);
    if (!existing) {
      assert.equal(d.task.mrIid, 0);
      checks.push("完整工作台创建新问题任务，无需预先提供 MR，也不创建空 MR");
    }
    console.log(
      JSON.stringify({ phase: "created", taskId: id, status: d.task.status }),
    );
    const end = Date.now() + 600000;
    while (Date.now() < end) {
      d = await api("GET", path);
      if (!d.task.activeRun && ["Review", "Failed"].includes(d.task.status))
        break;
      await new Promise((r) => setTimeout(r, 1000));
    }
    fs.writeFileSync(dir + "/new-task-result.json", JSON.stringify(d, null, 2));
    assert.equal(d.task.status, "Review", JSON.stringify(d.runs[0]?.output));
    assert.equal(d.task.checks, "Passed");
    assert.equal(d.task.checkedHead, d.task.head);
    assert.ok(d.task.mrIid > 1);
    assert.equal(d.task.approvalHead, "");
    assert.ok(d.runs[0].output.baseline.some((c) => !c.passed));
    assert.ok(
      d.runs[0].output.checks.at(-1).commands.every((c) => c.exitCode === 0),
    );
    assert.ok(d.runs[0].output.judgment.status);
    checks.push(
      "真实故障基线失败，模型按项目范围修复，测试/vet 通过后创建新 Draft MR；Agent 判断与人工审查分开",
    );
    console.log(
      JSON.stringify({
        phase: "repair-passed",
        mrIid: d.task.mrIid,
        head: d.task.head,
      }),
    );
    await page.locator("#refresh").click();
    await page.locator('[data-tab="checks"]').click();
    await page.getByText("自动检查", { exact: true }).waitFor();
    await page.screenshot({ path: dir + "/live-detail.png", fullPage: true });
    await page.locator('[data-action="Intervene"]').click();
    await page.locator('#dialog [type="submit"]').click();
    await page.locator("#dialog").waitFor({ state: "hidden" });
    await page.reload();
    await page.locator('[data-action="Resume"]').waitFor();
    d = await api("GET", path);
    assert.equal(d.task.control, "Human");
    assert.equal(d.task.stopConfirmed, true);
    checks.push("检查通过后仍可人工介入；刷新保留人工控制，MR 待人工合入");
    for (const tab of ["overview", "changes", "checks", "comments", "logs"])
      await page.locator('[data-tab="' + tab + '"]').click();
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
          path: dir + "/live-mobile.png",
          fullPage: true,
        });
    }
    await page.goto(base + "#tasks");
    await page.locator("#tenant-switch").selectOption(pilot.tenantId);
    await page.locator("[data-open]").first().waitFor();
    for (const l of ["表格", "看板", "双栏"])
      await page.getByRole("button", { name: l, exact: true }).click();
    await page.getByRole("button", { name: "表格", exact: true }).click();
    await page.screenshot({ path: dir + "/live-home.png", fullPage: true });
    assert.deepEqual(errors, []);
    checks.push(
      "同一导航、五个任务标签、三种布局与四种屏幕均无脚本错误或页面溢出",
    );
    fs.writeFileSync(
      dir + "/live.json",
      JSON.stringify(
        {
          passed: true,
          checks,
          taskId: id,
          mrIid: d.task.mrIid,
          head: d.task.head,
          synthetic: true,
          realBugCount: 0,
          mrMerged: false,
        },
        null,
        2,
      ),
    );
    console.log(
      JSON.stringify(
        { passed: true, checks, taskId: id, mrIid: d.task.mrIid },
        null,
        2,
      ),
    );
  } catch (e) {
    await page
      .screenshot({ path: dir + "/live-failure.png", fullPage: true })
      .catch(() => {});
    let safe = String(e.message);
    for (const value of Object.values(cfg))
      if (typeof value === "string" && value.length >= 12)
        safe = safe.replaceAll(value, "[redacted]");
    console.error(safe.replace(/https?:\/\/\S+/g, "[URL]"));
    process.exitCode = 1;
  } finally {
    await browser.close();
  }
})();
