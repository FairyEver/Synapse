# Synapse 可用性审查实施计划

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 按用户旅程走查 Synapse 桌面应用，修复所有流程卡死、功能断裂和体验缺陷，确保内部推广前可用性达标。

**Architecture:** 逐个修复已识别的可用性问题，从 P0（流程卡死）到 P2（体验缺陷）。每个 Task 独立可提交，修复后验证构建通过。

**Tech Stack:** React 19, TypeScript, shadcn/ui, Electron IPC, Tailwind CSS 4

---

## 问题清单

| # | 优先级 | 问题 | 文件 |
|---|--------|------|------|
| 1 | P0 | IdentityGate error 状态无重试按钮，完全死胡同 | identity-gate.tsx |
| 2 | P0 | IdentityGate generateNewId 失败无 UI 反馈 | identity-gate.tsx |
| 3 | P0 | RepoOnboardingDialog 单仓库时提交失败无退路 | repo-onboarding-dialog.tsx |
| 4 | P1 | 全局缺少 ErrorBoundary，React 错误导致白屏 | main.tsx, App.tsx |
| 5 | P1 | Agent 错误状态无重试/恢复操作 | agent/index.tsx |
| 6 | P1 | Agent sendMessage 失败无反馈 | agent/index.tsx |
| 7 | P1 | Settings 配置加载失败无重试 | settings/index.tsx |
| 8 | P1 | Task Scheduler 加载失败无重试按钮 | task-scheduler/index.tsx |
| 9 | P2 | 安装对话框预加载失败静默吞错 | content-install-dialog.tsx |
| 10 | P2 | 安装对话框操作进行中可被关闭 | content-install-dialog.tsx |
| 11 | P2 | Cron 验证错误信息过于笼统 | cron-utils.ts |
| 12 | P2 | Database 列描述更新无错误处理 | database/index.tsx |

---

### Task 1: 修复 IdentityGate error 状态死胡同

**Files:**
- Modify: `desktop/src/app-shell/components/identity-gate.tsx:52-60`

当 IdentityGate 加载身份信息失败时（error 状态），界面只显示错误文案，没有重试按钮、没有退出按钮。用户只能关闭应用重启。

需要添加"重试"按钮，调用 `refreshIdentity()` 重新加载身份信息。

- [ ] **Step 1: 在 identity-gate.tsx 中添加 refreshIdentity 到 useLocalIdentity 解构**

`identity-gate.tsx` 第 25-31 行，在 `useLocalIdentity()` 解构中添加 `refreshIdentity`：

```tsx
const {
  adoptExistingUserId,
  error,
  generateNewId,
  localIdentityState,
  isReady,
  refreshIdentity,
} = useLocalIdentity()
```

注意：`useLocalIdentity` 已经返回 `refreshIdentity`（见 `identity-context.tsx:235`），只需解构即可。

- [ ] **Step 2: 在 error 状态 UI 中添加重试按钮**

替换 `identity-gate.tsx` 第 52-60 行的 error 分支，添加重试按钮和重试状态：

先在组件顶部添加重试状态（在现有 `useState` 声明附近）：

```tsx
const [isRetrying, setIsRetrying] = useState(false)
```

然后替换 error 分支：

```tsx
if (error) {
  return (
    <IdentityScreenShell>
      <div className="flex flex-col gap-3">
        <h1 className="text-lg font-medium text-foreground">无法读取身份信息</h1>
        <p className="text-sm text-muted-foreground">{error}</p>
        <div className="flex justify-end">
          <Button
            type="button"
            disabled={isRetrying}
            onClick={() => {
              setIsRetrying(true)
              void refreshIdentity()
                .catch((retryError) => {
                  logger.error("Failed to retry identity load.", { error: retryError })
                })
                .finally(() => {
                  setIsRetrying(false)
                })
            }}
          >
            {isRetrying ? "正在重试..." : "重试"}
          </Button>
        </div>
      </div>
    </IdentityScreenShell>
  )
}
```

- [ ] **Step 3: 验证构建通过**

Run: `cd desktop && npx tsc --noEmit`
Expected: 无错误

- [ ] **Step 4: 提交**

```bash
git add desktop/src/app-shell/components/identity-gate.tsx
git commit -m "fix: add retry button to IdentityGate error state"
```

---

### Task 2: 修复 IdentityGate generateNewId 失败无反馈

**Files:**
- Modify: `desktop/src/app-shell/components/identity-gate.tsx:91-111`

