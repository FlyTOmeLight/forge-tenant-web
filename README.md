# Forge 企业控制台

Vue 3 + TypeScript + Vite 实现的独立企业前端，配套后端为 [forge-tenant-api](https://github.com/FlyTOmeLight/forge-tenant-api)。页面由本仓库构建和部署，包含登录、邀请激活、企业、成员与团队、项目权限、同步、审计和代码修复任务。

## 开发

需要 Node.js 22.12+（建议 24）和 npm。依赖以 `package-lock.json` 为准。

```sh
npm ci
npm run dev
npm run build
```

开发服务固定使用 `http://127.0.0.1:8383`，API 代理默认 `http://127.0.0.1:8484`，可通过 `API_PROXY_TARGET` 修改。后端 `PUBLIC_URL` 和 OIDC 回调必须与浏览器入口一致。运行 Vite 前释放已占用的 8383 端口；将后端 Service 转发至 8484：

```sh
kubectl --context orbstack -n forge-tenant port-forward service/forge-tenant 8484:80
```

生产构建产出 `dist/`，由独立 Nginx 镜像服务。Go 镜像不包含前端代码。

## Kubernetes / Helm

后端先部署到同 namespace。前端独立构建和发布：

```sh
FORGE_IMAGE_TAG=0.2.0 ./scripts/deploy-lab.sh
kubectl --context orbstack -n forge-tenant port-forward service/forge-tenant-web 8383:80
```

Chart：`charts/forge-tenant-web`。默认上游为 `http://forge-tenant`；分 namespace 时通过 `api.upstream` 指定后端 Service DNS。镜像必须可被集群获取，OrbStack 可直接使用本机 Docker 镜像。远程集群设置可访问的 `image.repository` 与不可变版本号。

前端 Nginx 提供静态页面，并转发 `/api/`、`/auth/`、`/internal/` 到后端。这样前后端可独立构建、发布、扩缩容，浏览器会话仍保持同源，使用 HttpOnly Cookie 与 CSRF 校验。前端不持有 GitLab 管理令牌、OIDC client secret 或服务端密钥。公开部署启用前端 Chart 的 TLS Ingress，后端 `PUBLIC_URL` 同步配置为该 HTTPS origin。

## 目录

```text
src/views/         Vue 页面：Console、Login、Invitation、Tasks
src/components/    表单弹窗、状态标记
src/api.ts         HTTP、CSRF 与幂等请求
src/types.ts       页面使用的接口类型
src/styles/        统一企业界面样式
charts/            前端 Helm Chart
scripts/           本机部署和控制台启动
tests/             真实环境端到端测试
```

沿用原控制台的企业视觉样式，使用 Vue 响应式状态、组件、模板和表单绑定，不运行旧版 DOM 拼接脚本。主要页面地址为 `/`、`/invite`、`/login/oauth/authorize`、`/tasks`；组织页面支持 `#members`、`#projects` 等导航。

## 验证

```sh
npm run build
npm audit --audit-level=high
helm lint charts/forge-tenant-web
LAB_CONFIG=/path/to/lab/infra.json npm run test:e2e
LAB_CONFIG=/path/to/lab/infra.json npm run test:tasks-smoke
```

E2E 默认从兄弟仓库 `../forge-tenant-api/.local/deployment.json` 读取测试配置，支持 `FORGE_CONFIG` 覆盖。暂停并恢复 Worker 的检查从 `FORGE_API_ROOT`（默认兄弟后端仓库）读取后端 Chart。测试会创建独立租户、用户和项目，并修改测试授权。结果与截图放 `.local/`，不提交凭证或登录会话。

`npm run test:tasks` 为现有真实执行器试点验收，会启动/停止任务、调用模型并更新试点 MR，需提供 `TASK_PILOT_CONFIG`。本次拆分的验证范围和结果见 [docs/verification.md](docs/verification.md)。

## 依赖选择

Vue 提供组件与响应式表单，Vite 负责 SFC 编译和生产打包；TypeScript / vue-tsc 验证模板和接口类型。均使用官方 npm 包、锁定版本，Vue/Vite 采用 MIT 许可证。Playwright 只用于开发验证。没有引入 Casdoor 前端或 UI SDK。

任务 smoke 使用上述 E2E 创建的测试项目，验证 MR 关联、审查和停止确认协议，不运行模型；完整试点测试单独执行。代码格式由 `npm run format` 统一，CI 执行 `npm run format:check`。

## 本次独立验证环境

为保留另一会话对原平台的并行修改，本轮使用 namespace `forge-tenant-split`、独立 PostgreSQL 和 OIDC client `forge-tenant-split-console`，浏览器入口为 `http://127.0.0.1:8483`。该环境中的企业和项目是验收数据；原 `forge-tenant` / 8383 及其数据未被切换或覆盖。

继续更新此验证环境时使用 `FORGE_NAMESPACE=forge-tenant-split FORGE_IMAGE_TAG=0.2.0-final ./scripts/deploy-lab.sh`。前端 E2E 同时设置 `FORGE_NAMESPACE=forge-tenant-split`。本机端口转发命令：

```sh
kubectl --context orbstack -n forge-tenant-split port-forward service/forge-tenant-web 8483:80
```

本轮迁移以开始时的功能快照为准，包括当时的 MR 关联任务；开发过程中新增的项目执行配置、直接创建问题任务等留在原仓库，后续单独迁入。
