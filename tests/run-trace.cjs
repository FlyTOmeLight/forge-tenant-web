const fs = require("node:fs");
const path = require("node:path");
const assert = require("node:assert/strict");
const { chromium } = require("playwright");
if (!process.env.FORGE_TRACE_FIXTURE)
  throw Error("FORGE_TRACE_FIXTURE is required");
const snapshot = JSON.parse(fs.readFileSync(process.env.FORGE_TRACE_FIXTURE));
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
    const context = await browser.newContext({
        viewport: { width: 1440, height: 1000 },
      }),
      page = await context.newPage();
    const errors = [];
    page.on("pageerror", (e) => errors.push(e.message));
    if (process.env.FORGE_TRACE_LOCAL_BUILD === "1") {
      await page.route("**/*", (route) => {
        const url = new URL(route.request().url());
        return url.origin === new URL(base).origin && url.pathname === "/"
          ? route.fulfill({
              path: path.resolve("dist/index.html"),
              contentType: "text/html",
            })
          : route.continue();
      });
      await page.route("**/assets/**", (route) => {
        const filename = path.basename(new URL(route.request().url()).pathname),
          file = path.resolve("dist/assets", filename);
        return fs.existsSync(file)
          ? route.fulfill({
              path: file,
              contentType: filename.endsWith(".css")
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
    const task = snapshot.task,
      taskPath = `/api/v1/tenants/${task.tenantId}/projects/${task.projectId}/tasks/${task.id}`;
    const created = new Date(Date.now() - 30000).toISOString();
    snapshot.runs = [
      {
        id: "trace-live-mock",
        status: "Running",
        created_at: created,
        requirements: "按评论补充代码注释",
        output: {},
      },
      {
        id: "trace-history-mock",
        status: "Completed",
        created_at: created,
        finished_at: new Date().toISOString(),
        requirements: "历史轮次",
        output: {},
      },
    ];
    snapshot.task = {
      ...task,
      control: "Agent",
      activeRun: "trace-live-mock",
      status: "Running",
      stopConfirmed: false,
    };
    let fail = false,
      runtimeStatus = "Running",
      runtimeError = "",
      reads = 0;
    const events = [];
    function add(kind, payload = {}) {
      events.push({
        runID: "runtime-mock",
        seq: events.length + 1,
        kind,
        createdAt: new Date().toISOString(),
        payload,
      });
    }
    add("RunQueued");
    add("RunStarted");
    add("ModelStarted");
    await page.route("**" + taskPath, (route) =>
      route.fulfill({ json: snapshot }),
    );
    await page.route("**" + taskPath + "/runs/*/trace?*", (route) => {
      reads++;
      if (fail)
        return route.fulfill({
          status: 503,
          json: { error: { message: "运行时暂不可用" } },
        });
      const url = new URL(route.request().url()),
        after = Number(url.searchParams.get("after"));
      if (url.pathname.includes("trace-history-mock")) {
        const history = [
          {
            runID: "history-mock",
            seq: 1,
            kind: "RunCompleted",
            createdAt: created,
            payload: { output: "历史执行完成" },
          },
        ];
        return route.fulfill({
          json: {
            run: {
              id: "history-mock",
              status: "Completed",
              eventSeq: 1,
              attempt: 1,
            },
            events: after ? [] : history,
            latestEvent: history[0],
            nextSeq: 1,
            hasMore: false,
          },
        });
      }
      const chunk = events.filter((e) => e.seq > after).slice(0, 3),
        next = chunk.at(-1)?.seq || after;
      return route.fulfill({
        json: {
          run: {
            id: "runtime-mock",
            status: runtimeStatus,
            error: runtimeError,
            eventSeq: events.length,
            attempt: 1,
          },
          events: chunk,
          latestEvent: events.at(-1),
          nextSeq: next,
          hasMore: next < events.length,
        },
      });
    });
    const loaded = page.waitForResponse(
      (r) => new URL(r.url()).pathname === "/api/v1/tenants/" + task.tenantId,
    );
    await page.locator("#tenant-switch").selectOption(task.tenantId);
    await loaded;
    const taskURL =
      base + `/#task/${task.tenantId}/${task.projectId}/${task.id}`;
    await page.goto(taskURL);
    if (process.env.FORGE_TRACE_LOCAL_BUILD === "1") await page.reload();
    await page
      .getByRole("heading", { name: task.title, exact: true })
      .waitFor();
    const progress = page.locator("[data-run-trace] [role=status]");
    try {
      await progress
        .filter({ hasText: "模型正在生成下一步" })
        .waitFor({ timeout: 5000 });
    } catch (error) {
      console.error(
        "trace diagnostic",
        await page
          .locator("[data-run-trace]")
          .innerText({ timeout: 1000 })
          .catch(() => "component missing"),
        "requests",
        reads,
        "page errors",
        errors,
      );
      console.error(
        "ui diagnostic",
        await page
          .locator("script[src]")
          .evaluateAll((nodes) => nodes.map((n) => n.getAttribute("src"))),
        "tabs",
        await page.locator("[data-tab]").allTextContents(),
        "sections",
        await page
          .locator("section[aria-label]")
          .evaluateAll((nodes) => nodes.map((n) => n.outerHTML.slice(0, 200))),
      );
      await page.screenshot({
        path: "/Users/light/coding-agent-mvp-design/.local/deployment-20261005/trace-failed-page.png",
        fullPage: true,
      });
      throw error;
    }
    await page.locator("[data-tab=trace]").click();
    add("ModelCompleted", { output: "将修改 calc.py，补充函数说明。" });
    add("ToolStarted", {
      stepID: "tool-1",
      name: "edit_file",
      arguments: JSON.stringify({
        path: "src/calc.py",
        before: "old",
        after: "new",
      }),
    });
    await progress
      .filter({ hasText: "正在修改文件" })
      .waitFor({ timeout: 10000 });
    const tool = page.locator("[data-event-kind=ToolStarted]").first();
    await tool.getByText("调用参数", { exact: true }).click();
    assert.ok((await tool.innerText()).includes("src/calc.py"));
    add("ToolCompleted", {
      stepID: "tool-1",
      name: "edit_file",
      result: JSON.stringify({
        error: {
          code: "EDIT_MATCH_FAILED",
          message: "before 必须匹配当前文件内容。",
        },
      }),
    });
    add("ModelStarted");
    await tool
      .getByText("需要修正", { exact: true })
      .waitFor({ timeout: 10000 });
    await tool.getByText("返回结果", { exact: true }).click();
    assert.ok((await tool.innerText()).includes("EDIT_MATCH_FAILED"));
    add("ModelCompleted", { output: "重新读取文件后再修改。" });
    add("ToolStarted", {
      stepID: "tool-2",
      name: "read_file",
      arguments: '{"path":"src/calc.py"}',
    });
    add("ToolCompleted", {
      stepID: "tool-2",
      name: "read_file",
      result: '{"content":"def add(a, b): return a + b"}',
    });
    add("ModelStarted");
    add("ModelCompleted", { output: "使用当前文本更新注释。" });
    add("ToolStarted", {
      stepID: "tool-3",
      name: "edit_file",
      arguments: '{"path":"src/calc.py"}',
    });
    add("RunNeedsReview", {
      waitingStep: "tool-3",
      detail: "edit_file: before must match exactly once (HTTP 409)",
    });
    add("RunCanceled");
    runtimeStatus = "Canceled";
    runtimeError = "edit_file: before must match exactly once (HTTP 409)";
    snapshot.task = {
      ...snapshot.task,
      status: "Review",
      control: "Human",
      activeRun: null,
      stopConfirmed: true,
    };
    snapshot.runs[0].status = "Stopped";
    snapshot.runs[0].finished_at = new Date().toISOString();
    await progress
      .filter({ hasText: "执行已停止" })
      .waitFor({ timeout: 12000 });
    await page
      .getByText("停止原因：" + runtimeError, { exact: true })
      .waitFor();
    assert.equal(
      await page.locator("[data-event-kind=ToolStarted]").count(),
      3,
    );
    assert.equal(
      new Set(
        await page
          .locator("[data-event-seq]")
          .evaluateAll((nodes) => nodes.map((n) => n.dataset.eventSeq)),
      ).size,
      await page.locator("[data-event-seq]").count(),
    );
    fail = true;
    await page.getByRole("button", { name: "刷新记录", exact: true }).click();
    await progress.filter({ hasText: "更新中断" }).waitFor();
    assert.equal(
      await page.locator("[data-event-kind=ToolStarted]").count(),
      3,
    );
    fail = false;
    await page.getByRole("button", { name: "刷新记录", exact: true }).click();
    await progress.filter({ hasText: "执行已停止" }).waitFor();
    await page.reload();
    await page.locator("[data-tab=trace]").click();
    await page
      .getByText("停止原因：" + runtimeError, { exact: true })
      .waitFor();
    assert.equal(
      await page.locator("[data-event-kind=ToolStarted]").count(),
      3,
    );
    await page
      .locator(".run-history select")
      .selectOption("trace-history-mock");
    await page.getByText("历史执行完成", { exact: true }).waitFor();
    assert.equal(
      await page.locator("[data-event-kind=ToolStarted]").count(),
      0,
    );
    await page.locator(".run-history select").selectOption("trace-live-mock");
    await page
      .getByText("停止原因：" + runtimeError, { exact: true })
      .waitFor();
    await page.setViewportSize({ width: 375, height: 850 });
    assert.ok(
      await page.evaluate(
        () => document.documentElement.scrollWidth <= innerWidth,
      ),
      "mobile horizontal overflow",
    );
    if (process.env.FORGE_TRACE_SCREENSHOT)
      await page.screenshot({
        path: process.env.FORGE_TRACE_SCREENSHOT,
        fullPage: true,
      });
    assert.deepEqual(errors, []);
    assert.ok(reads > 5);
    console.log(
      "PASS: live model/tool progress, paged recovery, tool inputs/results, stop reason, reconnect, history switching, dependency errors and mobile layout. No real task was started.",
    );
  } finally {
    await browser.close();
  }
})().catch((e) => {
  console.error(e.message);
  process.exitCode = 1;
});