当用户点击"生成新 ID"按钮后，如果 `generateNewId()` 失败，catch 块只做了 log，没有设置任何 UI 错误状态。用户看不到任何反馈。

需要在 catch 中设置 `recoveryError`，让用户看到错误信息。

- [ ] **Step 1: 在 generateNewId 的 catch 中添加错误反馈**

修改 `identity-gate.tsx` 中"生成新 ID"按钮的 onClick handler，在 `.catch()` 中添加 `setRecoveryError`：

```tsx
.catch((generationError) => {
  logger.error("Failed to generate new identity from gate.", {
    elapsedMs: Math.round(performance.now() - startedAt),
    error: generationError,
  })
  setRecoveryError(
    generationError instanceof Error ? generationError.message : "生成新 ID 失败。",
  )
})
```

- [ ] **Step 2: 验证构建通过**

Run: `cd desktop && npx tsc --noEmit`
Expected: 无错误

- [ ] **Step 3: 提交**

```bash
git add desktop/src/app-shell/components/identity-gate.tsx
git commit -m "fix: show error feedback when generateNewId fails in IdentityGate"
```

---

### Task 3: 修复 RepoOnboardingDialog 单仓库时无退路

**Files:**
- Modify: `desktop/src/app-shell/components/repo-onboarding-dialog.tsx:189-199`

当只有一个仓库时（`hasOtherRepositories === false`），"切换仓库"按钮不显示。对话框禁止 ESC/外部点击/关闭按钮。如果 `updateCurrentRepoDisplayName()` 持续失败，用户被永久困在此对话框中。

需要在单仓库时也提供一个退路：允许用户移除当前仓库回到空仓库状态。

<!-- PLACEHOLDER_TASK3_CONTINUED -->
- [ ] **Step 1: 添加移除仓库的退路按钮**

修改 `repo-onboarding-dialog.tsx` 的 DialogFooter 部分（第 189-207 行）。当只有一个仓库时，显示"移除此目录"按钮代替"切换仓库"：

```tsx
<DialogFooter className="sm:justify-between">
  {hasOtherRepositories ? (
    <Button
      type="button"
      variant="outline"
      disabled={isSubmitting}
      onClick={() => openRepositorySwitchDialog()}
    >
      切换仓库
    </Button>
  ) : (
    <Button
      type="button"
      variant="ghost"
      disabled={isSubmitting}
      onClick={() => {
        logger.info("Remove repository requested from onboarding.", {
          repositoryUuid: activeRepository.uuid,
        })
        void manager.removeRepository(activeRepository.uuid)
      }}
    >
      移除此目录
    </Button>
  )}
  <Button
    type="button"
    disabled={isSubmitting || displayName.trim().length === 0}
    onClick={handleSubmit}
  >
    {isSubmitting ? "正在保存..." : "确定"}
  </Button>
</DialogFooter>
```

这样用户在提交失败时可以移除当前仓库，回到 `EmptyRepositoryState` 重新选择目录。

- [ ] **Step 2: 确认 manager.removeRepository 方法存在**

Run: `cd desktop && grep -n "removeRepository" src/app-shell/use-repository-manager.ts | head -5`

如果方法名不同，需要调整。查看 `useRepositoryManager()` 返回的方法列表。

- [ ] **Step 3: 验证构建通过**

Run: `cd desktop && npx tsc --noEmit`
Expected: 无错误

- [ ] **Step 4: 提交**

```bash
git add desktop/src/app-shell/components/repo-onboarding-dialog.tsx
git commit -m "fix: add escape route when repo onboarding submit fails with single repo"
```

---

### Task 4: 添加全局 ErrorBoundary

**Files:**
- Create: `desktop/src/components/app-error-boundary.tsx`
- Modify: `desktop/src/main.tsx:18-34`

当前没有任何 ErrorBoundary。任何 React 渲染错误会导致整个应用白屏。需要添加全局错误边界，显示友好的错误页面并提供恢复选项。

- [ ] **Step 1: 创建 AppErrorBoundary 组件**

创建 `desktop/src/components/app-error-boundary.tsx`：

