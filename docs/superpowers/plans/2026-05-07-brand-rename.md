# Synapse → Synapse AI Studio 品牌重命名 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 将所有用户可见的 "Synapse" 品牌名称改为 "Synapse AI Studio"，代码层面保持不变。

**Architecture:** 纯文本替换任务，按文件区域分批执行。每个 Task 覆盖一个逻辑区域，修改后通过 typecheck 验证无破坏。

**Tech Stack:** TypeScript, HTML, Markdown, JSON

---

### Task 1: 桌面应用核心配置

**Files:**
- Modify: `desktop/package.json:3,105,146-148`
- Modify: `desktop/index.html:6`
- Modify: `server/admin/index.html:6`

- [ ] **Step 1: 修改 desktop/package.json**

将 productName（2 处）和 macOS 权限描述（3 处）改为 "Synapse AI Studio"：

```json
// 行 3
"productName": "Synapse AI Studio",

// 行 105 (build section)
"productName": "Synapse AI Studio",

// 行 146-148
"NSDocumentsFolderUsageDescription": "Synapse AI Studio 需要访问文稿文件夹以管理你的内容仓库。",
"NSDesktopFolderUsageDescription": "Synapse AI Studio 需要访问桌面文件夹以管理你的内容仓库。",
"NSDownloadsFolderUsageDescription": "Synapse AI Studio 需要访问下载文件夹以导出内容和备份。"
```

- [ ] **Step 2: 修改 desktop/index.html**

```html
<title>Synapse AI Studio</title>
```

- [ ] **Step 3: 修改 server/admin/index.html**

```html
<title>Synapse AI Studio Admin</title>
```

- [ ] **Step 4: 验证**

Run: `cd desktop && pnpm typecheck`
Expected: 无类型错误

- [ ] **Step 5: Commit**

```bash
git add desktop/package.json desktop/index.html server/admin/index.html
git commit -m "chore: rename brand to Synapse AI Studio in core config"
```

---

### Task 2: Electron 主进程 — 窗口、托盘、对话框

**Files:**
- Modify: `desktop/electron/bootstrap/main-window.ts:41`
- Modify: `desktop/electron/services/tray-service.ts:59,63`
- Modify: `desktop/electron/services/update-service.ts:506`
- Modify: `desktop/electron/main.ts:116`

- [ ] **Step 1: 修改 main-window.ts**

```typescript
// 行 41
title: `Synapse AI Studio ${app.getVersion()}`,
```

- [ ] **Step 2: 修改 tray-service.ts**

```typescript
// 行 59
tray.setToolTip("Synapse AI Studio")

// 行 63
label: "显示 Synapse AI Studio",
```

- [ ] **Step 3: 修改 update-service.ts**

```typescript
// 行 506
title: "Synapse AI Studio",
```

- [ ] **Step 4: 修改 main.ts**

```typescript
// 行 116
"Synapse AI Studio 启动失败",
```

- [ ] **Step 5: 验证**

Run: `cd desktop && pnpm typecheck`
Expected: 无类型错误

- [ ] **Step 6: Commit**

```bash
git add desktop/electron/bootstrap/main-window.ts desktop/electron/services/tray-service.ts desktop/electron/services/update-service.ts desktop/electron/main.ts
git commit -m "chore: rename brand to Synapse AI Studio in electron main process"
```

---

### Task 3: Electron 主进程 — Services

**Files:**
- Modify: `desktop/electron/services/builtin-content-service.ts:23`
- Modify: `desktop/electron/services/bridge-adapter/bridge-adapter-service.ts:853`
- Modify: `desktop/electron/services/agent-runtime/adapters/codex-app-server-session.ts:102`
- Modify: `desktop/electron/database/ipc-handlers.ts:215,230`
- Modify: `desktop/electron/services/repository-maintenance-service.ts:314,319`
- Modify: `desktop/electron/services/user-profile-service.ts:55,60`
- Modify: `desktop/electron/services/content-submission-service.ts:106,111`

- [ ] **Step 1: 修改 builtin-content-service.ts**

```typescript
const BUILTIN_AUTHOR_NAME = "Synapse AI Studio"
```

- [ ] **Step 2: 修改 bridge-adapter-service.ts**

```typescript
host: { id: "synapse", name: "Synapse AI Studio" }
```

- [ ] **Step 3: 修改 codex-app-server-session.ts**

```typescript
title: "Synapse AI Studio Codex Agent"
```

- [ ] **Step 4: 修改 database/ipc-handlers.ts**

```typescript
// 行 215
name: "Synapse AI Studio Table Export"
// 行 230
name: "Synapse AI Studio Table Export"
```

- [ ] **Step 5: 修改 3 个 service 的错误提示**

在 `repository-maintenance-service.ts`、`user-profile-service.ts`、`content-submission-service.ts` 中，将 "无法初始化 Synapse 提交身份" 改为 "无法初始化 Synapse AI Studio 提交身份"。

