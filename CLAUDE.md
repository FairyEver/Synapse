# Synapse

跨编辑器的 Rules / Skills / Prompts 管理桌面应用。用户通过 Synapse 创建、版本管理、安装内容到 Claude Code / Codex / Cursor 等编辑器。

## 技术栈

- Electron 41 + Vite 8 + React 19 + TypeScript 6
- shadcn/ui (radix-nova preset) + Tailwind CSS 4
- pnpm monorepo（`desktop/` + `website/` + `server/`）
- Git-based 内容存储 + SQLite Database

## 架构速览

```
desktop/
├── electron/           # 主进程：IPC handlers + services + database
│   ├── ipc/            # 按领域拆分的 IPC handler（content / repository / editor / identity / config …）
│   ├── services/       # 业务逻辑（content-service / repository-git-service / editor-adapters / …）
│   └── database/     # SQLite 数据层，提供 CLI / MCP / HTTP / IPC 四种访问接口
├── src/                # 渲染进程：React SPA
│   ├── app-shell/      # 壳层：Context Providers / Navigation / Logging
│   ├── modules/        # 功能模块：rules / skills / prompts / content / cli / database / settings
│   ├── components/ui/  # shadcn 组件库
│   ├── hooks/          # 共享 hooks
│   ├── lib/            # 工具函数（electron-bridge / markdown / config）
│   ├── types/          # 类型定义
│   └── config/         # 内容类型定义 & 分类
website/                # VitePress 文档站
```

渲染进程通过 `window.synapse.*` preload bridge 与主进程通信，IPC channel 命名 `synapse:<domain>:<action>`。

## 常用命令

```bash
pnpm dev                    # 启动 website、desktop、Postgres、Prisma migrate、server
pnpm quit                   # 停止本地开发进程并关闭 server compose 服务
```

dev 端口：desktop 5173 / website 5174，详见 `.claude/rules/workspace-dev-ports.md`。

## 编码规范

- 不写 `any`，宁可拆函数也不要断言
- 组件优先组合 shadcn 原语，不自造 div + class
- 错误处理：网络/文件 IO 必须 try/catch；内部纯函数不兜错
- 路径别名：`@/*` → `./src/*`

## Synapse MCP 快捷指令

当消息中出现 "sss" 时，将其理解为 Synapse Services Shortcut，并使用 `synapse-database` MCP 中与意图匹配的工具。

- 涉及数据库、表、字段、记录、SQL、Database、数据增删改查时，使用 Database 相关工具。
- 涉及定时任务、调度、cron/interval、启停、运行记录或 runtime 状态时，使用 scheduler 相关工具。
- 只出现 "sss" 但领域不明确时，先根据上下文判断；仍不明确就问一句简短澄清。

## 模块化规则索引

详细规范拆分到 `.claude/rules/`，按需自动加载：

| 文件 | 覆盖范围 |
|------|----------|
| `design.md` | 视觉基线、颜色 token、字体、组件风格、主题切换 |
| `ui-rules.md` | UI 编写规则、Tailwind 使用边界、className 纪律、用户文案 |
| `frontend.md` | 前端架构约定、状态管理、IPC 通信、模块组织 |
| `api.md` | 主进程 service / IPC handler 设计约定 |
| `testing.md` | 测试策略与规则 |
| `workspace-dev-ports.md` | 子包 dev 端口分配 |
| `website-copy.md` | 文档站文案规范：调性、禁止清单、术语一致性、结构要求 |
