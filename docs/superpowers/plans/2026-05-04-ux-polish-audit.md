# UX 体验打磨审查 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 在内部发布前，修复全应用的体验问题——错误处理盲区、缺失的 loading/空状态、操作反馈不足、危险操作无确认等。

**Architecture:** 按用户旅程 5 个阶段逐段修复。每个 Task 聚焦一个模块或一组紧密相关的文件，修复后独立提交。不改架构、不加功能、不改视觉设计。

**Tech Stack:** React 19, TypeScript, shadcn/ui, Tailwind CSS, Electron IPC

---

### Task 1: IdentityGate 错误处理与恢复路径

**Files:**
- Modify: `desktop/src/app-shell/components/identity-gate.tsx:52-111`

- [ ] **Step 1: 给 error 状态添加重试按钮**

在 `identity-gate.tsx` 第 52-60 行的 error 分支中，添加一个重试按钮。重试逻辑是调用 `window.location.reload()` 重新加载渲染进程。

```tsx
if (error) {
  return (
    <IdentityScreenShell>
      <div className="flex flex-col gap-3">
        <h1 className="text-lg font-medium text-foreground">无法读取身份信息</h1>
        <p className="text-sm text-muted-foreground">{error}</p>
        <Button variant="outline" onClick={() => window.location.reload()}>
          重试
        </Button>
      </div>
    </IdentityScreenShell>
  )
}
```

- [ ] **Step 2: 给"生成新 ID"失败添加用户反馈**

在第 103-107 行的 catch 中，添加 `setRecoveryError`：

```tsx
.catch((generationError) => {
  logger.error("Failed to generate new identity from gate.", {
    elapsedMs: Math.round(performance.now() - startedAt),
    error: generationError,
  })
  setRecoveryError(generationError instanceof Error ? generationError.message : "生成新 ID 失败，请重试。")
})
```

- [ ] **Step 3: 验证修改**

Run: `cd desktop && npx tsc --noEmit --pretty 2>&1 | head -20`
Expected: 无类型错误

- [ ] **Step 4: Commit**

```bash
git add desktop/src/app-shell/components/identity-gate.tsx
git commit -m "fix: add retry button and error feedback to IdentityGate"
```

---

### Task 2: EmptyRepositoryState 操作反馈与错误处理

**Files:**
- Modify: `desktop/src/app-shell/components/empty-repository-state.tsx:97-278`

- [ ] **Step 1: 给 handleChooseDirectory 和 handleCreateNewRepository 添加 loading 状态**

在组件顶部添加 `const [isChoosing, setIsChoosing] = useState(false)`，在 `handleChooseDirectory` 开头设 `setIsChoosing(true)`，在所有 return 路径和 catch 中设 `setIsChoosing(false)`。按钮添加 `disabled={isChoosing}`。`handleCreateNewRepository` 同理，复用 `isCreating` 状态。

- [ ] **Step 2: 给 handleSwitchToRepository 的 catch 添加 showError**

在第 275 行的 catch 中添加用户通知：

```tsx
} catch (error) {
  logger.error("Failed to switch to repository.", { error })
  showError(error instanceof Error ? error.message : "切换仓库失败", { durationMs: 4000 })
}
```

- [ ] **Step 3: 验证修改**

Run: `cd desktop && npx tsc --noEmit --pretty 2>&1 | head -20`
Expected: 无类型错误

- [ ] **Step 4: Commit**

```bash
git add desktop/src/app-shell/components/empty-repository-state.tsx
git commit -m "fix: add loading states and error feedback to EmptyRepositoryState"
```

---

### Task 3: RepoOnboardingDialog 输入框提交时禁用

**Files:**
- Modify: `desktop/src/app-shell/components/repo-onboarding-dialog.tsx`

- [ ] **Step 1: 给 Input 添加 disabled={isSubmitting}**

在 repo-onboarding-dialog.tsx 的 Input 组件上添加 `disabled={isSubmitting}`，与 switch-repository-onboarding-dialog.tsx 保持一致。

- [ ] **Step 2: 验证修改**

Run: `cd desktop && npx tsc --noEmit --pretty 2>&1 | head -20`
Expected: 无类型错误

- [ ] **Step 3: Commit**

```bash
git add desktop/src/app-shell/components/repo-onboarding-dialog.tsx
git commit -m "fix: disable input during submission in RepoOnboardingDialog"
```