注意：`SYNAPSE_BOT_NAME = "Synapse Bot"` 保持不变。

- [ ] **Step 6: 验证**

Run: `cd desktop && pnpm typecheck`
Expected: 无类型错误

- [ ] **Step 7: Commit**

```bash
git add desktop/electron/services/ desktop/electron/database/ipc-handlers.ts
git commit -m "chore: rename brand to Synapse AI Studio in electron services"
```

---

### Task 4: 渲染进程 — UI 组件

**Files:**
- Modify: `desktop/src/modules/settings/components/about-panel.tsx:250,257`
- Modify: `desktop/src/app-shell/components/empty-repository-state.tsx:349,377,380`
- Modify: `desktop/src/app-shell/components/license-gate.tsx:77`
- Modify: `desktop/src/modules/editor-scan/components/scan-item-card.tsx:55,60`
- Modify: `desktop/src/modules/editor-scan/components/scan-item-detail-dialog.tsx:350`
- Modify: `desktop/src/lib/diagnostics-summary.ts:103,105`

- [ ] **Step 1: 修改 about-panel.tsx**

```tsx
// 行 250
alt="Synapse AI Studio"
// 行 257
<h1 className="text-lg font-semibold tracking-tight">Synapse AI Studio</h1>
```

- [ ] **Step 2: 修改 empty-repository-state.tsx**

```tsx
// 行 349
该目录尚未包含 Synapse AI Studio 仓库结构，是否将其初始化为 Synapse AI Studio 仓库？

// 行 377
alt="Synapse AI Studio"

// 行 380 — "欢迎使用 Synapse" → "欢迎使用 Synapse AI Studio"
```

- [ ] **Step 3: 修改 license-gate.tsx**

```tsx
// 行 77
alt="Synapse AI Studio"
```

- [ ] **Step 4: 修改 editor-scan 组件**

scan-item-card.tsx:
```tsx
// 行 55
{source === "synapse" ? "Synapse AI Studio" : "外部"}
// 行 60
"由 Synapse AI Studio 安装"
```

scan-item-detail-dialog.tsx:
```tsx
// 行 350
{item.source === "synapse" ? "Synapse AI Studio" : "外部"}
```

- [ ] **Step 5: 修改 diagnostics-summary.ts**

```typescript
// 行 103
"# Synapse AI Studio Diagnostics Summary",
// 行 105
`- 版本：Synapse AI Studio ${formatDiagnosticsValue(report.app.version ?? "unknown")}`,
```

- [ ] **Step 6: 验证**

Run: `cd desktop && pnpm typecheck`
Expected: 无类型错误

- [ ] **Step 7: Commit**

```bash
git add desktop/src/modules/settings/components/about-panel.tsx desktop/src/app-shell/components/empty-repository-state.tsx desktop/src/app-shell/components/license-gate.tsx desktop/src/modules/editor-scan/ desktop/src/lib/diagnostics-summary.ts
git commit -m "chore: rename brand to Synapse AI Studio in renderer UI"
```

---

### Task 5: 渲染进程 — Bridge 错误提示

**Files:**
- Modify: `desktop/src/lib/electron-bridge.ts:4`
- Modify: `desktop/src/app-shell/user-profile.ts:8`
- Modify: `desktop/src/app-shell/identity.ts:5`
- Modify: `desktop/src/app-shell/content.ts:35`
- Modify: `desktop/src/app-shell/config-backup.ts:8`
- Modify: `desktop/src/app-shell/editor-install-status.ts:8`
- Modify: `desktop/src/app-shell/editor-copy.ts:10`

- [ ] **Step 1: 批量替换 bridge 错误提示**

在以上 7 个文件中，将 "当前页面没有加载 Synapse 的" 替换为 "当前页面没有加载 Synapse AI Studio 的"。

每个文件的模式相同：
```typescript
// before
"当前页面没有加载 Synapse 的 Electron bridge..."
// after
"当前页面没有加载 Synapse AI Studio 的 Electron bridge..."
```

- [ ] **Step 2: 验证**

Run: `cd desktop && pnpm typecheck`
Expected: 无类型错误

- [ ] **Step 3: Commit**

```bash
git add desktop/src/lib/electron-bridge.ts desktop/src/app-shell/user-profile.ts desktop/src/app-shell/identity.ts desktop/src/app-shell/content.ts desktop/src/app-shell/config-backup.ts desktop/src/app-shell/editor-install-status.ts desktop/src/app-shell/editor-copy.ts
git commit -m "chore: rename brand to Synapse AI Studio in bridge error messages"
```

---

### Task 6: 官网配置与首页

**Files:**
- Modify: `website/.vitepress/config.mts:5,87`
- Modify: `website/index.md:5,10`

- [ ] **Step 1: 修改 config.mts**

