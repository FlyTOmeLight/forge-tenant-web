# Forge 前端

- 配套后端与 API 契约见 README 中的 forge-tenant-api 仓库；当前仓库负责 Vue 页面、浏览器交互和前端 Helm 发布。
- 登录页通过后端限定的 Casdoor JSON 端点认证。服务密钥保存在后端，浏览器使用同源 Cookie 和 CSRF。
- 改动后执行 `npm run build`。改变登录、邀请或授权交互时，运行 `tests/e2e.cjs` 的真实环境验收，配置见 README。
- `.local/` 保存私有测试配置和会话，只提交脱敏证据。代码修复完整试点测试会修改 MR，先确认测试目标。
