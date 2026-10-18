// Isolated UI contract fixtures; no private config or real credentials.
const assert = require("node:assert/strict");
const { chromium } = require("playwright");
const base = process.env.CREDENTIALS_TEST_URL || "http://127.0.0.1:18483";

(async () => {
  const browser = await chromium.launch({
    executablePath:
      process.env.CHROME_EXECUTABLE ||
      (process.platform === "darwin"
        ? "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome"
        : undefined),
    headless: true,
  });
  try {
    const context = await browser.newContext();
    await context.addCookies([
      { name: "forge_session", value: "fixture-session", url: base },
    ]);
    const page = await context.newPage();
    const errors = [];
    page.on("pageerror", (e) => errors.push(e.message));
    await page.addInitScript(() => {
      Object.defineProperty(navigator, "clipboard", {
        value: {
          writeText: async (text) => {
            window.copiedFixture = text;
          },
        },
      });
    });
    const token = "ftk_fixture_only_never_a_real_credential";
    let items = [],
      posts = 0,
      deletes = 0,
      failList = false,
      failCreate = false,
      failDelete = false;
    let releasePost, releaseDelete;
    await page.route("**/api/**", async (route) => {
      const req = route.request(),
        p = new URL(req.url()).pathname,
        method = req.method();
      let result = {},
        status = 200;
      if (p === "/api/v1/me")
        result = {
          user: { id: "u", name: "Fixture user" },
          csrf_token: "fixture-csrf",
          permissions: { managePlatform: false },
        };
      else if (p === "/api/v1/tenants") result = { items: [] };
      else if (p.startsWith("/api/v1/credentials")) {
        const headers = await req.allHeaders();
        assert.equal(headers.authorization, undefined);
        assert.equal(headers["idempotency-key"], undefined);
        assert.equal(headers["if-match"], undefined);
        assert.ok(headers.cookie.includes("forge_session=fixture-session"));
        if (method !== "GET")
          assert.equal(headers["x-csrf-token"], "fixture-csrf");
        if (method === "GET") {
          if (failList) {
            status = 503;
            result = { error: { message: "列表暂不可用" } };
          } else result = { items };
        } else if (method === "POST") {
          posts++;
          const body = req.postDataJSON();
          const remainingDays =
            (Date.parse(body.expires_at) - Date.now()) / 86400000;
          assert.ok(remainingDays > 0 && remainingDays <= 365);
          if (posts === 1)
            assert.ok(remainingDays > 89.99 && remainingDays <= 90);
          assert.ok(body.name.trim());
          await new Promise((resolve) => {
            releasePost = resolve;
          });
          if (failCreate) {
            status = 422;
            result = { error: { message: "创建未完成" } };
          } else {
            const item = {
              id: "key-" + posts,
              name: body.name,
              created_at: new Date().toISOString(),
              expires_at: body.expires_at,
            };
            items.push(item);
            result = { ...item, token };
            status = 201;
          }
        } else if (method === "DELETE") {
          deletes++;
          await new Promise((resolve) => {
            releaseDelete = resolve;
          });
          if (failDelete) {
            status = 503;
            result = { error: { message: "撤销未完成" } };
          } else {
            items.find((i) => i.id === p.split("/").at(-1)).revoked_at =
              new Date().toISOString();
            result = { revoked: true };
          }
        }
      } else throw new Error("Unexpected fixture endpoint: " + p);
      await route.fulfill({ status, json: result });
    });
    const button = (name) => page.getByRole("button", { name, exact: true });
    const dialog = () => page.getByRole("dialog");
    async function waitUntil(predicate) {
      const end = Date.now() + 5000;
      while (!predicate()) {
        if (Date.now() > end)
          throw new Error("Fixture request deadline exceeded");
        await new Promise((resolve) => setTimeout(resolve, 10));
      }
    }
    async function startCreate(name) {
      releasePost = undefined;
      await button("创建 API 密钥").click();
      assert.equal(await page.getByLabel("有效期（天）").inputValue(), "90");
      await page.getByLabel("名称", { exact: true }).fill(name);
    }
    async function submitCreate() {
      await button("创建密钥").click();
      await waitUntil(() => releasePost);
      assert.equal(await button("正在保存…").isDisabled(), true);
      await page
        .locator("#modal-form")
        .evaluate((form) => form.requestSubmit());
    }
    await page.goto(base);
    await page.getByText("尚未加入企业", { exact: true }).waitFor();
    await button("API 密钥").click();
    await page.getByText("尚无 API 密钥", { exact: true }).waitFor();
    await page.reload();
    await page.getByText("尚无 API 密钥", { exact: true }).waitFor();
    await startCreate("脚本调用");
    await submitCreate();
    assert.equal(posts, 1);
    releasePost();
    await page.getByLabel("完整密钥").waitFor();
    assert.equal(await page.getByLabel("完整密钥").inputValue(), token);
    await button("复制密钥").click();
    assert.equal(await page.evaluate(() => window.copiedFixture), token);
    assert.equal(
      await page.evaluate(() =>
        JSON.stringify([localStorage, sessionStorage]).includes("ftk_"),
      ),
      false,
    );
    await button("关闭").click();
    assert.equal(await page.locator("#credential-token").count(), 0);
    await page.reload();
    await page.getByRole("cell", { name: "脚本调用", exact: true }).waitFor();
    assert.equal(await page.locator("#credential-token").count(), 0);

    await startCreate("有效期校验");
    for (const invalid of ["0", "366", "1.5"]) {
      await page.getByLabel("有效期（天）").fill(invalid);
      await button("创建密钥").click();
      assert.equal(
        await page
          .getByLabel("有效期（天）")
          .evaluate((el) => el.checkValidity()),
        false,
      );
      assert.equal(posts, 1);
    }
    failCreate = true;
    await page.getByLabel("有效期（天）").fill("365");
    await submitCreate();
    releasePost();
    await dialog().getByText("创建未完成", { exact: true }).waitFor();
    failCreate = false;
    await button("取消").click();

    await button("撤销").click();
    await button("取消").click();
    assert.equal(deletes, 0);
    failDelete = true;
    await button("撤销").click();
    await button("确认撤销").click();
    await waitUntil(() => releaseDelete);
    await page.locator("#modal-form").evaluate((form) => form.requestSubmit());
    assert.equal(deletes, 1);
    releaseDelete();
    await dialog().getByText("撤销未完成", { exact: true }).waitFor();
    failDelete = false;
    releaseDelete = undefined;
    await button("确认撤销").click();
    await waitUntil(() => releaseDelete);
    releaseDelete();
    await dialog().waitFor({ state: "hidden" });
    await page
      .getByRole("cell", { name: "已撤销", exact: true })
      .first()
      .waitFor();
    assert.equal(await button("撤销").count(), 0);

    failList = true;
    await button("刷新数据").click();
    await page.getByText("列表暂不可用", { exact: true }).waitFor();
    assert.equal(
      await page.getByText("尚无 API 密钥", { exact: true }).count(),
      0,
    );
    failList = false;
    items.push({
      id: "expired",
      name: "过期密钥",
      created_at: "2020-01-01T00:00:00Z",
      expires_at: "2020-04-01T00:00:00Z",
    });
    await button("重新加载").click();
    await page.getByRole("cell", { name: "已过期", exact: true }).waitFor();

    await startCreate("离页清除");
    await submitCreate();
    releasePost();
    await page.getByLabel("完整密钥").waitFor();
    await page.evaluate(() => {
      location.hash = "tasks";
    });
    await page.getByText("尚未加入企业", { exact: true }).waitFor();
    await button("API 密钥").click();
    await page.getByRole("cell", { name: "离页清除", exact: true }).waitFor();
    assert.equal(await page.locator("#credential-token").count(), 0);

    await startCreate("晚到响应");
    await submitCreate();
    await page.evaluate(() => {
      location.hash = "tasks";
    });
    await page.getByText("尚未加入企业", { exact: true }).waitFor();
    releasePost();
    await button("API 密钥").click();
    await page.getByRole("cell", { name: "晚到响应", exact: true }).waitFor();
    assert.equal(await page.locator("#credential-token").count(), 0);

    await startCreate("浏览器离页");
    await submitCreate();
    releasePost();
    await page.getByLabel("完整密钥").waitFor();
    await page.evaluate(() => {
      navigator.clipboard.writeText = async () => {
        throw new Error("denied");
      };
    });
    await button("复制密钥").click();
    await page
      .getByText("复制失败，请手动选择并复制密钥。", { exact: true })
      .waitFor();
    await page.evaluate(() => {
      window.dispatchEvent(
        new PageTransitionEvent("pagehide", { persisted: true }),
      );
    });
    await dialog().waitFor({ state: "hidden" });
    assert.equal(await page.locator("#credential-token").count(), 0);

    await page.setViewportSize({ width: 390, height: 844 });
    assert.equal(
      await page.evaluate(
        () => document.documentElement.scrollWidth > innerWidth,
      ),
      false,
    );
    assert.deepEqual(errors, []);
    console.log(
      "PASS credentials: account navigation, cookie/CSRF, expiry, one-time display/copy/cleanup, metadata, revoke, failures, duplicate prevention, mobile layout (HTTP fixtures)",
    );
  } finally {
    await browser.close();
  }
})().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
