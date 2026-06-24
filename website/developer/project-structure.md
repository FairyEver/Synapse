# 项目结构

<!-- Sources: AGENTS.md; package.json; pnpm-workspace.yaml; current directories: desktop/; website/; server/; dashboard/; auto/; shared/ -->

Synapse 是 pnpm monorepo。工作区根目录包含共享文档、项目规则、CI 配置和根脚本。主要包包括 `@synapse/desktop`、`@synapse/website`、`@synapse/server`、`@synapse/auto` 和 `@synapse/auto-web`。

## 主要目录

| 目录 | 内容 |
| --- | --- |
| `desktop/` | Electron 桌面端子包。 |
| `website/` | VitePress 文档站。 |
| `server/` | 服务端代码。 |
| `dashboard/` | 管理后台前端。 |
| `auto/` | 自动化相关包。 |
| `shared/` | workspace 共享代码。 |
| `docs/` | 仓库级设计、参考和发布文档。 |

## desktop/

`desktop/` 使用 Electron、React、Tailwind CSS、shadcn/ui 和 TypeScript。

主要代码边界：

| 路径 | 职责 |
| --- | --- |
| `desktop/electron/` | Electron 主进程、service、IPC handler、database 和 runtime。 |
| `desktop/src/` | 渲染进程 React SPA。 |
| `desktop/src/app-shell/` | 壳层状态、导航、日志和全局编排。 |
| `desktop/src/modules/` | 渲染进程业务模块和系统 App。 |
| `desktop/src/components/ui/` | shadcn/ui 基础组件。 |
| `desktop/src/lib/` | 渲染进程共享工具函数。 |
| `desktop/src/types/` | 渲染进程共享类型。 |
| `desktop/synapse-capabilities/` | MCP capability registry、命名和共享 schema。 |
| `desktop/app-capabilities/` | 同时提供 App UI、MCP 或 Workflow node 的能力包。 |
| `desktop/workflow-nodes/` | Workflow 节点定义、面板、执行器和卡片。 |
| `desktop/action-packages/` | Automation executor 包。 |
| `desktop/automation-trigger-packages/` | Automation trigger 包。 |

## website/

`website/` 是文档站，不包含桌面端运行逻辑。修改网站时优先更新 Markdown 和 `.vitepress/config.mts`，不要把产品实现逻辑复制到文档站。

## workspace 入口

根目录 `package.json` 暴露常用入口：

```bash
pnpm dev
pnpm dev:desktop
pnpm dev:server
pnpm dev:website
pnpm quit
pnpm quit:desktop
pnpm quit:server
pnpm quit:website
```

根据当前任务选择最小启动范围。只改 `website/` 时使用：

```bash
pnpm dev:website
pnpm --filter @synapse/website run build
```
