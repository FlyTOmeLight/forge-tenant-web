const assert = require("node:assert/strict");
const http = require("node:http");
const { once } = require("node:events");
const { spawn } = require("node:child_process");
const path = require("node:path");

const root = path.resolve(__dirname, "..");
const originalHeaders = {
  Cookie: "forge_session=metadata-test-session",
  Origin: "https://forge.example.test",
  "X-CSRF-Token": "metadata-test-csrf",
  "X-Tenant-ID": "metadata-test-tenant",
  "X-Project-ID": "metadata-test-project",
};

// http.request preserves traversal segments; fetch normalizes them before sending.
function request(port, requestPath, options = {}) {
  return new Promise((resolve, reject) => {
    const body = options.body || "";
    const req = http.request(
      {
        host: "127.0.0.1",
        port,
        path: requestPath,
        method: options.method || "GET",
        headers: {
          ...options.headers,
          ...(body ? { "Content-Length": Buffer.byteLength(body) } : {}),
        },
      },
      (res) => {
        let data = "";
        res.setEncoding("utf8");
        res.on("data", (chunk) => (data += chunk));
        res.on("end", () => resolve({ status: res.statusCode, body: data }));
      },
    );
    req.setTimeout(3000, () =>
      req.destroy(new Error("request deadline exceeded")),
    );
    req.on("error", reject);
    req.end(body);
  });
}

async function availablePort() {
  const server = http.createServer();
  server.listen(0, "127.0.0.1");
  await once(server, "listening");
  const port = server.address().port;
  await new Promise((resolve) => server.close(resolve));
  return port;
}

async function withVite(enabled, target, run) {
  const port = await availablePort();
  const env = { ...process.env };
  delete env.ARTIFACT_PROXY_TARGET;
  delete env.STORAGE_PROXY_TARGET;
  if (enabled) {
    env.ARTIFACT_PROXY_TARGET = target;
    env.STORAGE_PROXY_TARGET = target;
  }
  const child = spawn(
    process.execPath,
    [
      "node_modules/vite/bin/vite.js",
      "--host",
      "127.0.0.1",
      "--port",
      String(port),
    ],
    { cwd: root, env, stdio: ["ignore", "pipe", "pipe"] },
  );
  const exited = once(child, "exit");
  let logs = "";
  child.stdout.on("data", (data) => (logs += data));
  child.stderr.on("data", (data) => (logs += data));
  try {
    const deadline = Date.now() + 10000;
    while (true) {
      if (child.exitCode !== null) throw new Error(`Vite exited: ${logs}`);
      try {
        if ((await request(port, "/")).status === 200) break;
      } catch {}
      if (Date.now() >= deadline)
        throw new Error(`Vite startup timed out: ${logs}`);
      await new Promise((resolve) => setTimeout(resolve, 50));
    }
    await run(port);
  } finally {
    if (child.exitCode === null) child.kill("SIGTERM");
    const timer = setTimeout(() => child.kill("SIGKILL"), 3000);
    try {
      await exited;
    } finally {
      clearTimeout(timer);
    }
  }
}

async function main() {
  const received = [];
  const upstream = http.createServer((req, res) => {
    let body = "";
    req.setEncoding("utf8");
    req.on("data", (chunk) => (body += chunk));
    req.on("end", () => {
      received.push({ path: req.url, headers: req.headers, body });
      res.setHeader("Content-Type", "application/json");
      res.end(JSON.stringify(received.at(-1)));
    });
  });
  upstream.listen(0, "127.0.0.1");
  await once(upstream, "listening");
  const target = `http://127.0.0.1:${upstream.address().port}`;
  try {
    for (const enabled of [false, true]) {
      await withVite(enabled, target, async (port) => {
        for (const namespace of ["artifact", "storage"]) {
          const blocked = [
            `/${namespace}`,
            `/${namespace}/`,
            `/${namespace}/internal/v1/test`,
            `/${namespace}/v1/../../internal/v1/test`,
            `/${namespace}/v1/%2e%2e/%2e%2e/internal/v1/test`,
            `/${namespace}/v1/../../api/v1/me`,
            `/${namespace}/v1/../../${namespace}/internal/v1/test`,
          ];
          if (!enabled) blocked.push(`/${namespace}/v1/test`);
          for (const requestPath of blocked) {
            const before = received.length;
            const response = await request(port, requestPath);
            assert.equal(
              response.status,
              404,
              `reserved path leaked: ${requestPath}`,
            );
            assert.equal(
              received.length,
              before,
              `blocked request reached upstream: ${requestPath}`,
            );
          }
          if (!enabled) continue;
          const response = await request(
            port,
            `/${namespace}/v1/test?query=original`,
            {
              method: "POST",
              body: "{}",
              headers: originalHeaders,
            },
          );
          assert.equal(response.status, 200);
          const echoed = JSON.parse(response.body);
          assert.equal(echoed.path, "/v1/test?query=original");
          assert.equal(echoed.body, "{}");
          for (const [name, value] of Object.entries(originalHeaders)) {
            assert.equal(echoed.headers[name.toLowerCase()], value);
          }
          const noOrigin = await request(port, `/${namespace}/v1/test`);
          assert.equal(noOrigin.status, 200);
          assert.equal(JSON.parse(noOrigin.body).headers.origin, undefined);
        }
      });
      console.log(
        `metadata proxy ${enabled ? "enabled" : "disabled"}: routes, raw traversal and headers passed`,
      );
    }
  } finally {
    await new Promise((resolve) => upstream.close(resolve));
  }
}

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
