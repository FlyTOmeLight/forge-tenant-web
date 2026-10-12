const fs = require("fs"),
  assert = require("assert/strict"),
  crypto = require("crypto");
const path = require("path");
const root = path.resolve(__dirname, "..");
const { chromium } = require("playwright");
const evidence = path.join(root, ".local/coding-evidence");
fs.mkdirSync(evidence, { recursive: true });
if (!process.env.FORGE_CODING_PILOT)
  throw Error("FORGE_CODING_PILOT must select an authorized test project");
(async () => {
  const cfg = JSON.parse(
      fs.readFileSync(
        process.env.FORGE_CONFIG ||
          path.resolve(root, "../forge-tenant-api/.local/deployment.json"),
      ),
    ),
    pilot = JSON.parse(fs.readFileSync(process.env.FORGE_CODING_PILOT));
  const browser = await chromium.launch({
    headless: true,
    executablePath:
      "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome",
    args: ["--no-proxy-server"],
  });
  try {
    const ctx = await browser.newContext();
    const page = await ctx.newPage();
    const errors = [];
    page.on("pageerror", (e) => errors.push(e.message));
    await page.goto(cfg.publicURL);
    await page.locator("#username").fill(cfg.adminUsername);
    await page.locator("#password").fill(cfg.adminPassword);
    await page.locator("#submit").click();
    await page.waitForURL((u) => u.pathname === "/");
    await page
      .getByRole("heading", { name: "我的任务", exact: true })
      .waitFor();
    const me = await (
      await ctx.request.get(cfg.publicURL + "/api/v1/me")
    ).json();
    async function api(method, url, body) {
      const r = await ctx.request.fetch(cfg.publicURL + url, {
        method,
        headers: {
          Origin: cfg.publicURL,
          "X-CSRF-Token": me.csrf_token,
          "Idempotency-Key": crypto.randomUUID(),
        },
        ...(body ? { data: body } : {}),
      });
      const out = await r.json();
      if (!r.ok())
        throw Error(
          method + " " + url + " " + r.status() + " " + out.error?.code,
        );
      return out;
    }
    const prefix = `/api/v1/tenants/${pilot.tenant_id}/projects/${pilot.project_id}`;
    let settings = (await api("GET", prefix + "/coding-settings")).settings;
    await api("PUT", prefix + "/coding-settings", {
      ...settings,
      baseBranch: "main",
      agentID: pilot.agentID || settings.agentID,
      agentVersion: pilot.agentVersion || settings.agentVersion,
      allowedPaths: ["src/"],
      checks: ["python3 -m unittest discover -s src"],
      repairLimit: 3,
      timeoutMinutes: 10,
    });
    await api("POST", prefix + "/coding-settings/check", {});
    const task = await api("POST", prefix + "/tasks/new", {
      title: "修复空样本计算：零计数返回 0",
      description:
        "ratio(total,count) 在 count 为 0 时抛出 ZeroDivisionError。请按验收条件修复。",
      reproduce: "运行 python3 -m unittest discover -s src，test_empty 失败。",
      criteria:
        "count 为 0 时返回 0；正常计算保持不变；保留现有测试并通过全部检查。",
      constraints: "只改 src/calc.py，保留测试内容。",
      synthetic: true,
    });
    fs.writeFileSync(
      path.join(evidence, "task.json"),
      JSON.stringify(task, null, 2),
    );
    console.log("Task created", task.id);
    let last = "";
    const deadline = Date.now() + 12 * 60000;
    while (Date.now() < deadline) {
      const d = await api("GET", prefix + "/tasks/" + task.id);
      const status = d.task.status + "/" + d.task.control + "/" + d.task.checks;
      if (last !== status) {
        console.log(
          status,
          JSON.stringify(
            d.runs.map((r) => ({
              id: r.id,
              runtime: r.runtime_id,
              status: r.status,
            })),
          ),
          Date.now(),
        );
        last = status;
      }
      if (!d.task.activeRun && ["Review", "Failed"].includes(d.task.status)) {
        fs.writeFileSync(
          path.join(evidence, "result.json"),
          JSON.stringify(d, null, 2),
        );
        assert.equal(d.task.checks, "Passed");
        assert.ok(d.task.mrIid > 0);
        assert.equal(d.task.status, "Review");
        assert.ok(d.runs[0].output.patch.includes("src/calc.py"));
        assert.equal(d.runs[0].output.checksCommit, d.task.head);
        assert.equal(errors.length, 0);
        await page.screenshot({
          path: path.join(evidence, "console.png"),
          fullPage: true,
        });
        console.log("REAL_MODEL_DRAFT_MR_PASS", d.task.mrIid);
        return;
      }
      await new Promise((r) => setTimeout(r, 1000));
    }
    throw Error("execution timeout");
  } finally {
    await browser.close();
  }
})().catch((e) => {
  console.error(e.message);
  process.exit(1);
});
