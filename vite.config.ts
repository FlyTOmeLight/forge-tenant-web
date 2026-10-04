import { defineConfig } from "vite";
import vue from "@vitejs/plugin-vue";
const target = process.env.API_PROXY_TARGET || "http://127.0.0.1:8484";
export default defineConfig({
  plugins: [vue()],
  server: {
    port: 8383,
    strictPort: true,
    proxy: {
      "^/api/v1/(tenants/[^/]+/projects/[^/]+/(tasks|coding-settings)(/|$)|platform/connections$)":
        { target: process.env.CODING_PROXY_TARGET || "http://127.0.0.1:8485" },
      ...Object.fromEntries(
        ["/api/", "/auth/", "/internal/"].map((path) => [path, { target }]),
      ),
    },
  },
});
