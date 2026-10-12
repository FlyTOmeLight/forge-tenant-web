# Forge 企业控制台

Vue 3 + TypeScript + Vite 实现的独立企业前端，租户后端为 [forge-tenant-api](https://github.com/FlyTOmeLight/forge-tenant-api)，研发后端为 [forge-coding-api](https://github.com/FlyTOmeLight/forge-coding-api)。页面由本仓库构建和部署，包含登录、邀请激活、企业、成员与团队、项目权限、同步、审计和代码修复任务。

## 开发

需要 Node.js 22.12+（建议 24）和 npm。依赖以 `package-lock.json` 为准。

```sh
npm ci
npm run dev
npm run build
```

开发服务固定使用 `http://127.0.0.1:8383`，API 代理默认 `http://127.0.0.1:8484`，可通过 `API_PROXY_TARGET` 修改；研发接口代理使用 `CODING_PROXY_TARGET`，默认 http://127.0.0.1:8485。后端 `PUBLIC_URL` 和 OIDC 回调必须与浏览器入口一致。运行 Vite 前释放已占用的 8383 端口；将后端 Service 转发至 8484：

```sh
kubectl --context orbstack -n forge-tenant-split port-forward service/forge-tenant 8484:80
```

生产构建产出 `dist/`，由独立 Nginx 镜像服务。Go 镜像不包含前端代码。

## Kubernetes / Helm

后端先部署到同 namespace。前端独立构建和发布：

```sh
FORGE_IMAGE_TAG=0.2.0 ./scripts/deploy-lab.sh
kubectl --context orbstack -n forge-tenant-split port-forward service/forge-tenant-web 8483:80
```

Chart：`charts/forge-tenant-web`。默认上游为 `http://forge-tenant`；分 namespace 时通过 `api.upstream` 指定后端 Service DNS。镜像必须可被集群获取，OrbStack 可直接使用本机 Docker 镜像。远程集群设置可访问的 `image.repository` 与不可变版本号。

前端 Nginx 将任务、执行配置和接入状态请求转发到 `coding.upstream`（默认 http://forge-coding），其他 `/api/` 和 `/auth/` 转发到租户后端。公共 `/internal/` 路径返回 404。这样前后端可独立构建、发布、扩缩容，浏览器会话仍保持同源，使用 HttpOnly Cookie 与 CSRF 校验。前端不持有 GitLab 管理令牌、OIDC client secret 或服务端密钥。公开部署启用前端 Chart 的 TLS Ingress，后端 `PUBLIC_URL` 同步配置为该 HTTPS origin。

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
FORGE_NAMESPACE=forge-tenant-split FORGE_INTERNAL_URL=http://127.0.0.1:18484 LAB_CONFIG=/path/to/lab/infra.json npm run test:e2e
FORGE_CODING_PILOT=/path/to/pilot.json npm run test:tasks
```

E2E 默认从兄弟仓库 `../forge-tenant-api/.local/deployment.json` 读取测试配置，支持 `FORGE_CONFIG` 覆盖。暂停并恢复 Worker 的检查从 `FORGE_API_ROOT`（默认兄弟后端仓库）读取后端 Chart。测试会创建独立租户、用户和项目，并修改测试授权。结果与截图放 `.local/`，不提交凭证或登录会话。

`npm run test:tasks` 通过真实模型修复专用测试项目并创建 Draft MR，需要 `FORGE_CODING_PILOT` 指向包含 tenant_id、project_id 和 model 的测试配置。项目必须预置 src/calc.py 的零计数错误与 src/test_calc.py，且已配置独立工具环境。内部撤权事件验收使用 FORGE_INTERNAL_URL 指向租户后端本机端口转发，不经过公共网关。本次拆分的验证范围和结果见 [docs/verification.md](docs/verification.md)。

## 依赖选择

Vue 提供组件与响应式表单，Vite 负责 SFC 编译和生产打包；TypeScript / vue-tsc 验证模板和接口类型。均使用官方 npm 包、锁定版本，Vue/Vite 采用 MIT 许可证。Playwright 只用于开发验证。没有引入 Casdoor 前端或 UI SDK。

旧的 claim 协议验收脚本已移除；新的任务验收调用 Agentic Kit。代码格式由 `npm run format` 统一，CI 执行 `npm run format:check`。

## 当前本机环境

当前工作台部署在 namespace `forge-tenant-split`，浏览器入口为 `http://127.0.0.1:8483`。租户后端使用 OIDC client `forge-tenant-split-console`。旧版一体化平台和静态租户预览部署已退役，当前原型由本仓库维护。

部署脚本默认使用当前命名空间。更新时用 `FORGE_IMAGE_TAG=<版本> ./scripts/deploy-lab.sh`。前端 E2E 默认使用同一命名空间。本机端口转发命令：

```sh
kubectl --context orbstack -n forge-tenant-split port-forward service/forge-tenant-web 8483:80
```

后续功能已迁入：项目执行配置与接入检查、直接新建问题任务、多审查者、每轮配置快照、Agent 判断、代码差异，以及统一导航下的三种任务布局。研发业务现已迁到独立 forge-coding-api，真实模型交付结果见该仓库的验证记录。

## 任务工作台与原型

工作区导航为“我的任务”“待我审查”“项目”。“我的任务”只显示本人负责的任务；项目内可查看该项目全部任务。租户管理员额外看到成员与团队、权限同步、审计记录。平台管理入口独立，切换后隐藏租户选择器。

项目详情按 `/#project/<project-id>/tasks`、`/members`、`/execution` 分为任务、成员与权限、执行配置。平台入口为 `/#platform/tenants` 和 `/#platform/connections`。创建租户必须明确指定首位租户管理员，平台管理员不会自动加入租户。

后端返回命名权限，菜单、按钮和直接链接据此限制访问。租户管理员不自动获得项目代码权限；项目管理员可管理该项目成员，不能操作租户设置。审查者与负责人从项目协作名单选择。任务详情支持概览、代码差异与补丁下载、评论、检查/模型判断/人工认可、轮次配置及活动记录。

`/prototype.html` 使用同一 Vue 页面和显式本地传输层，提供角色切换、接受邀请、状态事件模拟和重置；不会调用真实 API。`npm run export:prototype` 输出 `dist/forge-prototype.html`，可以离线打开。

```sh
npm run export:prototype
FORGE_PROTOTYPE_URL="file://$PWD/dist/forge-prototype.html" npm run test:prototype
```

真实研发链路使用 `npm run test:tasks`，会修改配置明确指定的试点仓库。

## 角色、团队与权限查询

- **我的权限**：每位成员可查看租户角色、所属团队、项目有效角色、具体操作能力和授权来源。
- **角色与权限**：租户设置内展示内置角色及其操作边界。租户角色在成员设置中分配，项目角色在项目内分配。
- **成员与团队 → 查看权限**：租户管理员查看成员的完整权限；团队页支持添加、移出成员，一个人可加入多个团队。
- **项目 → 成员与权限**：分别管理个人直接角色和团队角色。列表展示聚合目标、当前有效角色、来源和 GitLab 同步状态。

项目权限取各来源最高角色。移出团队或撤销一条授权时，其余来源保留。团队角色最终同步为 GitLab 的每人项目角色。任务负责人、指定审查者和受保护分支的限制继续生效。

前后端配套使用版本 5 数据结构；原型使用独立演示存储版本，重置后可演练团队角色继承与撤销。

## Forge → GitLab 单点登录

API/Web `0.7.0-sso` 将两个应用的浏览器授权入口统一到 Forge 登录页。登录一次 Forge 后，点击项目或 MR 链接即可自动进入 GitLab，并保留原目标页面。升级前会话需要退出 Forge 后重新登录一次。

`npm run test:sso` 使用现有测试管理员和已有可访问 MR 验证单点登录，不创建或修改 MR；结果保存在 `.local/sso-evidence/`。完整租户、权限与项目单点登录回归仍使用 `npm run test:e2e`。身份提供方配置步骤见后端 README 的“本机 Forge → GitLab 单点登录”。

### Agent 运行过程

任务详情始终显示最近一轮的运行阶段、耗时和最后活动时间。选择“运行过程”可切换历史轮次，查看 Agent 的公开回复、工具名称、调用参数、返回结果、耗时及停止原因。活动轮次每 2 秒读取新事件；刷新页面按事件序号回放。更新失败会明确标记并保留已读取记录。查看记录不会恢复或启动任务。运行时私有 checkpoint 不进入浏览器。

`FORGE_TRACE_FIXTURE=/path/to/task-detail.json npm run test:trace` 使用真实登录及受控任务/事件响应验证实时更新、分页重连、历史切换、失败展示与移动布局，不启动真实任务。待部署构建可加 `FORGE_TRACE_LOCAL_BUILD=1`。
