import { defineConfig, type Plugin, type ProxyOptions } from "vite";
import vue from "@vitejs/plugin-vue";
const target = process.env.API_PROXY_TARGET || "http://127.0.0.1:8484";
const metadataTargets = {
  artifact: process.env.ARTIFACT_PROXY_TARGET || "",
  storage: process.env.STORAGE_PROXY_TARGET || "",
};
const metadataProxy: Record<string, ProxyOptions> = {};
for (const [name, upstream] of Object.entries(metadataTargets)) {
  if (!upstream) continue;
  const endpoint = new URL(upstream);
  if (
    !["http:", "https:"].includes(endpoint.protocol) ||
    endpoint.username ||
    endpoint.password ||
    endpoint.search ||
    endpoint.hash ||
    endpoint.pathname !== "/"
  )
    throw new Error(`${name} proxy target must be an HTTP(S) origin`);
  metadataProxy[`^/${name}/v1/`] = {
    target: endpoint.origin,
    rewrite: (path) => path.replace(`/${name}/`, "/"),
    // Keep the original host, cookies, Origin and CSRF; no browser credentials are synthesized.
    followRedirects: false,
    secure: true,
  };
}
const metadataBoundary: Plugin = {
  name: "metadata-proxy-boundary",
  configureServer(server) {
    server.middlewares.use((req, res, next) => {
      // Identify the reserved namespace before URL normalization removes traversal segments.
      const rawPath = (req.url || "/").split("?", 1)[0];
      const name = rawPath.match(/^\/(artifact|storage)(?:\/|$)/)?.[1];
      if (!name) return next();
      const path = new URL(req.url || "/", "http://vite.local").pathname;
      const target = metadataTargets[name as keyof typeof metadataTargets];
      if (!target || !path.startsWith(`/${name}/v1/`)) {
        res.statusCode = 404;
        return res.end();
      }
      next();
    });
  },
};
export default defineConfig({
  plugins: [vue(), metadataBoundary],
  server: {
    port: 8383,
    strictPort: true,
    proxy: {
      ...metadataProxy,
      "^/api/v1/(tenants/[^/]+/projects/[^/]+/(tasks|coding-settings)(/|$)|platform/connections$)":
        { target: process.env.CODING_PROXY_TARGET || "http://127.0.0.1:8485" },
      ...Object.fromEntries(
        ["/api/", "/auth/", "/internal/"].map((path) => [path, { target }]),
      ),
    },
  },
});
