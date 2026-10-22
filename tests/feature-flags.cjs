// Isolated fixtures for the deployment-only baseline; no live services or credentials.
const assert = require("node:assert/strict");
const { chromium } = require("playwright");
const base = process.env.FEATURE_TEST_URL || "http://127.0.0.1:18493";
(async () => {
  const browser = await chromium.launch({
    headless: true,
    executablePath:
      process.env.CHROME_EXECUTABLE ||
      "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome",
  });
  try {
    for (const coding of [false, true]) {
      for (const agent of [false, true]) {
        const page = await browser.newPage();
        const requests = [],
          errors = [];
        page.on("pageerror", (e) => errors.push(e.message));
        await page.route("**/runtime-config.json", (route) =>
          route.fulfill({
            json: { coding: { enabled: coding }, agent: { enabled: agent } },
          }),
        );
        await page.route("**/api/**", (route) => {
          const path = new URL(route.request().url()).pathname;
          requests.push(path);
          const tenant = { id: "t", name: "Fixture tenant", status: "active" };
          let data = {};
          if (path === "/api/v1/me")
            data = {
              user: { id: "u", name: "Admin", email: "admin@example.test" },
              csrf_token: "fixture",
              permissions: { managePlatform: true },
            };
          else if (path === "/api/v1/tenants") data = { items: [tenant] };
          else if (path === "/api/v1/tenants/t")
            data = {
              tenant,
              permissions: {
                manageProjects: true,
                manageMembers: true,
                viewSettings: true,
                viewSync: true,
                viewAudit: true,
              },
              members: [],
              teams: [],
              grants: [],
              operations: [],
              audit: [],
              projects: [
                {
                  id: "p",
                  name: "Tenant project",
                  path: "test/project",
                  permissions: {
                    viewProject: true,
                    readCode: true,
                    createTask: true,
                    manageMembers: true,
                    configureExecution: true,
                  },
                },
              ],
            };
          else if (/\/(tasks|people|team-grants)$/.test(path))
            data = { items: [] };
          return route.fulfill({ json: data });
        });
        await page.goto(base);
        await page
          .getByRole("heading", {
            name: coding ? "我的任务" : "项目",
            exact: true,
          })
          .waitFor();
        assert.equal(
          await page
            .locator("#nav")
            .getByRole("button", { name: "我的任务", exact: true })
            .count(),
          coding ? 1 : 0,
        );
        assert.equal(
          await page
            .locator("#nav")
            .getByRole("button", { name: "成员与团队", exact: true })
            .count(),
          1,
        );
        if (coding)
          assert.equal(
            requests.some((p) => p.endsWith("/tasks")),
            true,
          );
        else {
          for (const route of [
            "tasks",
            "reviews",
            "task/t/p/one",
            "platform/connections",
            "platform/connections?tab=x",
            "platform/connections/",
          ]) {
            await page.goto(base + "/#" + route);
            await page.reload();
            await page
              .getByRole("heading", { name: "项目", exact: true })
              .waitFor();
          }
          for (const route of [
            "project/p",
            "project/p/tasks",
            "project/p/execution",
          ]) {
            await page.goto(base + "/#" + route);
            await page.reload();
            await page
              .getByRole("heading", { name: "项目成员与权限", exact: true })
              .waitFor();
            assert.equal(
              await page
                .getByRole("button", { name: "添加项目成员", exact: true })
                .count(),
              1,
            );
            assert.equal(
              await page
                .getByRole("button", { name: "执行配置", exact: true })
                .count(),
              0,
            );
            assert.equal(
              await page
                .getByRole("button", { name: "任务", exact: true })
                .count(),
              0,
            );
          }
          assert.equal(
            requests.some((p) => /\/(tasks|coding-settings)(\/|$)/.test(p)),
            false,
          );
        }
        assert.deepEqual(errors, []);
        await page.close();
      }
    }
    console.log(
      "deployment-only feature fixtures passed (all four config combinations; baseline has no Agent UI)",
    );
  } finally {
    await browser.close();
  }
})().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