```tsx
import { Component, type ErrorInfo, type ReactNode } from "react"
import { Button } from "@/components/ui/button"
import { createRendererLogger } from "@/app-shell/logging"

const logger = createRendererLogger("app.error-boundary")

type Props = { children: ReactNode }
type State = { hasError: boolean; error: Error | null }

class AppErrorBoundary extends Component<Props, State> {
  constructor(props: Props) {
    super(props)
    this.state = { hasError: false, error: null }
  }

  static getDerivedStateFromError(error: Error): State {
    return { hasError: true, error }
  }

  componentDidCatch(error: Error, errorInfo: ErrorInfo) {
    logger.error("Uncaught render error.", {
      error: error.message,
      stack: error.stack,
      componentStack: errorInfo.componentStack,
    })
  }

  render() {
    if (this.state.hasError) {
      return (
        <main className="flex min-h-screen items-center justify-center bg-background px-6 py-10">
          <div className="flex w-full max-w-md flex-col gap-4 rounded-xl border border-border bg-card p-6">
            <h1 className="text-lg font-medium text-foreground">应用遇到了问题</h1>
            <p className="text-sm text-muted-foreground">
              {this.state.error?.message ?? "发生了未知错误。"}
            </p>
            <div className="flex justify-end gap-2">
              <Button
                variant="outline"
                onClick={() => {
                  logger.info("User requested app reload from error boundary.")
                  window.location.reload()
                }}
              >
                重新加载
              </Button>
              <Button
                onClick={() => {
                  this.setState({ hasError: false, error: null })
                }}
              >
                重试
              </Button>
            </div>
          </div>
        </main>
      )
    }

    return this.props.children
  }
}

export { AppErrorBoundary }
```

- [ ] **Step 2: 在 main.tsx 中包裹 AppErrorBoundary**

修改 `desktop/src/main.tsx`，在 `StrictMode` 内、`AppConfigProvider` 外添加 `AppErrorBoundary`：

添加 import：
```tsx
import { AppErrorBoundary } from "@/components/app-error-boundary"
```

修改 render 树：
```tsx
createRoot(document.getElementById("root")!).render(
  <StrictMode>
    <AppErrorBoundary>
      <AppConfigProvider>
        <RepositoryManagerProvider>
          <LicenseProvider>
            <IdentityProvider>
              <AppNotificationsProvider>
                <ActiveRepositorySwitchProvider>
                  <App />
                </ActiveRepositorySwitchProvider>
              </AppNotificationsProvider>
            </IdentityProvider>
          </LicenseProvider>
        </RepositoryManagerProvider>
      </AppConfigProvider>
    </AppErrorBoundary>
  </StrictMode>,
)
```

- [ ] **Step 3: 验证构建通过**

Run: `cd desktop && npx tsc --noEmit`
Expected: 无错误

- [ ] **Step 4: 提交**

```bash
git add desktop/src/components/app-error-boundary.tsx desktop/src/main.tsx
git commit -m "fix: add global ErrorBoundary to prevent white screen on render errors"
```

---

### Task 5: 修复 Agent 模块错误状态和消息发送反馈

**Files:**
- Modify: `desktop/src/modules/agent/index.tsx`

两个问题：
1. `chat.error` 时显示 Alert 但无重试/恢复按钮（约第 219-223 行）
2. `sendMessage` 失败时无用户反馈（约第 86-88 行）

- [ ] **Step 1: 阅读 agent/index.tsx 确认当前代码**

Run: `cd desktop && sed -n '80,100p' src/modules/agent/index.tsx && echo "---" && sed -n '215,230p' src/modules/agent/index.tsx`

确认 `sendMessage` 调用方式和 `chat.error` 的展示方式。

- [ ] **Step 2: 为错误状态添加重试按钮**

在 `chat.error` 的 Alert 组件后添加重试按钮。具体修改取决于 Step 1 读到的代码结构。

错误 Alert 区域应改为：

```tsx
{chat.error ? (
  <Alert variant="destructive">
    <AlertDescription className="flex items-center justify-between">
      <span>{chat.error}</span>
      <Button
        variant="ghost"
        size="sm"
        onClick={() => chat.clearError?.()}
      >
        关闭
      </Button>
    </AlertDescription>
  </Alert>
) : null}
```

如果 `chat` 没有 `clearError` 方法，则使用本地 state 控制错误显示/隐藏。

- [ ] **Step 3: 为 sendMessage 添加错误反馈**

将 `sendMessage` 调用包裹在 try/catch 中，失败时显示 toast：

```tsx
const handleSendMessage = async () => {
  if (!draft.trim() || !chat.activeProjectId) return
  try {
    await chat.sendMessage(draft)
  } catch (sendError) {
    toast.error(sendError instanceof Error ? sendError.message : "发送失败。")
  }
}
```