---

### Task 4: EditorScan 错误图标修正与部分成功重试

**Files:**
- Modify: `desktop/src/modules/editor-scan/components/scan-item-detail-dialog.tsx:547-558`
- Modify: `desktop/src/modules/editor-scan/hooks/use-editor-scan.ts:44-46`

- [ ] **Step 1: 将错误状态的 LoaderCircle 替换为 AlertCircle**

在 `scan-item-detail-dialog.tsx` 的 `ScanItemContentArea` error 分支中，将 `<LoaderCircle />` 替换为 `<AlertCircle />`。确保 `AlertCircle` 已从 lucide-react 导入。

- [ ] **Step 2: 修复部分成功时重试按钮不显示的问题**

在 `use-editor-scan.ts` 中，将 `hasFetched.current = true` 移到 `.then()` 成功回调中，而不是在调用前设置。这样扫描失败时 `hasFetched` 保持 false，允许自动重试。

- [ ] **Step 3: 验证修改**

Run: `cd desktop && npx tsc --noEmit --pretty 2>&1 | head -20`
Expected: 无类型错误

- [ ] **Step 4: Commit**

```bash
git add desktop/src/modules/editor-scan/
git commit -m "fix: use correct error icon and fix retry logic in EditorScan"
```

---

### Task 5: 收藏操作错误反馈与最近浏览防 unhandled rejection

**Files:**
- Modify: `desktop/src/modules/content/hooks/use-content-favorites.ts`
- Modify: `desktop/src/modules/content/hooks/use-content-recently-viewed.ts`
- Modify: `desktop/src/modules/content/components/content-detail-menubar.tsx:253-255`

- [ ] **Step 1: 在 content-detail-menubar.tsx 中捕获 toggleFavorite 错误并显示 toast**

找到 `void onToggleFavorite()` 调用处，改为：

```tsx
void onToggleFavorite().catch(() => {
  showError("收藏操作失败")
})
```

需要确保 `showError` 已从 `useAppNotifications()` 获取。

- [ ] **Step 2: 给 use-content-recently-viewed.ts 的 addRecentlyViewed 添加 try/catch**

在 `addRecentlyViewed` 函数中包裹 `updateConfig` 调用：

```tsx
try {
  await updateConfig({ ... })
} catch (error) {
  logger.error("Failed to update recently viewed.", { error })
}
```

- [ ] **Step 3: 验证修改**

Run: `cd desktop && npx tsc --noEmit --pretty 2>&1 | head -20`
Expected: 无类型错误

- [ ] **Step 4: Commit**

```bash
git add desktop/src/modules/content/
git commit -m "fix: add error handling for favorites toggle and recently viewed"
```

---

### Task 6: Skills 模块 FieldError 统一为共享组件

**Files:**
- Modify: `desktop/src/modules/skills/components/skill-create-dialog.tsx:62-68`

- [ ] **Step 1: 删除自定义 FieldError，改用共享组件**

删除第 62-68 行的本地 `FieldError` 函数定义，改为从 `@/components/ui/field` 导入 `FieldError`。

```tsx
import { FieldError } from "@/components/ui/field"
```

- [ ] **Step 2: 验证所有 FieldError 用法兼容**

检查共享 `FieldError` 的 props 接口是否与当前用法兼容（接受 `message?: string`）。

Run: `cd desktop && npx tsc --noEmit --pretty 2>&1 | head -20`
Expected: 无类型错误

- [ ] **Step 3: Commit**

```bash
git add desktop/src/modules/skills/components/skill-create-dialog.tsx
git commit -m "fix: use shared FieldError component in skill-create-dialog"
```

---

### Task 7: SyncStatusChip 添加 error 状态

**Files:**
- Modify: `desktop/src/app-shell/components/sync-status-chip.tsx`

- [ ] **Step 1: 添加 error 状态到 SyncStatus 类型和 statusConfig**

```tsx
type SyncStatus = "synced" | "pending" | "syncing" | "offline" | "error"

// 在 statusConfig 中添加：
error: {
  icon: AlertCircle,
  label: () => "同步失败",
},
```

导入 `AlertCircle` from lucide-react。

- [ ] **Step 2: 让 error 状态可点击以触发重试**

在 `SyncStatusChip` 中，将 `isClickable` 改为 `status === "pending" || status === "error"`，使 error 状态也显示为可点击按钮。

