# 项目结构

<!-- Sources: AGENTS.md; README.md; pnpm-workspace.yaml; current directories: desktop/; server/; server/admin/; website/; docs/ -->

Synapse 是 pnpm monorepo。`pnpm-workspace.yaml` 注册了 `desktop`、`website` 和 `server` 三个 workspace 包。

## 主要目录

| 目录 | 内容 |
| --- | --- |
| `desktop/` | Electron 桌面端子包，包名为 `@synapse/desktop`。 |
| `server/` | 后端服务 workspace 包。 |
| `server/admin/` | 服务端管理界面目录。 |
| `website/` | VitePress 文档站 workspace 包。 |
| `docs/` | 仓库级文档目录。 |

## desktop/

`desktop/` 使用 Electron、React、Tailwind CSS、shadcn/ui 和 TypeScript。

主要代码边界：

- `desktop/electron/`：Electron 主进程与受权限保护的桌面端逻辑。
- `desktop/src/`：渲染进程代码。
- `desktop/src/modules/`：渲染进程业务模块。
- `desktop/src/components/`：共享 UI 组件。
- `desktop/src/components/ui/`：shadcn/ui 基础组件。
- `desktop/src/app-shell/`：共享 shell 状态与编排。
- `desktop/src/lib/`：共享纯工具函数。
- `desktop/src/types/`：渲染进程范围共享类型。

## workspace 入口

根目录 `package.json` 暴露公共入口：

```bash
pnpm dev
pnpm quit
```

其他包级脚本通过 filter 执行，例如：

```bash
pnpm --filter @synapse/desktop run typecheck
pnpm --filter @synapse/website run build
```