如果 `sendMessage` 不返回 Promise（void 调用），则需要检查 `useAgentChat` 的实现来确定正确的错误处理方式。

- [ ] **Step 4: 验证构建通过**

Run: `cd desktop && npx tsc --noEmit`
Expected: 无错误

- [ ] **Step 5: 提交**

```bash
git add desktop/src/modules/agent/index.tsx
git commit -m "fix: add error recovery and send failure feedback in Agent module"
```

---

### Task 6: 修复 Settings 配置加载失败无重试

**Files:**
- Modify: `desktop/src/modules/settings/index.tsx`

配置加载失败时只显示红色错误文字（约第 198 行），无重试按钮。用户无法恢复。

- [ ] **Step 1: 阅读 settings/index.tsx 确认错误展示代码**

Run: `cd desktop && sed -n '190,220p' src/modules/settings/index.tsx`

确认 `error` 状态的展示方式和可用的刷新方法。

- [ ] **Step 2: 添加重试按钮**

将错误展示从纯文字改为包含重试按钮的区域。具体代码取决于 Step 1 读到的结构，大致为：

```tsx
if (error) {
  return (
    <div className="flex flex-col items-center justify-center gap-2 p-8">
      <p className="text-sm text-destructive">{error}</p>
      <Button variant="outline" size="sm" onClick={() => refresh()}>
        重试
      </Button>
    </div>
  )
}
```

- [ ] **Step 3: 验证构建通过**

Run: `cd desktop && npx tsc --noEmit`
Expected: 无错误

- [ ] **Step 4: 提交**

```bash
git add desktop/src/modules/settings/index.tsx
git commit -m "fix: add retry button when settings config fails to load"
```

---

### Task 7: 修复 Task Scheduler 加载失败无重试

**Files:**
- Modify: `desktop/src/modules/task-scheduler/index.tsx`

加载失败时只显示红色文字（约第 174 行），无重试按钮。加载中无 spinner 动画。

- [ ] **Step 1: 阅读 task-scheduler/index.tsx 确认加载/错误状态代码**

Run: `cd desktop && sed -n '168,200p' src/modules/task-scheduler/index.tsx`

确认 `error` 和 `loading` 状态的展示方式和可用的刷新方法。

- [ ] **Step 2: 改进错误状态展示**

添加重试按钮，改进加载状态添加 spinner：

```tsx
if (error) {
  return (
    <div className="flex flex-col items-center justify-center gap-2 p-8">
      <p className="text-sm text-destructive">{error}</p>
      <Button variant="outline" size="sm" onClick={() => refresh()}>
        重试
      </Button>
    </div>
  )
}

if (loading) {
  return (
    <div className="flex items-center gap-2 p-8 text-sm text-muted-foreground">
      <LoaderCircle className="h-4 w-4 animate-spin" />
      正在加载
    </div>
  )
}
```

- [ ] **Step 3: 验证构建通过**

Run: `cd desktop && npx tsc --noEmit`
Expected: 无错误

- [ ] **Step 4: 提交**

```bash
git add desktop/src/modules/task-scheduler/index.tsx
git commit -m "fix: add retry button and spinner for TaskScheduler loading states"
```

---

### Task 8: 修复安装对话框预加载失败静默吞错

**Files:**
- Modify: `desktop/src/modules/content/components/content-install-dialog.tsx`

预加载内容时 `.catch(() => {})` 完全吞掉错误（约第 133 行）。如果内容读取失败，变量替换步骤被意外跳过，用户不知道。

- [ ] **Step 1: 阅读 content-install-dialog.tsx 确认预加载代码**

Run: `cd desktop && sed -n '120,140p' src/modules/content/components/content-install-dialog.tsx`

确认预加载逻辑和 `preloadedContent` 的使用方式。

- [ ] **Step 2: 将静默 catch 改为设置错误状态**

替换 `.catch(() => {})` 为有意义的错误处理：

```tsx
.catch((preloadError) => {
  logger.warn("Failed to preload content for install.", {
    contentId: item?.id,
    error: preloadError,
  })
})
```

这样至少有日志记录。预加载失败不应阻断安装流程（内容会在安装时重新读取），但应该有日志便于排查。

- [ ] **Step 3: 验证构建通过**