- [ ] **Step 3: 验证修改**

Run: `cd desktop && npx tsc --noEmit --pretty 2>&1 | head -20`
Expected: 无类型错误（或有调用方需要更新的类型错误，逐一修复）

- [ ] **Step 4: Commit**

```bash
git add desktop/src/app-shell/components/sync-status-chip.tsx
git commit -m "feat: add error state to SyncStatusChip"
```

---

### Task 8: 定时任务删除二次确认

**Files:**
- Modify: `desktop/src/modules/settings/components/scheduled-tasks-panel.tsx`

- [ ] **Step 1: 给定时任务删除按钮添加 AlertDialog 确认**

在 `ScheduledJobTable` 中，将第 734 行的直接 `onDelete(job)` 改为打开一个 AlertDialog。添加状态 `const [deleteTarget, setDeleteTarget] = useState<SynapseScheduledJob | null>(null)`。

删除按钮改为 `onClick={() => setDeleteTarget(job)}`。

在 Table 下方添加 AlertDialog：

```tsx
<AlertDialog open={deleteTarget !== null} onOpenChange={(open) => { if (!open) setDeleteTarget(null) }}>
  <AlertDialogContent>
    <AlertDialogHeader>
      <AlertDialogTitle>删除定时任务</AlertDialogTitle>
      <AlertDialogDescription>
        确定删除「{deleteTarget?.name}」？删除后无法恢复。
      </AlertDialogDescription>
    </AlertDialogHeader>
    <AlertDialogFooter>
      <AlertDialogCancel>取消</AlertDialogCancel>
      <AlertDialogAction onClick={() => { if (deleteTarget) onDelete(deleteTarget); setDeleteTarget(null) }}>
        删除
      </AlertDialogAction>
    </AlertDialogFooter>
  </AlertDialogContent>
</AlertDialog>
```

- [ ] **Step 2: 给保活提醒删除按钮添加同样的 AlertDialog 确认**

在 `HeartbeatTable` 中对第 815 行做同样的处理。

- [ ] **Step 3: 验证修改**

Run: `cd desktop && npx tsc --noEmit --pretty 2>&1 | head -20`
Expected: 无类型错误

- [ ] **Step 4: Commit**

```bash
git add desktop/src/modules/settings/components/scheduled-tasks-panel.tsx
git commit -m "fix: add delete confirmation dialogs for scheduled tasks and heartbeats"
```

---

### Task 9: 定时任务刷新失败错误展示 + cron 格式提示

**Files:**
- Modify: `desktop/src/modules/settings/components/scheduled-tasks-panel.tsx`

- [ ] **Step 1: 给 refresh 的 catch 添加错误状态**

在组件中添加 `const [refreshError, setRefreshError] = useState<string | null>(null)`。在 refresh 的 catch 中设置 `setRefreshError("加载定时任务失败")`，在 refresh 开始时清除 `setRefreshError(null)`。

在任务列表区域，当 `refreshError` 存在且列表为空时，显示错误提示和重试按钮。

- [ ] **Step 2: 给 cron 输入框添加 placeholder**

在 cron Input 上添加 `placeholder="0 */5 * * *"`。

- [ ] **Step 3: 验证修改**

Run: `cd desktop && npx tsc --noEmit --pretty 2>&1 | head -20`
Expected: 无类型错误

- [ ] **Step 4: Commit**

```bash
git add desktop/src/modules/settings/components/scheduled-tasks-panel.tsx
git commit -m "fix: add error state for task refresh and cron format hint"
```

---

### Task 10: 设置页面 loading 状态添加 spinner

**Files:**
- Modify: `desktop/src/modules/settings/index.tsx:200-207`

- [ ] **Step 1: 给加载中状态添加 LoaderCircle spinner**

将第 200-207 行的加载状态从纯文字改为带 spinner 的状态：

```tsx
<Card>
  <CardHeader>
    <div className="flex items-center gap-2 text-sm text-muted-foreground">
      <LoaderCircle className="size-4 animate-spin" />
      正在读取设置
    </div>
  </CardHeader>
</Card>
```

导入 `LoaderCircle` from lucide-react。

- [ ] **Step 2: 验证修改**

Run: `cd desktop && npx tsc --noEmit --pretty 2>&1 | head -20`
Expected: 无类型错误

