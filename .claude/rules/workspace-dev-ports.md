---
name: workspace-dev-ports
paths:
  - package.json
  - desktop/package.json
  - desktop/scripts/dev/**
  - dashboard/package.json
  - dashboard/vite.config.ts
  - server/package.json
  - server/compose.dev.yml
  - scripts/dev/**
  - document/.vitepress/**
  - auto/src/server.ts
  - auto/web/vite.config.ts
  - templates/shadcn-admin/vite.config.ts
---

# workspace 本地开发端口

本机 HTTP 开发端口按项目划分：Synapse 保留 `19700–19799`，Brick Lab 保留 `19800–19899`。项目区分通过端口完成，不通过 IPv4 / IPv6 各占一个相同端口。

| 子项目 | 本地默认端口 | 配置位置 |
| --- | --- | --- |
| Console / Admin / Drive 网页 | 19700 | `dashboard/vite.config.ts`、`dashboard/package.json` |
| Server API（含 WebSocket） | 19701 | `server/package.json`、根 `package.json`；可由 `SYNAPSE_SERVER_API_PORT` 覆盖 |
| PDF renderer 宿主机映射 | 19702 | `server/compose.dev.yml`、`scripts/dev/run-server-with-env.mjs`；可由 `PDF_RENDERER_HOST_PORT` 覆盖 |
| Electron renderer | 19731 | `desktop/scripts/dev/dev-renderer.mjs`、`dev-electron-app.mjs`、`dev.mjs`；可由 `SYNAPSE_DEV_PORT` 覆盖 |
| Auto 本地工具 | 19760 | `auto/src/server.ts` |
| Auto 网页单独开发 | 19761 | `auto/web/vite.config.ts` |
| shadcn-admin 模板 | 19762 | `templates/shadcn-admin/vite.config.ts` |
| VitePress 文档站 | 19773 | `document/.vitepress/config.mts` |

根 `pnpm dev` 启动 Desktop、Server、Document；Server 入口同时启动 API、dashboard、Postgres 和 PDF renderer。Auto 与模板是按需命令，不随根 `pnpm dev` 启动。

## 地址与边界

- 浏览器入口使用 `http://localhost:19700/console/`；dashboard 使用 `::` 双栈监听，避免只在 IPv4 上响应。桌面登录、服务端公开链接与文档开发链接同步使用该应用根地址。
- Electron renderer 与 Docker 宿主机映射保留现有回环地址限制；这属于访问边界，不用来区分项目。
- 数据库端口与连接保持原样：本机 PostgreSQL `5433`、容器内部 `5432`。不要为了统一 HTTP 端口号改数据库或迁移数据。
- 生产端口保持原样：宿主机 Synapse `3000`，容器内 Nginx `3000` → API `3001`，PDF renderer `3010`；生产 Compose、Nginx、Caddy 与部署脚本不跟随开发端口修改。
- PDF renderer 仅改变 dev overlay 的宿主机映射；容器内部端口 `3010` 与生产内部网络不变。

## 新增或调整

1. 从本项目保留段中选未分配端口，显式配置 Vite / VitePress / WXT，启用 `strictPort`；不要依赖框架默认端口或自动顺延。
2. 同步所有代理、健康检查、客户端、回调 / 公开链接和停止脚本。
3. 同步本表、frontmatter 的 paths、相关 README 和根发布说明。
4. 桌面端原有多实例探测范围 `19731–19750` 继续保留，不向其他子项目分配该范围。Auto 端口被占用时直接失败，不占用相邻子项目的固定端口。
