const fs = require("node:fs");
const assert = require("node:assert/strict");
const { chromium } = require("playwright");
if (!process.env.FORGE_FEEDBACK_FIXTURE)
  throw Error("FORGE_FEEDBACK_FIXTURE is required");
const snapshot = JSON.parse(
  fs.readFileSync(process.env.FORGE_FEEDBACK_FIXTURE),
);
const config = JSON.parse(
  fs.readFileSync(
    process.env.FORGE_CONFIG || "../forge-tenant-api/.local/deployment.json",
  ),
);
const base = process.env.FORGE_URL || config.publicURL;
(async () => {
  const browser = await chromium.launch({
    headless: true,
    executablePath:
      "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome",
    args: ["--no-proxy-server"],
  });
  try {
    const context = await browser.newContext(),
      page = await context.newPage();
    await page.goto(base);
    await page.locator("#username").fill(config.adminUsername);
    await page.locator("#password").fill(config.adminPassword);
    await page.locator("#submit").click();
    await page.waitForURL((u) => u.pathname === "/");
    const task = snapshot.task,
      feedback = snapshot.feedback.find((f) => f.status === "Pending");
    assert.ok(feedback);
    let action;
    const path = `/api/v1/tenants/${task.tenantId}/projects/${task.projectId}/tasks/${task.id}`;
    await page.route("**" + path, (route) => route.fulfill({ json: snapshot }));
    await page.route("**" + path + "/actions", (route) => {
      action = route.request().postDataJSON();
      snapshot.task = {
        ...task,
        control: "Agent",
        status: "Queued",
        activeRun: "mock-run",
      };
      snapshot.feedback = snapshot.feedback.map((f) => ({
        ...f,
        status: "Consumed",
      }));
      return route.fulfill({ json: snapshot.task });
    });
    const loaded = page.waitForResponse(
      (r) => new URL(r.url()).pathname === "/api/v1/tenants/" + task.tenantId,
    );
    await page.locator("#tenant-switch").selectOption(task.tenantId);
    await loaded;
    await page.goto(
      base + `/#task/${task.tenantId}/${task.projectId}/${task.id}`,
    );
    await page
      .getByRole("heading", { name: task.title, exact: true })
      .waitFor();
    await page.locator("[data-tab=comments]").click();
    await page
      .getByText("等待负责人恢复 Agent", { exact: true })
      .waitFor({ timeout: 5000 });
    await page.locator(`[data-resume-feedback="${feedback.id}"]`).click();
    const dialog = page.locator("#dialog");
    await dialog
      .getByRole("button", { name: "恢复并执行这条要求", exact: true })
      .click();
    await dialog.waitFor({ state: "hidden" });
    assert.equal(action.action, "Resume");
    assert.equal(action.feedbackId, feedback.id);
    assert.equal(action.head, task.head);
    assert.equal(action.version, task.version);
    console.log(
      "PASS: human feedback waits for explicit restore; saved feedback ID sent. No real task was started.",
    );
  } finally {
    await browser.close();
  }
})().catch((e) => {
  console.error(e.message);
  process.exitCode = 1;
});
