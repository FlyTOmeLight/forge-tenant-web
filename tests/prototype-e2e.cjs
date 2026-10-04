const assert = require("node:assert/strict");
const { chromium } = require("playwright");
const base =
  process.env.FORGE_PROTOTYPE_URL ||
  "http://127.0.0.1:8583/forge-prototype.html";
(async () => {
  const browser = await chromium.launch({
    headless: true,
    executablePath:
      process.env.CHROME_EXECUTABLE ||
      (process.platform === "darwin"
        ? "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome"
        : undefined),
  });
  const page = await browser.newPage({
      viewport: { width: 1440, height: 1000 },
    }),
    errors = [],
    requests = [];
  page.on("pageerror", (e) => errors.push(e.message));
  page.on("request", (r) => {
    if (/\/(api|auth|internal)\//.test(r.url())) requests.push(r.url());
  });
  const button = (name) => page.getByRole("button", { name, exact: true });
  const dialog = page.locator("#dialog");
  try {
    await page.goto(base);
    await button("重置演示").click();
    await page
      .getByRole("heading", { name: "我的任务", exact: true })
      .waitFor();
    assert.equal(await button("关联修复任务").count(), 0);
    for (const name of ["看板", "双栏", "表格"]) {
      await button(name).click();
      await page.waitForTimeout(50);
    }
    await button("新建修复任务").click();
    await dialog.locator("[name=project]").selectOption("p-0");
    await dialog.locator("[type=submit]").click();
    await dialog.getByRole("heading", { name: "新建修复任务" }).waitFor();
    for (const [name, text] of Object.entries({
      title: "Vue migration acceptance",
      description: "Boundary handling",
      reproduce: "Submit an empty value",
      criteria: "Preserve the contract",
      constraints: "Only the allowed paths",
    }))
      await dialog.locator(`[name=${name}]`).fill(text);
    await dialog.getByLabel("周以宁", { exact: true }).check();
    await dialog.locator("[type=submit]").click();
    await dialog.waitFor({ state: "hidden" });
    await page
      .getByRole("heading", { name: "Vue migration acceptance" })
      .waitFor();
    await button("开始执行").click();
    await button("生成修改").click();
    await button("检查通过").click();
    await page.locator("[data-tab=checks]").click();
    await page
      .getByRole("heading", { name: "Agent 判断", exact: true })
      .waitFor();
    await button("认可当前代码版本").click();
    await dialog.locator("[type=submit]").click();
    await dialog.waitFor({ state: "hidden" });
    await page.locator("[data-tab=changes]").click();
    await page.getByRole("heading", { name: "最近一轮代码差异" }).waitFor();
    await button("人工介入").click();
    await dialog.locator("[type=submit]").click();
    await dialog.waitFor({ state: "hidden" });
    await button("项目执行配置").click();
    await button("编辑执行配置").click();
    await dialog.locator("[name=repairLimit]").fill("2");
    await dialog.locator("[type=submit]").click();
    await dialog.waitFor({ state: "hidden" });
    await button("检查接入").click();
    await page
      .getByRole("status")
      .filter({ hasText: "接入检查通过" })
      .waitFor();
    await page.getByLabel("体验角色").selectOption("u-zhou");
    await page.waitForFunction(
      () => document.querySelector("#operator-name")?.textContent === "周以宁",
    );
    assert.equal(await button("编辑执行配置").count(), 0);
    await button("待我审查").click();
    await page
      .getByRole("heading", { name: "待我审查", exact: true })
      .waitFor();
    assert.equal(await button("新建修复任务").count(), 0);
    await button("修复权限撤销后仍可执行的问题").waitFor();
    await page.getByLabel("体验角色").selectOption("u-lin");
    await page.waitForFunction(
      () => document.querySelector("#operator-name")?.textContent === "林予安",
    );
    await page.getByLabel("体验角色").selectOption("u-chen");
    await page.waitForFunction(
      () => document.querySelector("#operator-name")?.textContent === "陈澄",
    );
    assert.equal(await button("成员与团队").count(), 0);
    assert.equal(await button("权限同步").count(), 0);
    assert.equal(await button("平台管理 ↗").count(), 0);
    await button("我的任务").click();
    await button("新建修复任务").click();
    await dialog.locator("[name=project]").selectOption("p-0");
    await dialog.locator("[type=submit]").click();
    await dialog.getByLabel("周以宁", { exact: true }).waitFor();
    await dialog.getByLabel("周以宁", { exact: true }).check();
    await page.keyboard.press("Escape");
    await page.getByLabel("体验角色").selectOption("u-platform");
    await page.waitForFunction(
      () =>
        document.querySelector("#operator-name")?.textContent === "平台运营员",
    );
    await button("平台管理 ↗").click();
    await page
      .getByRole("heading", { name: "租户管理", exact: true })
      .waitFor();
    assert.equal(await page.locator("#tenant-switch").count(), 0);
    assert.equal(await button("进入工作区").count(), 0);
    await button("全局服务连接").click();
    await page
      .getByRole("heading", { name: "全局服务连接", exact: true })
      .waitFor();
    await page.getByLabel("体验角色").selectOption("u-zhou");
    await page
      .getByRole("heading", { name: "你没有此页面的访问权限" })
      .waitFor();
    await button("返回工作台").click();
    await page.getByLabel("体验角色").selectOption("u-lin");
    await page.waitForFunction(
      () => document.querySelector("#operator-name")?.textContent === "林予安",
    );
    for (const label of [
      "成员与团队",
      "权限同步",
      "审计记录",
      "项目",
      "我的任务",
    ]) {
      await page
        .locator("#nav")
        .getByRole("button", { name: label, exact: true })
        .click();
      await page.getByRole("heading", { name: label, exact: true }).waitFor();
    }
    await button("角色与权限").click();
    await page.getByRole("heading", { name: "开发者", exact: true }).waitFor();
    await button("成员与团队").click();
    await button("团队").click();
    await button("创建团队").click();
    await dialog.locator("[name=name]").fill("权限验收团队");
    await dialog.locator("[type=submit]").click();
    await dialog.waitFor({ state: "hidden" });
    await page
      .locator("tr")
      .filter({ hasText: "权限验收团队" })
      .getByRole("button", { name: "查看成员" })
      .click();
    await button("添加团队成员").click();
    await dialog.locator("[name=member]").selectOption("m-2");
    await dialog.locator("[type=submit]").click();
    await dialog.waitFor({ state: "hidden" });
    await page.evaluate(() => (location.hash = "project/p-0/members"));
    await button("分配团队角色").click();
    await dialog
      .locator("[name=team]")
      .selectOption({ label: "权限验收团队 · 1 位成员" });
    await dialog.locator("[name=role]").selectOption("admin");
    await dialog.locator("[type=submit]").click();
    await dialog.waitFor({ state: "hidden" });
    await page.getByLabel("体验角色").selectOption("u-chen");
    await button("我的权限").click();
    await page.getByRole("heading", { name: "陈澄 · 权限概览" }).waitFor();
    const permissionProject = page
      .locator(".permission-project")
      .filter({ hasText: "billing-api" });
    await permissionProject
      .getByText("当前有效：项目管理员", { exact: true })
      .waitFor();
    await permissionProject
      .getByText("团队 · 权限验收团队 → 项目管理员", { exact: true })
      .waitFor();
    await page.getByLabel("体验角色").selectOption("u-lin");
    await button("成员与团队").click();
    await button("团队").click();
    await page
      .locator("tr")
      .filter({ hasText: "权限验收团队" })
      .getByRole("button", { name: "查看成员" })
      .click();
    await button("移出团队").click();
    await dialog.locator("[type=submit]").click();
    await dialog.waitFor({ state: "hidden" });
    await page.getByLabel("体验角色").selectOption("u-chen");
    await button("我的权限").click();
    await permissionProject
      .getByText("当前有效：开发者", { exact: true })
      .waitFor();
    assert.equal(
      await permissionProject
        .getByText("团队 · 权限验收团队 → 项目管理员", { exact: true })
        .count(),
      0,
    );
    await page.getByLabel("体验角色").selectOption("u-lin");
    await page.getByRole("heading", { name: "林予安 · 权限概览" }).waitFor();
    await button("我的任务").click();
    for (const width of [375, 768, 1024, 1440]) {
      await page.setViewportSize({ width, height: 1000 });
      assert.equal(
        await page.evaluate(
          () => document.documentElement.scrollWidth > innerWidth,
        ),
        false,
        `overflow at ${width}`,
      );
    }
    await page.reload();
    await page
      .getByRole("heading", { name: "我的任务", exact: true })
      .waitFor();
    await page
      .getByRole("button", { name: "Vue migration acceptance", exact: true })
      .waitFor();
    assert.deepEqual(errors, []);
    assert.deepEqual(requests, []);
    console.log(
      JSON.stringify({
        passed: true,
        checks: [
          "three layouts",
          "new task with multiple reviewers",
          "execution and human review",
          "configuration recheck",
          "reviewer permissions",
          "scope-based navigation and platform isolation",
          "role catalogue and personal permissions",
          "team role inheritance and direct role preservation",
          "developer selects project reviewer",
          "review queue includes other owners",
          "responsive widths",
          "persistence",
          "no live API calls",
        ],
      }),
    );
  } finally {
    await browser.close();
  }
})().catch((e) => {
  console.error(e);
  process.exitCode = 1;
});
