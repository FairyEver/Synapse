# Synapse

跨编辑器的 Rules / Skills / Prompts 管理桌面应用。用户通过 Synapse 创建、版本管理、安装内容到 Claude Code / Codex / Cursor 等编辑器。

## 技术栈

- Electron 41 + Vite 8 + React 19 + TypeScript 6
- shadcn/ui (radix-nova preset) + Tailwind CSS 4
- pnpm monorepo（`desktop/` + `website/` + `server/`）
- Git-based 内容存储 + SQLite Data Store

## 架构速览

```
desktop/
├── electron/           # 主进程：IPC handlers + services + data-store
│   ├── ipc/            # 按领域拆分的 IPC handler（content / repository / editor / identity / config …）
│   ├── services/       # 业务逻辑（content-service / repository-git-service / editor-adapters / …）
│   └── data-store/     # SQLite 数据层，提供 CLI / MCP / HTTP / IPC 四种访问接口
├── src/                # 渲染进程：React SPA
│   ├── app-shell/      # 壳层：Context Providers / Navigation / Logging
│   ├── modules/        # 功能模块：rules / skills / prompts / content / cli / data-store / settings
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

## Data Store 快捷指令

当消息中出现 "sss" 时，使用 synapse-data MCP 工具完成数据操作。sss 是 Synapse Data Store 的缩写。

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
