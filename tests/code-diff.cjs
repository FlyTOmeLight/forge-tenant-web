const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const { chromium } = require("playwright");
const config = JSON.parse(
  fs.readFileSync(
    path.resolve(__dirname, "../../forge-tenant-api/.local/deployment.json"),
  ),
);
const base = process.env.DIFF_BASE_URL || config.publicURL;
const tenant = "t_0358edab7fe37092d6780271";
const project = "p_ccdebe8e4d497fd7508c269d";
const task = "task_613ff7c5f39400d2f24e1468";
const endpoint = `/api/v1/tenants/${tenant}/projects/${project}/tasks/${task}`;
const evidence = path.resolve(__dirname, "../.local/diff-evidence");
(async () => {
  const browser = await chromium.launch({
    executablePath:
      process.env.CHROME_EXECUTABLE ||
      "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome",
    headless: true,
    args: ["--no-proxy-server"],
  });
  try {
    const context = await browser.newContext({
      viewport: { width: 1440, height: 1000 },
    });
    const page = await context.newPage();
    const errors = [];
    page.on("pageerror", (e) => errors.push(e.message));
    await page.goto(config.publicURL);
    await page.locator("#username").fill(config.adminUsername);
    await page.locator("#password").fill(config.adminPassword);
    await page.locator("#submit").click();
    await page.waitForURL((u) => u.pathname === "/");
    const response = await context.request.get(config.publicURL + endpoint);
    assert.equal(response.status(), 200);
    const detail = await response.json();
    const patch = detail.runs.find((r) => r.output?.patch).output.patch;
    await page.goto(base);
    await page.locator("#tenant-switch").selectOption(tenant);
    await page.goto(`${base}/#task/${tenant}/${project}/${task}`);
    await page.getByRole("tab", { name: "代码差异", exact: true }).click();
    const reader = page.getByRole("region", {
      name: "代码差异阅读器",
      exact: true,
    });
    await reader.getByText("+2 新增", { exact: true }).waitFor();
    assert.equal(
      await reader
        .locator(".d2h-code-line-ctn")
        .allTextContents()
        .then((lines) => lines.join("\n")),
      "def ratio(total, count):\n    if count == 0:\n        return 0\n    return total / count",
    );
    assert.equal(
      await reader.locator(".d2h-code-linenumber.d2h-ins").count(),
      2,
    );
    assert.deepEqual(await reader.locator(".line-num2").allTextContents(), [
      "1",
      "2",
      "3",
      "4",
    ]);
    const oldLine = await reader.locator(".line-num1").first().boundingBox();
    const newLine = await reader.locator(".line-num2").first().boundingBox();
    assert.equal(
      oldLine.y,
      newLine.y,
      "Old and new line numbers must share a row",
    );
    assert.ok(
      newLine.x >= oldLine.x + oldLine.width,
      "Line numbers must not overlap",
    );
    const downloadEvent = page.waitForEvent("download");
    await page.getByRole("button", { name: "下载补丁" }).click();
    const download = await downloadEvent;
    assert.equal(fs.readFileSync(await download.path(), "utf8"), patch);
    fs.mkdirSync(evidence, { recursive: true });
    await reader.screenshot({ path: path.join(evidence, "unified.png") });
    await reader.getByRole("button", { name: "左右对比" }).click();
    assert.equal(await reader.locator(".d2h-file-side-diff").count(), 2);
    await reader.screenshot({ path: path.join(evidence, "split.png") });
    const summary = reader.locator("summary").first();
    await summary.focus();
    await page.keyboard.press("Enter");
    assert.equal(
      await reader.locator("details").first().getAttribute("open"),
      null,
    );
    await page.keyboard.press("Enter");
    await reader.getByRole("button", { name: "合并视图" }).click();
    await page.setViewportSize({ width: 390, height: 844 });
    assert.ok(
      await page.evaluate(
        () => document.documentElement.scrollWidth <= innerWidth,
      ),
    );
    await reader.screenshot({ path: path.join(evidence, "mobile.png") });
    await page.setViewportSize({ width: 1440, height: 1000 });
    // Exercise file operations, word changes, and escaped source text without writing to the real task.
    const fixture = [
      "diff --git a/src/view.html b/src/view.html",
      "--- a/src/view.html",
      "+++ b/src/view.html",
      "@@ -1 +1 @@",
      "-<p>old</p>",
      '+<img src=x onerror="window.diffInjected=true">',
      "diff --git a/new.txt b/new.txt",
      "new file mode 100644",
      "--- /dev/null",
      "+++ b/new.txt",
      "@@ -0,0 +1 @@",
      "+new file",
      "diff --git a/old.txt b/old.txt",
      "deleted file mode 100644",
      "--- a/old.txt",
      "+++ /dev/null",
      "@@ -1 +0,0 @@",
      "-old file",
      "diff --git a/before.txt b/after.txt",
      "similarity index 100%",
      "rename from before.txt",
      "rename to after.txt",
      "",
    ].join("\n");
    await page.route("**" + endpoint, (route) =>
      route.fulfill({
        json: {
          ...detail,
          runs: [
            {
              ...detail.runs[0],
              output: { patch: fixture, checksCommit: detail.task.head },
            },
          ],
        },
      }),
    );
    await page.reload();
    await page.getByRole("tab", { name: "代码差异", exact: true }).click();
    await reader.getByText("4 个文件", { exact: true }).waitFor();
    await reader.getByText("新增文件", { exact: true }).waitFor();
    await reader.getByText("删除文件", { exact: true }).waitFor();
    await reader.getByText("重命名", { exact: true }).waitFor();
    assert.equal(await reader.locator("img").count(), 0);
    assert.equal(await page.evaluate(() => window.diffInjected), undefined);
    assert.equal(
      await reader
        .locator(".d2h-code-line-ctn")
        .filter({ hasText: '<img src=x onerror="window.diffInjected=true">' })
        .count(),
      1,
    );
    await page.setViewportSize({ width: 1440, height: 1000 });
    await reader.screenshot({
      path: path.join(evidence, "file-operations.png"),
    });
    assert.deepEqual(errors, []);
    console.log(
      JSON.stringify({
        status: "passed",
        realTask: task,
        checks: [
          "line numbers",
          "additions",
          "raw download",
          "split view",
          "keyboard collapse",
          "mobile overflow",
          "file operations",
          "escaped source",
        ],
        base,
      }),
    );
  } finally {
    await browser.close();
  }
})().catch((e) => {
  console.error(e.message);
  process.exitCode = 1;
});
