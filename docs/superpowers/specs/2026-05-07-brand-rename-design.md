# Synapse → Synapse AI Studio 品牌重命名

## 概述

将所有用户可见的 "Synapse" 品牌名称改为 "Synapse AI Studio"，代码层面（变量、路径、IPC channel）保持 synapse 不变。

## 规则

| 类别 | 处理方式 |
|------|----------|
| 用户可见的品牌名称 | → Synapse AI Studio |
| Synapse Bot（Git 身份） | 保持不变 |
| appId / CLI 命令名 / CLI help | 保持不变 |
| 代码层面（变量、路径、IPC） | 保持不变 |
| MCP/CLI 错误信息 | 保持不变（属于 CLI 层面） |

## 修改清单

### 桌面应用核心

1. `desktop/package.json`
   - `productName: "Synapse"` → `"Synapse AI Studio"` (2 处：顶层 + build section)
   - macOS 权限描述 × 3："Synapse 需要访问..." → "Synapse AI Studio 需要访问..."

2. `desktop/index.html`
   - `<title>Synapse</title>` → `<title>Synapse AI Studio</title>`

3. `desktop/electron/bootstrap/main-window.ts`
   - 窗口标题 `Synapse ${version}` → `Synapse AI Studio ${version}`

4. `desktop/electron/services/tray-service.ts`
   - `tray.setToolTip("Synapse")` → `"Synapse AI Studio"`
   - 菜单项 `"显示 Synapse"` → `"显示 Synapse AI Studio"`

5. `desktop/electron/services/update-service.ts`
   - 更新对话框 `title: "Synapse"` → `"Synapse AI Studio"`

6. `desktop/electron/main.ts`
   - 启动失败对话框 `"Synapse 启动失败"` → `"Synapse AI Studio 启动失败"`

7. `server/admin/index.html`
   - `<title>Synapse Admin</title>` → `<title>Synapse AI Studio Admin</title>`

### 应用内 UI

8. `desktop/src/modules/settings/components/about-panel.tsx`
   - alt 文本 + h1 标题

9. `desktop/src/app-shell/components/empty-repository-state.tsx`
   - 初始化确认文案、alt 文本、欢迎标题

10. `desktop/src/app-shell/components/license-gate.tsx`
    - alt 文本

11. `desktop/src/modules/editor-scan/components/scan-item-card.tsx` + `scan-item-detail-dialog.tsx`
    - 来源标签 "Synapse" → "Synapse AI Studio"
    - tooltip "由 Synapse 安装" → "由 Synapse AI Studio 安装"

12. `desktop/src/lib/diagnostics-summary.ts`
    - 诊断报告标题和版本行

13. `desktop/electron/database/ipc-handlers.ts`
    - 文件对话框过滤器名 "Synapse Table Export" → "Synapse AI Studio Table Export"

### 错误提示

14. Bridge 错误提示（6 处）：
    - `desktop/src/lib/electron-bridge.ts`
    - `desktop/src/app-shell/user-profile.ts`
    - `desktop/src/app-shell/identity.ts`
    - `desktop/src/app-shell/content.ts`
    - `desktop/src/app-shell/config-backup.ts`
    - `desktop/src/app-shell/editor-install-status.ts`
    - `desktop/src/app-shell/editor-copy.ts`

15. Service 错误提示（3 处）：
    - `desktop/electron/services/repository-maintenance-service.ts` — "无法初始化 Synapse 提交身份"
    - `desktop/electron/services/user-profile-service.ts` — 同上
    - `desktop/electron/services/content-submission-service.ts` — 同上

### 其他主进程

16. `desktop/electron/services/builtin-content-service.ts`
    - `BUILTIN_AUTHOR_NAME = "Synapse"` → `"Synapse AI Studio"`

17. `desktop/electron/services/bridge-adapter/bridge-adapter-service.ts`
    - host `name: "Synapse"` → `"Synapse AI Studio"`

18. `desktop/electron/services/agent-runtime/adapters/codex-app-server-session.ts`
    - `title: "Synapse Codex Agent"` → `"Synapse AI Studio Codex Agent"`

### 官网

19. `website/.vitepress/config.mts`
    - `title: 'Synapse'` → `'Synapse AI Studio'`
    - copyright 中的 Synapse

20. `website/index.md`
    - hero name、alt 文本

21. 所有文档 .md 文件中的 "Synapse"（约 50+ 处）：
    - `website/guide/` — concepts.md, editors.md, settings.md, skills.md, rules.md
    - `website/advanced/` — index.md, editor-scan.md, database.md
    - `website/start/` — install.md, first-install.md, repository.md
    - `website/team/` — share-review.md, content-authoring.md, repository-structure.md
    - `website/reference/` — troubleshooting.md, glossary.md, faq.md
    - `website/developer/` — capability-authoring.md, capability-naming-matrix.md, index.md, project-structure.md

### 模板内容

22. `desktop/resources/templates/skills/bark-notification/content.md`
    - 示例中的 "Synapse 打包成功" 等

## 不改的位置

- `com.fairyever.synapse`（appId）— 改了会丢失 macOS 权限授权
- CLI 命令名 `synapse` 及其 help 文本 — 避免破坏用户脚本
- `Synapse Bot`（3 处 Git commit 身份）— 避免 Git 历史不一致
- MCP/CLI 错误信息 "Synapse app is not running" 等 — 属于 CLI 层面
- 所有 import/require 路径、变量名、函数名、类名
- IPC channel 名称（`synapse:*`）
- 文件路径、目录名
- `SynapseAppRelease`（GitHub repo 名）
- `.claude/` 目录下的内容
- `desktop/README.md`、`website/README.md`（仅开发者可见）
- Excel 导出元数据中的 `<Application>Synapse</Application>`（保持简短）
- Keychain entry 注释
- 控制台日志 `[Synapse]`

## 格式规范

完整品牌名：**Synapse AI Studio**
- "Synapse" 首字母大写
- "AI" 全大写
- "Studio" 首字母大写
- 三个词之间各一个空格
