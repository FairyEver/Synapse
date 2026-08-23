---
name: workspace-dev-ports
paths:
  - package.json
  - desktop/vite.config.ts
  - desktop/scripts/dev*.mjs
  - document/.vitepress/config.*
  - document/vite.config.*
---

# workspace 子包 dev 端口分配

仓库里多个子包都会跑本地 HTTP dev server。用根级 umbrella 命令 `pnpm dev` 并行启动时，如果端口撞车，后启动的子包会直接崩溃（desktop 的 Vite 带 `--strictPort`，不会自动顺延）。这条规则固定每个子包的端口归属，避免冲突。

## 原则

- **`desktop` 独占 5173**：Electron 主进程 dev 下通过 `http://127.0.0.1:5173` 加载渲染端；改动面大（`desktop/scripts/dev-renderer.mjs`、`dev-electron-app.mjs`、`dev.mjs` 都有这个默认值），基线保留不动。
- **其他子包必须显式配非 5173 端口**：在子包自己的 dev 配置里**写死端口号**，不要依赖 Vite / VitePress "端口被占就自动顺延" 的默认行为——`pnpm dev` 并行启动顺序不稳定，会让每次拿到的端口都不一样。
- **端口分配唯一**：同一端口不允许两个子包同时占用。新增子包时从下表往后顺延一个空位。

## 当前端口分配

| 子包 | dev 端口 | 配置位置 |
| --- | --- | --- |
| `@synapse/desktop` | 5173 | `desktop/scripts/dev-renderer.mjs`、`dev-electron-app.mjs`、`dev.mjs`（三处都有默认值，可由 `SYNAPSE_DEV_PORT` 环境变量覆盖） |
| `@synapse/document` | 19773 | `document/.vitepress/config.mts` 的 `vite.server.port` |

## 新增子包时

子包要跑 HTTP dev server（Vite / VitePress / Next.js / Nuxt / webpack-dev-server 等）时：

1. 在"当前端口分配"表里往后挑一个未被占用的端口（例如 5175、5176、5177…）。
2. 在子包自己的 dev 配置里**显式**写死端口。常见位置：
   - **Vite**：`vite.config.ts` 的 `server.port`
   - **VitePress**：`.vitepress/config.*` 的 `vite.server.port`
   - **Next.js**：`package.json` 的 dev 脚本加 `-p <port>`
   - **自定义 node 脚本**：从环境变量或常量里读，并给默认值
3. 同一次提交里更新本规则的"当前端口分配"表和本规则 frontmatter 的 `paths`（把子包配置文件路径加进去，方便 AI 编辑相关文件时自动加载本规则）。

## 禁止事项

- **不要依赖端口自动顺延来规避冲突**：`pnpm dev` 并行启动顺序不稳定，端口随机漂移会让 URL 记忆混乱、也会破坏 Electron 主进程对固定端口的依赖。
- **不要为了"跟 desktop 一致"给其他子包也配 5173**：直接撞车。
- **不要把端口只藏在本地环境变量里**：新机器 / 新成员第一次跑 `pnpm dev` 会直接崩。
- **不要随意改 desktop 的 5173**：要改就同时改 `desktop/scripts/dev-renderer.mjs`、`dev-electron-app.mjs`、`dev.mjs` 三处默认值，并确认 Electron 主进程加载 URL 的逻辑没有硬编码。

## 相关下游

改端口或新增子包端口时，**同一次提交**同步：

- 本规则的"当前端口分配"表
- 本规则 frontmatter 的 `paths`（新增子包时追加配置文件路径）
- 子包 `README.md`（如果 README 里写了 dev URL）
- 顶层 `README.md` / `desktop/README.md` / `document/README.md`（如果列出了 dev URL）
- `AGENTS.md` / `CLAUDE.md`（如果引用了端口）
