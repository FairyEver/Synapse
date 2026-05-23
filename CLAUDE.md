# Synapse

跨编辑器的 Rules / Skills / Prompts 管理桌面应用。用户通过 Synapse 创建、版本管理、安装内容到 Claude Code / Codex / Cursor 等编辑器。

## 规则入口

具体硬约束以 `AGENTS.md` 和 `.claude/rules/` 为准。进入本仓库后先读：

- `AGENTS.md`
- `.claude/rules/design.md`
- `.claude/rules/ui-rules.md`

`CLAUDE.md` 只保留 Claude Code 的项目入口上下文；不要在这里维护另一套完整规则，避免与 `AGENTS.md` 漂移。

## 技术栈

- Electron 41 + Vite 8 + React 19 + TypeScript 6
- shadcn/ui (radix-nova preset) + Tailwind CSS 4
- pnpm monorepo（`desktop/` + `website/` + `server/`）
- Git-based 内容存储 + SQLite Database

## 仓库速览

```text
desktop/
├── electron/           # 主进程：runtime / bootstrap / services / database
├── src/                # 渲染进程：React SPA
│   ├── app-shell/      # 壳层：Context Providers / Navigation / Logging
│   ├── modules/        # 功能模块
│   ├── components/ui/  # shadcn 组件库
│   ├── hooks/          # 共享 hooks
│   ├── lib/            # 工具函数
│   └── types/          # 类型定义
website/                # VitePress 文档站
server/                 # 服务端与管理后台相关代码
```

渲染进程通过 `window.synapse.*` preload bridge 与主进程通信。主进程、preload、renderer 边界要求见 `AGENTS.md`。

## 常用命令

```bash
pnpm dev:website
pnpm dev:server
pnpm dev:desktop
pnpm quit
```

除非用户明确要求，不要为了验证主动启动 dev server 或打开运行中的应用页面。

## 规则索引

| 文件 | 覆盖范围 |
|------|----------|
| `AGENTS.md` | 仓库权威规则、模块设计索引、架构硬约束、放置规则 |
| `.claude/rules/design.md` | 视觉基线、颜色 token、字体、组件风格、主题切换 |
| `.claude/rules/ui-rules.md` | UI 编写规则、Tailwind 使用边界、className 纪律、用户文案 |
| `.claude/rules/frontend.md` | 前端架构约定、状态管理、IPC 通信、模块组织 |
| `.claude/rules/api.md` | 主进程 service / IPC handler 设计约定 |
| `.claude/rules/testing.md` | 测试策略与规则 |
| `.claude/rules/workspace-dev-ports.md` | 子包 dev 端口分配 |
| `.claude/rules/website-copy.md` | 文档站文案规范 |
