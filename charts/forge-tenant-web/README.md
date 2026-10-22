# Forge 前端 Helm 部署

本 Chart 由 forge-tenant-web 维护，管理前端 Deployment、Service、Nginx ConfigMap 和可选 Ingress。租户、Agent、Coding、Artifact 与 Storage 服务分别部署；这里通过 upstream 配置它们的地址。

## 功能开关与 umbrella 安装

Chart 版本为 `0.3.0`。`fullnameOverride` 覆盖 Deployment、Service、Ingress、selector 和 ConfigMap 引用；独立安装默认继续使用 release 名。

`coding.enabled` 默认为 `true`，`agent.enabled` 默认为 `false`；部署 Agent 服务后再显式开启并配置其 upstream。设为 `false` 时，Nginx 对相应 API 返回带说明的 JSON 404，不渲染或解析该 upstream；前端导航和直接路由同时关闭。关闭 Coding 后默认进入项目，保留项目接入、项目成员与授权、租户成员、角色和权限页面。公开 `/runtime-config.json` 由 Chart 的两个开关生成，不包含凭据。

父 chart 设置 `global.forge.enabled=true` 时，资源名默认为 `<release>-web`，API 指向 `https://<release>-tenant.<namespace>.svc:8443`，Artifact 与 Storage 指向 `https://<release>-artifact.<namespace>.svc:8443`，信任包使用 `<release>-web-trust` ConfigMap（键为 `ca-certificates.crt`）。这些 upstream 与 trust bundle 由父安装布局推导；`fullnameOverride` 仍优先。父 chart 可通过子 values 将两个功能开关关闭。

## OrbStack

当前 OrbStack 部署统一使用相邻 `artifact-go` 仓库的 `charts/forge` umbrella chart，release 与 namespace 均为 `forge`。父 chart 负责部署输入、后端服务和信任配置。本目录中已退役环境的独立 OrbStack overlay 已删除，部署输入统一由父 chart 提供。

| 浏览器路径 | 配置 |
| --- | --- |
| `/api/`、`/auth/` 默认路由 | `api.upstream` |
| 租户或项目下的 Agent、模板、评测、数据集路由 | `agent.upstream` |
| 项目任务、Coding 设置、候选发布和平台连接 | `coding.upstream` |
| `/artifact/v1/` | `artifact.upstream` |
| `/storage/v1/` | `storage.upstream` |

Artifact 与 Storage 地址留空时对应路径返回 404；`/internal/` 不向浏览器开放。浏览器文件内容通过 S3/STS 直传，Nginx 仅代理元数据 API。独立安装使用 HTTPS 上游时需引用包含 `ca-certificates.crt` 的 ConfigMap；当前 umbrella 安装按前述规则生成信任包。