Run: `cd desktop && npx tsc --noEmit`
Expected: 无错误

- [ ] **Step 4: 提交**

```bash
git add desktop/src/modules/content/components/content-install-dialog.tsx
git commit -m "fix: log preload failures in install dialog instead of silently swallowing"
```

---

### Task 9: 修复安装对话框操作中可被关闭

**Files:**
- Modify: `desktop/src/modules/content/components/content-install-dialog.tsx`

安装进行中（`isInstalling === true`），用户可以通过 Escape 或点击 overlay 关闭对话框，丢失结果反馈。

- [ ] **Step 1: 阅读 content-install-dialog.tsx 确认 Dialog 组件代码**

Run: `cd desktop && sed -n '465,480p' src/modules/content/components/content-install-dialog.tsx`

确认 Dialog 的 `open` 和 `onOpenChange` 属性。

- [ ] **Step 2: 在安装进行中阻止关闭**

修改 Dialog 的 `onOpenChange` 回调，在 `isInstalling` 时阻止关闭：

```tsx
<Dialog
  open={open}
  onOpenChange={(nextOpen) => {
    if (!nextOpen && isInstalling) return
    onOpenChange(nextOpen)
  }}
>
```

同时为 DialogContent 添加 ESC 和外部点击保护：

```tsx
<DialogContent
  onEscapeKeyDown={(event) => {
    if (isInstalling) event.preventDefault()
  }}
  onInteractOutside={(event) => {
    if (isInstalling) event.preventDefault()
  }}
>
```

- [ ] **Step 3: 验证构建通过**

Run: `cd desktop && npx tsc --noEmit`
Expected: 无错误

- [ ] **Step 4: 提交**

```bash
git add desktop/src/modules/content/components/content-install-dialog.tsx
git commit -m "fix: prevent closing install dialog while installation is in progress"
```

---

### Task 10: 改进 Cron 验证错误信息

**Files:**
- Modify: `desktop/src/modules/task-scheduler/cron-utils.ts`

所有 Cron 字段验证错误统一抛 `${spec.label}不合法`，不说明具体原因（超范围？格式错？步长为 0？）。

- [ ] **Step 1: 阅读 cron-utils.ts 确认验证逻辑**

Run: `cd desktop && sed -n '220,270p' src/modules/task-scheduler/cron-utils.ts`

确认 `parseField`、`addSegment`、`parseRange`、`parseValue` 的错误抛出方式。

- [ ] **Step 2: 为每种错误情况添加具体信息**

根据 Step 1 读到的代码，为不同的验证失败场景提供具体的错误信息。大致方向：

- 值超出范围：`"${spec.label}的值 ${value} 超出范围（${spec.min}-${spec.max}）"`
- 步长为 0：`"${spec.label}的步长不能为 0"`
- 格式错误：`"${spec.label}格式不正确"`
- 范围起始大于结束：`"${spec.label}的范围起始值不能大于结束值"`

- [ ] **Step 3: 验证构建通过**

Run: `cd desktop && npx tsc --noEmit`
Expected: 无错误

- [ ] **Step 4: 提交**

```bash
git add desktop/src/modules/task-scheduler/cron-utils.ts
git commit -m "fix: provide specific error messages for cron expression validation"
```

---

### Task 11: 修复 Database 列描述更新无错误处理

**Files:**
- Modify: `desktop/src/modules/database/index.tsx`

`handleUpdateColumnDescription`（约第 245-257 行）无 try/catch，失败时用户无反馈。

- [ ] **Step 1: 阅读 database/index.tsx 确认列描述更新代码**

Run: `cd desktop && sed -n '240,260p' src/modules/database/index.tsx`

确认 `handleUpdateColumnDescription` 的实现和可用的通知方法。

- [ ] **Step 2: 添加 try/catch 和错误通知**

包裹 `handleUpdateColumnDescription` 的异步操作：

```tsx
const handleUpdateColumnDescription = async (columnName: string, description: string) => {
  try {
    await databaseColumnUpdateDescription(activeTable, columnName, description)
  } catch (updateError) {
    showError(updateError instanceof Error ? updateError.message : "更新列描述失败。")
  }
}
```

- [ ] **Step 3: 验证构建通过**

Run: `cd desktop && npx tsc --noEmit`
Expected: 无错误

- [ ] **Step 4: 提交**

```bash
git add desktop/src/modules/database/index.tsx
git commit -m "fix: add error handling for database column description updates"
```