```typescript
// 行 5
title: 'Synapse AI Studio',

// 行 87
copyright: `Copyright © ${new Date().getFullYear()} Synapse AI Studio`
```

- [ ] **Step 2: 修改 index.md**

```yaml
# 行 5
name: Synapse AI Studio
# 行 10
alt: Synapse AI Studio
```

- [ ] **Step 3: Commit**

```bash
git add website/.vitepress/config.mts website/index.md
git commit -m "chore: rename brand to Synapse AI Studio on website homepage"
```

---

### Task 7: 官网文档 — guide/ 与 start/

**Files:**
- Modify: `website/guide/concepts.md`
- Modify: `website/guide/editors.md`
- Modify: `website/guide/settings.md`
- Modify: `website/guide/skills.md`
- Modify: `website/guide/rules.md`
- Modify: `website/start/install.md`
- Modify: `website/start/first-install.md`
- Modify: `website/start/repository.md`

- [ ] **Step 1: 批量替换**

在以上文件中，将独立出现的 "Synapse"（非 "Synapse Bot"、非 URL 路径中的）替换为 "Synapse AI Studio"。

替换规则：
- `Synapse` → `Synapse AI Studio`
- 保留 URL 中的 `Synapse`（如 `github.com/FairyEver/Synapse`）
- 保留 `Synapse Bot`

- [ ] **Step 2: 检查替换结果**

Run: `grep -n "Synapse" website/guide/*.md website/start/*.md | grep -v "Synapse AI Studio" | grep -v "Synapse Bot" | grep -v "github.com"`
Expected: 无遗漏（或仅剩 URL/Bot 相关）

- [ ] **Step 3: Commit**

```bash
git add website/guide/ website/start/
git commit -m "chore: rename brand to Synapse AI Studio in guide & start docs"
```

---

### Task 8: 官网文档 — advanced/, team/, reference/, developer/

**Files:**
- Modify: `website/advanced/index.md`
- Modify: `website/advanced/editor-scan.md`
- Modify: `website/advanced/database.md`
- Modify: `website/team/share-review.md`
- Modify: `website/team/content-authoring.md`
- Modify: `website/team/repository-structure.md`
- Modify: `website/reference/troubleshooting.md`
- Modify: `website/reference/glossary.md`
- Modify: `website/reference/faq.md`
- Modify: `website/developer/capability-authoring.md`
- Modify: `website/developer/capability-naming-matrix.md`
- Modify: `website/developer/index.md`
- Modify: `website/developer/project-structure.md`

- [ ] **Step 1: 批量替换**

同 Task 7 规则：将独立出现的 "Synapse"（非 Bot、非 URL）替换为 "Synapse AI Studio"。

特别注意 `website/team/share-review.md` 中的 "Synapse Bot" 必须保留。

- [ ] **Step 2: 检查替换结果**

Run: `grep -rn "Synapse" website/advanced/ website/team/ website/reference/ website/developer/ | grep -v "Synapse AI Studio" | grep -v "Synapse Bot" | grep -v "github.com" | grep -v "SynapseAppRelease"`
Expected: 无遗漏

- [ ] **Step 3: Commit**

```bash
git add website/advanced/ website/team/ website/reference/ website/developer/
git commit -m "chore: rename brand to Synapse AI Studio in remaining docs"
```

---

### Task 9: 模板内容

**Files:**
- Modify: `desktop/resources/templates/skills/bark-notification/content.md`

- [ ] **Step 1: 替换模板中的 Synapse**

将 "Synapse" 替换为 "Synapse AI Studio"（如 "需要在 Synapse AI Studio 中设置 BARK_ID 变量"、"Synapse AI Studio 打包成功"）。

- [ ] **Step 2: Commit**

```bash
git add desktop/resources/templates/
git commit -m "chore: rename brand to Synapse AI Studio in templates"
```

---

### Task 10: 最终验证

- [ ] **Step 1: 全量 typecheck**

Run: `cd desktop && pnpm typecheck`
Expected: 无错误

- [ ] **Step 2: 运行测试**

Run: `cd desktop && pnpm test`
Expected: 全部通过

- [ ] **Step 3: 全局扫描遗漏**

Run: `grep -rn '"Synapse"' desktop/electron/ desktop/src/ --include="*.ts" --include="*.tsx" | grep -v "Synapse AI Studio" | grep -v "Synapse Bot" | grep -v "synapse:" | grep -v "node_modules" | grep -v "com.fairyever.synapse"`
Expected: 仅剩 appId、Bot、IPC channel、变量名等不需要改的位置

- [ ] **Step 4: 网站扫描遗漏**

Run: `grep -rn "Synapse" website/ --include="*.md" --include="*.mts" | grep -v "Synapse AI Studio" | grep -v "Synapse Bot" | grep -v "github.com" | grep -v "SynapseAppRelease" | grep -v "README.md" | grep -v "node_modules"`
Expected: 无遗漏