- [ ] **Step 3: Commit**

```bash
git add desktop/src/modules/settings/index.tsx
git commit -m "fix: add spinner to settings loading state"
```

---

### Task 11: 编辑器目录面板 loading/error 状态

**Files:**
- Modify: `desktop/src/modules/settings/components/editor-directories-panel.tsx`

- [ ] **Step 1: 添加 loading 和 error 状态**

在 hook 或组件中添加 `isLoading` 和 `error` 状态。加载失败时显示错误提示和重试按钮，加载中时显示 spinner，空列表时显示"未检测到编辑器目录"。

- [ ] **Step 2: 验证修改**

Run: `cd desktop && npx tsc --noEmit --pretty 2>&1 | head -20`
Expected: 无类型错误

- [ ] **Step 3: Commit**

```bash
git add desktop/src/modules/settings/components/editor-directories-panel.tsx
git commit -m "fix: add loading and error states to editor directories panel"
```

---

### Task 12: Agent 运行时面板空状态 + 错误暴露

**Files:**
- Modify: `desktop/src/modules/settings/components/agent-runtime-panel.tsx:91-98`
- Modify: `desktop/src/modules/settings/hooks/use-agent-runtime-status.ts:43-46`

- [ ] **Step 1: 在 use-agent-runtime-status.ts 中暴露 error 状态**

添加 `const [error, setError] = useState<string | null>(null)`，在 catch 中设置 error，在返回值中包含 error。

- [ ] **Step 2: 在 agent-runtime-panel.tsx 中添加空状态和错误状态**

当 agents 为空时显示"未检测到 Agent 运行时"。当 error 存在时显示错误提示和重试按钮。

- [ ] **Step 3: 验证修改**

Run: `cd desktop && npx tsc --noEmit --pretty 2>&1 | head -20`
Expected: 无类型错误

- [ ] **Step 4: Commit**

```bash
git add desktop/src/modules/settings/components/agent-runtime-panel.tsx desktop/src/modules/settings/hooks/use-agent-runtime-status.ts
git commit -m "fix: add empty state and error handling to agent runtime panel"
```

---

### Task 13: 飞书连接器刷新状态错误处理

**Files:**
- Modify: `desktop/src/modules/settings/components/feishu-connector-panel.tsx:101-109`

- [ ] **Step 1: 给 refreshStatus 添加 catch**

在 `refreshStatus` 函数中添加 try/catch，catch 中设置错误状态并显示 toast。

```tsx
try {
  const result = await feishu.getStatus()
  setStatus(result)
} catch (error) {
  logger.error("Failed to refresh Feishu connector status.", { error })
  showError("刷新飞书连接状态失败")
} finally {
  setIsLoadingStatus(false)
}
```

- [ ] **Step 2: 验证修改**

Run: `cd desktop && npx tsc --noEmit --pretty 2>&1 | head -20`
Expected: 无类型错误

- [ ] **Step 3: Commit**

```bash
git add desktop/src/modules/settings/components/feishu-connector-panel.tsx
git commit -m "fix: add error handling to Feishu connector status refresh"
```

---

### Task 14: 全局 ErrorBoundary

**Files:**
- Create: `desktop/src/components/error-boundary.tsx`
- Modify: `desktop/src/main.tsx`

- [ ] **Step 1: 创建 ErrorBoundary 组件**

创建一个 class component `ErrorBoundary`，在 `componentDidCatch` 中记录日志，在 `getDerivedStateFromError` 中设置 error state。fallback UI 显示错误信息和"重新加载"按钮（调用 `window.location.reload()`）。

```tsx
import { Component, type ErrorInfo, type ReactNode } from "react"
import { Button } from "@/components/ui/button"

type Props = { children: ReactNode }
type State = { error: Error | null }

class ErrorBoundary extends Component<Props, State> {
  state: State = { error: null }

  static getDerivedStateFromError(error: Error): State {
    return { error }
  }

  componentDidCatch(error: Error, info: ErrorInfo) {
    console.error("[ErrorBoundary]", error, info.componentStack)
  }

  render() {
    if (this.state.error) {
      return (
        <main className="flex min-h-screen items-center justify-center bg-background px-6 py-10">
          <div className="flex w-full max-w-md flex-col gap-4 rounded-xl border border-border bg-card p-6">
            <h1 className="text-lg font-medium text-foreground">页面出现异常</h1>
            <p className="text-sm text-muted-foreground">{this.state.error.message}</p>
            <Button variant="outline" onClick={() => window.location.reload()}>
              重新加载
            </Button>
          </div>
        </main>
      )
    }
    return this.props.children
  }
}

export { ErrorBoundary }
```

