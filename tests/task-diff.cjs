const fs = require("node:fs");
const path = require("node:path");
const assert = require("node:assert/strict");
const { chromium } = require("playwright");
if (!process.env.FORGE_DIFF_FIXTURE || !process.env.FORGE_DIFF_PATCH)
  throw Error("FORGE_DIFF_FIXTURE and FORGE_DIFF_PATCH are required");
const snapshot = JSON.parse(fs.readFileSync(process.env.FORGE_DIFF_FIXTURE));
const patch = fs.readFileSync(process.env.FORGE_DIFF_PATCH, "utf8");
const config = JSON.parse(
  fs.readFileSync(
    process.env.FORGE_CONFIG || "../forge-tenant-api/.local/deployment.json",
  ),
);
const base = process.env.FORGE_URL || config.publicURL;
const task = snapshot.task;
const endpoint = `/api/v1/tenants/${task.tenantId}/projects/${task.projectId}/tasks/${task.id}`;
const historical = snapshot.runs.find((r) => r.output?.patch)?.output.patch;
assert.ok(
  historical && historical !== patch,
  "Fixture must reproduce an empty latest round and different historical patch",
);
assert.equal(snapshot.runs[0].output.patch, "");
const current = {
  mrIid: task.mrIid,
  base: "2187b1cb32a5927bfa064093c2fe6b5044c97eb7",
  head: task.head,
  start: "2187b1cb32a5927bfa064093c2fe6b5044c97eb7",
  sourceBranch: task.branch,
  targetBranch: task.targetBranch,
  patch,
};
(async () => {
  const browser = await chromium.launch({
    headless: true,
    executablePath:
      "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome",
    args: ["--no-proxy-server"],
  });
  try {
    const ctx = await browser.newContext({
        viewport: { width: 1440, height: 1000 },
      }),
      page = await ctx.newPage();
    const errors = [];
    page.on("pageerror", (e) => errors.push(e.message));
    if (process.env.FORGE_DIFF_LOCAL_BUILD === "1") {
      await page.route("**/*", (route) =>
        new URL(route.request().url()).origin === new URL(base).origin &&
        new URL(route.request().url()).pathname === "/"
          ? route.fulfill({
              path: path.resolve("dist/index.html"),
              contentType: "text/html",
            })
          : route.continue(),
      );
      await page.route("**/assets/**", (route) => {
        const file = path.resolve(
          "dist/assets",
          path.basename(new URL(route.request().url()).pathname),
        );
        return fs.existsSync(file)
          ? route.fulfill({
              path: file,
              contentType: file.endsWith(".css")
                ? "text/css"
                : "text/javascript",
            })
          : route.continue();
      });
    }
    await page.goto(base);
    await page.locator("#username").fill(config.adminUsername);
    await page.locator("#password").fill(config.adminPassword);
    await page.locator("#submit").click();
    await page.waitForURL((u) => u.pathname === "/");
    await page.locator("#tenant-switch").waitFor();
    await page.goto(base);
    let mode = "current",
      delay = true,
      release;
    const pending = new Promise((resolve) => {
      release = resolve;
    });
    await page.route("**" + endpoint, (route) =>
      route.fulfill({
        json: {
          ...snapshot,
          task: { ...task, mrIid: mode === "none" ? 0 : task.mrIid },
        },
      }),
    );
    await page.route("**" + endpoint + "/runs/*/trace?*", (route) =>
      route.fulfill({
        json: { run: null, events: [], nextSeq: 0, hasMore: false },
      }),
    );
    await page.route("**" + endpoint + "/diff", async (route) => {
      assert.equal(route.request().method(), "GET");
      if (delay) await pending;
      return mode === "failed"
        ? route.fulfill({
            status: 502,
            json: { error: { message: "无法读取 GitLab MR 差异，请重试" } },
          })
        : route.fulfill({
            json:
              mode === "none" ? { ...current, mrIid: 0, patch: "" } : current,
          });
    });
    const tenantLoaded = page.waitForResponse(
      (r) => new URL(r.url()).pathname === "/api/v1/tenants/" + task.tenantId,
    );
    await page.locator("#tenant-switch").selectOption(task.tenantId);
    await tenantLoaded;
    await page.goto(
      base + `/#task/${task.tenantId}/${task.projectId}/${task.id}`,
    );
    await page.getByRole("tab", { name: "代码差异", exact: true }).click();
    await page
      .getByRole("status")
      .filter({ hasText: "正在读取 GitLab MR 差异" })
      .waitFor();
    delay = false;
    release();
    const section = page.getByRole("region", {
      name: "当前 MR 差异",
      exact: true,
    });
    const reader = section.getByRole("region", {
      name: "代码差异阅读器",
      exact: true,
    });
    await reader.getByText("2 个文件", { exact: true }).waitFor();
    assert.ok(
      (await reader.innerText()).includes("计算并返回两个数的加法结果。"),
    );
    assert.ok((await reader.innerText()).includes("当 count 为 0 时返回 0。"));
    assert.ok(
      (await section.innerText()).includes(current.base + " → " + current.head),
    );
    const downloadEvent = page.waitForEvent("download");
    await reader.getByRole("button", { name: "下载补丁", exact: true }).click();
    const download = await downloadEvent;
    assert.equal(
      fs.readFileSync(await download.path(), "utf8"),
      patch,
      "Download must use the current MR, not a historical round patch",
    );
    await reader.getByRole("button", { name: "左右对比", exact: true }).click();
    assert.equal(await reader.locator(".d2h-file-side-diff").count(), 4);
    await page.setViewportSize({ width: 390, height: 844 });
    assert.ok(
      await page.evaluate(
        () => document.documentElement.scrollWidth <= innerWidth,
      ),
    );
    await page.setViewportSize({ width: 1440, height: 1000 });
    mode = "failed";
    await section
      .getByRole("button", { name: "刷新差异", exact: true })
      .click();
    await section.getByRole("alert").waitFor();
    assert.equal(
      await reader.count(),
      0,
      "An upstream failure must not show the historical patch",
    );
    mode = "current";
    await section
      .getByRole("button", { name: "重新读取", exact: true })
      .click();
    await reader.getByText("2 个文件", { exact: true }).waitFor();
    await page.getByRole("tab", { name: "验证与审查", exact: true }).click();
    await page.getByText("本轮没有新的代码改动。", { exact: true }).waitFor();
    const history = page.getByText("查看本轮代码差异", { exact: true });
    const outer = history.locator("xpath=ancestor::details[2]");
    if ((await outer.getAttribute("open")) === null)
      await outer.locator(":scope > summary").click();
    await history.click();
    assert.equal(
      await page
        .getByRole("region", { name: "代码差异阅读器", exact: true })
        .count(),
      1,
      "Historical single-round patch remains available",
    );
    mode = "none";
    await page.reload();
    await page.getByRole("tab", { name: "代码差异", exact: true }).click();
    await page
      .getByText("尚未创建 MR。单轮改动可在“验证与审查”中查看。", {
        exact: true,
      })
      .waitFor();
    assert.equal(await reader.count(), 0);
    assert.deepEqual(errors, []);
    console.log(
      JSON.stringify({
        status: "passed",
        checks: [
          "current MR after empty round",
          "raw MR download",
          "commit labels",
          "loading feedback",
          "upstream failure and retry",
          "no MR has no historical fallback",
          "single-round history retained",
          "split view",
          "mobile overflow",
        ],
        scope:
          "Read-only login and mocked task/MR diff responses; no task or GitLab writes.",
      }),
    );
  } finally {
    await browser.close();
  }
})().catch((e) => {
  console.error(e.message);
  process.exitCode = 1;
});
