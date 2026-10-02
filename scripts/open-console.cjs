const fs = require("node:fs");
const path = require("node:path");
const { chromium } = require("playwright");
(async () => {
  const root = path.resolve(__dirname, "..");
  const config = JSON.parse(
    fs.readFileSync(
      process.env.FORGE_CONFIG ||
        path.resolve(root, "../forge-tenant-api/.local/deployment.json"),
      "utf8",
    ),
  );
  const browser = await chromium.launchPersistentContext(
    path.join(root, ".local/browser-profile"),
    {
      executablePath:
        process.env.CHROME_EXECUTABLE ||
        (process.platform === "darwin"
          ? "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome"
          : undefined),
      headless: false,
      args: ["--no-proxy-server"],
      viewport: null,
    },
  );
  const page = browser.pages()[0] || (await browser.newPage());
  const sessionCheck = page.waitForResponse(
    (r) => new URL(r.url()).pathname === "/api/v1/me",
  );
  await page.goto(config.publicURL);
  if ((await sessionCheck).status() === 401) {
    await page.locator("#username").fill(config.adminUsername);
    await page.locator("#password").fill(config.adminPassword);
    await page.locator("#submit").click();
    await page.waitForURL((u) => u.pathname === "/");
  }
  await page.getByRole("heading", { name: "企业管理", exact: true }).waitFor();
  await page.bringToFront();
  console.log("Forge 控制台已打开并登录，凭证未输出。");
  await new Promise((resolve) => browser.once("close", resolve));
})().catch((e) => {
  console.error(e.message.replace(/https?:\/\/\S+/g, "[URL]"));
  process.exitCode = 1;
});