- [ ] **Step 2: 在 main.tsx 中包裹最外层**

在 `createRoot(...).render()` 中，将 `<ErrorBoundary>` 包裹在所有 Provider 外层。

- [ ] **Step 3: 验证修改**

Run: `cd desktop && npx tsc --noEmit --pretty 2>&1 | head -20`
Expected: 无类型错误

- [ ] **Step 4: Commit**

```bash
git add desktop/src/components/error-boundary.tsx desktop/src/main.tsx
git commit -m "fix: add global ErrorBoundary to prevent white screen on render errors"
```

---

### Task 15: RepositoryManager 初始化失败 UI 反馈

**Files:**
- Modify: `desktop/src/app-shell/repository.tsx`

- [ ] **Step 1: 添加 error 状态和 UI 反馈**

在 `RepositoryManagerProvider` 中添加 `const [initError, setInitError] = useState<string | null>(null)`。在 catch 中设置 `setInitError(...)`。

当 `initError` 存在时，渲染一个错误页面（类似 IdentityGate 的 error 状态），带重试按钮。

- [ ] **Step 2: 验证修改**

Run: `cd desktop && npx tsc --noEmit --pretty 2>&1 | head -20`
Expected: 无类型错误

- [ ] **Step 3: Commit**

```bash
git add desktop/src/app-shell/repository.tsx
git commit -m "fix: add error UI when RepositoryManager initialization fails"
```

---

### Task 16: 安装对话框 preload 失败处理

**Files:**
- Modify: `desktop/src/modules/content/components/content-install-dialog.tsx:127-135`

- [ ] **Step 1: 将 .catch(() => {}) 改为设置错误状态**

添加 `const [preloadError, setPreloadError] = useState(false)`。将 `.catch(() => {})` 改为 `.catch(() => setPreloadError(true))`。

当 `preloadError` 为 true 时，在对话框中显示一个 InlineNotice 提示"内容加载失败，安装可能不完整"。

- [ ] **Step 2: 验证修改**

Run: `cd desktop && npx tsc --noEmit --pretty 2>&1 | head -20`
Expected: 无类型错误

- [ ] **Step 3: Commit**

```bash
git add desktop/src/modules/content/components/content-install-dialog.tsx
git commit -m "fix: show warning when install dialog content preload fails"
```

---

### Task 17: 安装状态刷新时清空旧数据

**Files:**
- Modify: `desktop/src/modules/content/hooks/use-editor-install-status.ts:69-70`

- [ ] **Step 1: 在 refresh 开始时清空 entries**

在 `refresh` 函数的 `setIsLoading(true)` 后添加 `setEntries([])`，防止切换内容项时旧数据残留。

- [ ] **Step 2: 验证修改**

Run: `cd desktop && npx tsc --noEmit --pretty 2>&1 | head -20`
Expected: 无类型错误

- [ ] **Step 3: Commit**

```bash
git add desktop/src/modules/content/hooks/use-editor-install-status.ts
git commit -m "fix: clear stale entries on install status refresh"
```

---

### Task 18: CLI 状态初始 loading 显示修正

**Files:**
- Modify: `desktop/src/modules/settings/components/data-store-settings-panel.tsx:386-430`

- [ ] **Step 1: 区分 loading 和未安装状态**

当 `cliStatus` 为 `null` 时（初始加载中），StatusPill 应显示 loading spinner 而非"未安装"。添加条件判断：

```tsx
{cliStatus === null ? (
  <LoaderCircle className="size-3.5 animate-spin text-muted-foreground" />
) : (
  <StatusPill available={cliStatus.available} installed={cliStatus.installed} />
)}
```

- [ ] **Step 2: 验证修改**

Run: `cd desktop && npx tsc --noEmit --pretty 2>&1 | head -20`
Expected: 无类型错误

- [ ] **Step 3: Commit**

```bash
git add desktop/src/modules/settings/components/data-store-settings-panel.tsx
git commit -m "fix: show loading spinner instead of 'not installed' during CLI status check"
```
