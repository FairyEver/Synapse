# 内测前全栈稳定性修复 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 修复 9 个内测前必须解决的稳定性问题（6 个 P0 + 3 个高影响 P1），防止白屏、崩溃、数据丢失和流程卡死。

**Architecture:** 修复分为前端防御层（ErrorBoundary + bridge 安全调用）、后端 Git 操作安全（超时 + 共享锁 + rebase 恢复）、数据流可靠性（初始化失败处理 + 退出 flush + 保存流程 + push 重试）三个维度。每个 Task 独立可提交。

**Tech Stack:** React 19, Electron 41, TypeScript, Vitest, shadcn/ui

---

### Task 1: ErrorBoundary 组件与全局/模块级保护

**Files:**
- Create: `desktop/src/components/error-boundary.tsx`
- Modify: `desktop/src/main.tsx`
- Modify: `desktop/src/App.tsx:413-437` (tab 渲染区域)
- Modify: `desktop/src/App.tsx:451-456` (独立窗口)

- [ ] **Step 1: 创建 ErrorBoundary 组件**

```tsx
// desktop/src/components/error-boundary.tsx
import { Component, type ErrorInfo, type ReactNode } from "react"
import { Button } from "@/components/ui/button"
import { Card, CardContent, CardFooter, CardHeader, CardTitle } from "@/components/ui/card"
import { createRendererLogger } from "@/app-shell/logging"

const logger = createRendererLogger("error-boundary")

interface ErrorBoundaryProps {
  children: ReactNode
  fallbackTitle?: string
  onReset?: () => void
}

interface ErrorBoundaryState {
  error: Error | null
}

class ErrorBoundary extends Component<ErrorBoundaryProps, ErrorBoundaryState> {
  constructor(props: ErrorBoundaryProps) {
    super(props)
    this.state = { error: null }
  }

  static getDerivedStateFromError(error: Error): ErrorBoundaryState {
    return { error }
  }

  componentDidCatch(error: Error, info: ErrorInfo) {
    logger.error("Uncaught render error.", {
      error: error.message,
      componentStack: info.componentStack,
    })
  }

  private handleReset = () => {
    this.setState({ error: null })
    this.props.onReset?.()
  }

  render() {
    if (!this.state.error) {
      return this.props.children
    }

    return (
      <div className="flex h-full items-center justify-center p-6">
        <Card className="w-full max-w-md">
          <CardHeader>
            <CardTitle className="text-base">
              {this.props.fallbackTitle ?? "页面出现问题"}
            </CardTitle>
          </CardHeader>
          <CardContent>
            <p className="text-sm text-muted-foreground">
              {this.state.error.message}
            </p>
          </CardContent>
          <CardFooter>
            <Button variant="outline" onClick={this.handleReset}>
              重试
            </Button>
          </CardFooter>
        </Card>
      </div>
    )
  }
}

export { ErrorBoundary }
```

- [ ] **Step 2: 在 main.tsx 添加全局 ErrorBoundary**

在 `main.tsx` 的 `<StrictMode>` 内、`<AppConfigProvider>` 外包裹全局 ErrorBoundary：

```tsx
// desktop/src/main.tsx — 修改 render 调用
import { ErrorBoundary } from "@/components/error-boundary"

createRoot(document.getElementById("root")!).render(
  <StrictMode>
    <ErrorBoundary fallbackTitle="应用出现问题" onReset={() => window.location.reload()}>
      <AppConfigProvider>
        <RepositoryManagerProvider>
          <IdentityProvider>
            <AppNotificationsProvider>
              <ActiveRepositorySwitchProvider>
                <App />
              </ActiveRepositorySwitchProvider>
            </AppNotificationsProvider>
          </IdentityProvider>
        </RepositoryManagerProvider>
      </AppConfigProvider>
    </ErrorBoundary>
  </StrictMode>,
)
```

- [ ] **Step 3: 在 App.tsx 的 tab 渲染区域添加模块级 ErrorBoundary**

修改 `App.tsx:413-437` 的 tab 渲染区域，为每个模块包裹 ErrorBoundary：

```tsx
// desktop/src/App.tsx — 在 <AppShellLayout> children 内
import { ErrorBoundary } from "@/components/error-boundary"

// ... 在 tab 渲染区域：
<div className="flex h-full min-h-0 flex-col">
  {CONTENT_TYPE_DEFINITIONS.map((definition) => {
    if (activeTab !== definition.id) {
      return null
    }

    const ModuleComponent = CONTENT_MODULE_COMPONENTS[definition.id]
    const dialogHandlers = contentDialogHandlers[definition.id]

    return (
      <ErrorBoundary key={definition.id} fallbackTitle={`${definition.tabLabel}模块出现问题`}>
        <ModuleComponent
          key={definition.id}
          onCreateDialogOpenChange={dialogHandlers.create}
          onDetailDialogOpenChange={dialogHandlers.detail}
          onInstallDialogOpenChange={dialogHandlers.install}
          pendingContentOpenRequest={pendingContentOpenRequest}
          onPendingContentOpenRequestConsumed={handlePendingContentOpenRequestConsumed}
        />
      </ErrorBoundary>
    )
  })}
  {activeTab === "agent" ? (
    <ErrorBoundary fallbackTitle="Agent 模块出现问题">
      <AgentModule />
    </ErrorBoundary>
  ) : null}
  {activeTab === "data-store" ? (
    <ErrorBoundary fallbackTitle="数据库模块出现问题">
      <DataStoreModule />
    </ErrorBoundary>
  ) : null}
  {activeTab === "editor-scan" ? (
    <ErrorBoundary fallbackTitle="IDE 模块出现问题">
      <EditorScanModule />
    </ErrorBoundary>
  ) : null}
  {activeTab === "settings" ? (
    <ErrorBoundary fallbackTitle="设置模块出现问题">
      <SettingsModule />
    </ErrorBoundary>
  ) : null}
</div>
```

- [ ] **Step 4: 在独立窗口添加 ErrorBoundary**

修改 `App.tsx:451-456`，为独立内容详情窗口包裹 ErrorBoundary：

```tsx
// desktop/src/App.tsx — App 组件中 standaloneContentWindowRequest 分支
if (standaloneContentWindowRequest) {
  return (
    <ErrorBoundary fallbackTitle="内容详情出现问题" onReset={() => window.location.reload()}>
      <IdentityGate>
        <ContentDetailWindowPage request={standaloneContentWindowRequest} />
      </IdentityGate>
    </ErrorBoundary>
  )
}
```

- [ ] **Step 5: 运行 typecheck 验证**

Run: `cd desktop && pnpm typecheck`
Expected: 无类型错误

- [ ] **Step 6: Commit**

```bash
git add desktop/src/components/error-boundary.tsx desktop/src/main.tsx desktop/src/App.tsx
git commit -m "fix: add ErrorBoundary to prevent white screen on render errors"
```

---

### Task 2: 修复 requireSynapseBridge 同步抛出

**Files:**
- Modify: `desktop/src/modules/data-store/index.tsx:342-343`
- Modify: `desktop/src/modules/agent/hooks/use-agent-chat.ts:509-511`
- Modify: `desktop/src/modules/settings/components/log-export-panel.tsx:73-74`
- Modify: `desktop/src/modules/settings/components/editor-directories-panel.tsx:71-72`
- Modify: `desktop/src/modules/agent/index.tsx:138`

- [ ] **Step 1: 修复 DataStoreModule 中的 bridge 调用**

修改 `desktop/src/modules/data-store/index.tsx:342-343`：

```tsx
// Before:
useEffect(() => {
  const bridge = requireSynapseBridge()
  // ...

// After:
useEffect(() => {
  const bridge = getSynapseBridge()
  if (!bridge) return
  // ... 其余逻辑不变，将 bridge.dataStore.onChanged 替换为使用局部 bridge 变量
```

同时在文件顶部将 `import { requireSynapseBridge }` 改为 `import { getSynapseBridge }`（如果 requireSynapseBridge 在文件中不再有其他用途）。

- [ ] **Step 2: 修复 use-agent-chat 中的 bridge 调用**

修改 `desktop/src/modules/agent/hooks/use-agent-chat.ts:509-511`：

```tsx
// Before:
useEffect(() => {
  if (projectIdsRef.current.length === 0) return undefined
  const bridge = requireSynapseBridge()
  return bridge.agent.onEvent(...)

// After:
useEffect(() => {
  if (projectIdsRef.current.length === 0) return undefined
  const bridge = getSynapseBridge()
  if (!bridge) return undefined
  return bridge.agent.onEvent(...)
```

- [ ] **Step 3: 修复 LogExportPanel 中的 bridge 调用**

修改 `desktop/src/modules/settings/components/log-export-panel.tsx:73-74`：

```tsx
// Before:
useEffect(() => {
  requireSynapseBridge().log.listFiles().then(...)

// After:
useEffect(() => {
  getSynapseBridge()?.log.listFiles().then((files) => {
    setTotalLogSize(files.reduce((sum, f) => sum + f.sizeBytes, 0))
  }).catch(() => undefined)
  void loadDiagnostics()
}, [])
```

- [ ] **Step 4: 修复 EditorDirectoriesPanel 中的 bridge 调用**

修改 `desktop/src/modules/settings/components/editor-directories-panel.tsx:71-72`：

```tsx
// Before:
const loadDirectories = useCallback(() => {
  requireSynapseBridge()
    .editor.getGlobalDirectories()

// After:
const loadDirectories = useCallback(() => {
  const bridge = getSynapseBridge()
  if (!bridge) return
  bridge.editor.getGlobalDirectories()
    .then(setDirectories)
    .catch((error) => {
      logger.error("Failed to load editor global directories.", error)
    })
}, [])
```

注意：该文件第 94 行的 `requireSynapseBridge().editor.createDirectory(dirPath)` 在 async 函数的 try/catch 内部（通过 `promise()` 包裹），是安全的，不需要修改。

- [ ] **Step 5: 修复 AgentModule 中的 openReference**

修改 `desktop/src/modules/agent/index.tsx:135-139`：

```tsx
// Before:
const openReference = (reference: string) => {
  const projectId = chat.selectedProjectId ?? chat.activeProjectId
  if (!projectId) return
  void requireSynapseBridge().agent.openReference({ projectId, reference })
}

// After:
const openReference = (reference: string) => {
  const projectId = chat.selectedProjectId ?? chat.activeProjectId
  if (!projectId) return
  void getSynapseBridge()?.agent.openReference({ projectId, reference })
}
```

- [ ] **Step 6: 更新 import 语句**

在每个修改的文件中，将 `requireSynapseBridge` 的 import 替换为 `getSynapseBridge`（如果该文件中 `requireSynapseBridge` 不再有其他安全用途）。如果文件中仍有在 try/catch 或 async 函数内的 `requireSynapseBridge` 调用，保留两个 import。

- [ ] **Step 7: 运行 typecheck 验证**

Run: `cd desktop && pnpm typecheck`
Expected: 无类型错误

- [ ] **Step 8: Commit**

```bash
git add desktop/src/modules/data-store/index.tsx desktop/src/modules/agent/hooks/use-agent-chat.ts desktop/src/modules/settings/components/log-export-panel.tsx desktop/src/modules/settings/components/editor-directories-panel.tsx desktop/src/modules/agent/index.tsx
git commit -m "fix: replace requireSynapseBridge with safe getSynapseBridge in useEffect hooks"
```

---

### Task 3: Git 操作添加超时

**Files:**
- Modify: `desktop/electron/services/repository-maintenance-service.ts:286-301` (runMaintenanceGitCommand)
- Modify: `desktop/electron/services/repository-maintenance-service.ts:316-329` (pullWithRebase)
- Modify: `desktop/electron/services/repository-maintenance-service.ts:370-383` (pushRepository)
- Modify: `desktop/electron/services/repository-maintenance-service.ts:540-541` (retry 路径)
- Modify: `desktop/electron/services/repository-store.ts:26-61` (runGitProbe)

- [ ] **Step 1: 给 runMaintenanceGitCommand 添加超时参数**

修改 `desktop/electron/services/repository-maintenance-service.ts:286-301`：

```ts
// Before:
function runMaintenanceGitCommand(
  cwd: string,
  args: string[],
  fallbackMessage: string,
  onOutput?: (line: string) => void,
): Promise<GitCommandResult> {
  return runGitCommand({
    args,
    cwd,
    fallbackMessage,
    formatFailureMessage: formatGitFailureMessage,
    onLine: (line) => {
      onOutput?.(line)
    },
  })
}

// After:
const MAINTENANCE_LOCAL_TIMEOUT_MS = 30_000
const MAINTENANCE_REMOTE_TIMEOUT_MS = 60_000

function runMaintenanceGitCommand(
  cwd: string,
  args: string[],
  fallbackMessage: string,
  onOutput?: (line: string) => void,
  options?: { timeoutMs?: number; timeoutMessage?: string },
): Promise<GitCommandResult> {
  return runGitCommand({
    args,
    cwd,
    fallbackMessage,
    formatFailureMessage: formatGitFailureMessage,
    onLine: (line) => {
      onOutput?.(line)
    },
    timeoutMs: options?.timeoutMs ?? MAINTENANCE_LOCAL_TIMEOUT_MS,
    timeoutMessage: options?.timeoutMessage ?? fallbackMessage,
  })
}
```

- [ ] **Step 2: 给 pullWithRebase 添加超时和 rebase 中止**

修改 `desktop/electron/services/repository-maintenance-service.ts:316-329`：

```ts
// Before:
async function pullWithRebase(
  repository: SynapseRepositoryConfig,
  onProgress?: MaintenanceProgressListener,
): Promise<void> {
  onProgress?.("正在拉取最新内容...")
  await runMaintenanceGitCommand(
    repository.localPath,
    ["pull", "--rebase"],
    "同步仓库失败，请检查网络或仓库状态后重试。",
    (line) => {
      onProgress?.(line)
    },
  )
}

// After:
async function pullWithRebase(
  repository: SynapseRepositoryConfig,
  onProgress?: MaintenanceProgressListener,
): Promise<void> {
  onProgress?.("正在拉取最新内容...")
  try {
    await runMaintenanceGitCommand(
      repository.localPath,
      ["pull", "--rebase"],
      "同步仓库失败，请检查网络或仓库状态后重试。",
      (line) => {
        onProgress?.(line)
      },
      {
        timeoutMs: MAINTENANCE_REMOTE_TIMEOUT_MS,
        timeoutMessage: "同步仓库超时，请检查网络后重试。",
      },
    )
  } catch (error) {
    await abortRebaseIfNeeded(repository.localPath)
    throw error
  }
}
```

需要在文件中添加 `abortRebaseIfNeeded` 函数（或从 `content-submission-service.ts` 提取为共享工具）。检查文件中是否已有 `isRebaseInProgress` 工具函数。如果没有，添加：

```ts
async function abortRebaseIfNeeded(localPath: string): Promise<void> {
  try {
    const rebaseDir = path.join(localPath, ".git", "rebase-merge")
    const rebaseApplyDir = path.join(localPath, ".git", "rebase-apply")
    const { existsSync } = await import("node:fs")
    if (!existsSync(rebaseDir) && !existsSync(rebaseApplyDir)) return

    logger.warn("Rebase in progress detected during maintenance. Aborting.", { localPath })
    await runMaintenanceGitCommand(
      localPath,
      ["rebase", "--abort"],
      "无法中止 rebase，请手动检查仓库状态。",
    )
  } catch {
    logger.error("Failed to abort rebase during maintenance recovery.", { localPath })
  }
}
```

- [ ] **Step 3: 给 pushRepository 添加超时**

修改 `desktop/electron/services/repository-maintenance-service.ts:370-383`：

```ts
// Before:
async function pushRepository(
  repository: SynapseRepositoryConfig,
  onProgress?: MaintenanceProgressListener,
): Promise<void> {
  onProgress?.("正在推送到仓库...")
  await runMaintenanceGitCommand(
    repository.localPath,
    ["push"],
    "推送到仓库失败。",
    (line) => {
      onProgress?.(line)
    },
  )
}

// After:
async function pushRepository(
  repository: SynapseRepositoryConfig,
  onProgress?: MaintenanceProgressListener,
): Promise<void> {
  onProgress?.("正在推送到仓库...")
  await runMaintenanceGitCommand(
    repository.localPath,
    ["push"],
    "推送到仓库失败。",
    (line) => {
      onProgress?.(line)
    },
    {
      timeoutMs: MAINTENANCE_REMOTE_TIMEOUT_MS,
      timeoutMessage: "推送到仓库超时，请检查网络后重试。",
    },
  )
}
```

- [ ] **Step 4: 给 runGitProbe 添加超时**

修改 `desktop/electron/services/repository-store.ts:26-61`，在 spawn 后添加超时：

```ts
const GIT_PROBE_TIMEOUT_MS = 15_000

function runGitProbe(cwd: string, args: string[]): Promise<string | null> {
  return new Promise((resolve, reject) => {
    const childProcess = spawn("git", args, {
      cwd,
      env: {
        ...process.env,
        GIT_TERMINAL_PROMPT: "0",
        LANG: "C",
        LC_ALL: "C",
      },
    })

    let stdout = ""
    let stderr = ""
    let settled = false

    const timeout = setTimeout(() => {
      if (settled) return
      settled = true
      childProcess.kill("SIGTERM")
      reject(new Error("Git 探测超时。"))
    }, GIT_PROBE_TIMEOUT_MS)

    childProcess.stdout.on("data", (chunk: Buffer) => {
      stdout += chunk.toString("utf8")
    })

    childProcess.stderr.on("data", (chunk: Buffer) => {
      stderr += chunk.toString("utf8")
    })

    childProcess.on("error", (error) => {
      if (settled) return
      settled = true
      clearTimeout(timeout)
      reject(error)
    })

    childProcess.on("close", (code) => {
      if (settled) return
      settled = true
      clearTimeout(timeout)

      if (code === 0) {
        resolve(stdout.trim() || null)
        return
      }

      const message = stderr.trim() || stdout.trim()
      reject(new Error(message || "Git 探测失败。"))
    })
  })
}
```

- [ ] **Step 5: 运行 typecheck 验证**

Run: `cd desktop && pnpm typecheck`
Expected: 无类型错误

- [ ] **Step 6: Commit**

```bash
git add desktop/electron/services/repository-maintenance-service.ts desktop/electron/services/repository-store.ts
git commit -m "fix: add timeouts to all git operations to prevent indefinite hangs"
```

---

### Task 4: sync/push 共享互斥锁

**Files:**
- Create: `desktop/electron/services/repository-lock-manager.ts`
- Modify: `desktop/electron/services/repository-git-service.ts:160-258`
- Modify: `desktop/electron/services/content-submission-service.ts:236-237,643-670`

- [ ] **Step 1: 创建 RepositoryLockManager**

```ts
// desktop/electron/services/repository-lock-manager.ts
import { createMainLogger } from "./log-store"

const logger = createMainLogger("repository-lock-manager")

const LOCK_ACQUIRE_TIMEOUT_MS = 30_000

type QueueEntry = {
  resolve: () => void
  reject: (error: Error) => void
  operation: string
}

class RepositoryLockManager {
  private locks = new Map<string, { operation: string; queue: QueueEntry[] }>()

  async acquire(repositoryUuid: string, operation: string): Promise<() => void> {
    const existing = this.locks.get(repositoryUuid)

    if (!existing) {
      this.locks.set(repositoryUuid, { operation, queue: [] })
      logger.debug("Lock acquired.", { repositoryUuid, operation })
      return () => this.release(repositoryUuid)
    }

    return new Promise<() => void>((resolve, reject) => {
      const timeout = setTimeout(() => {
        const lock = this.locks.get(repositoryUuid)
        if (lock) {
          lock.queue = lock.queue.filter((entry) => entry.resolve !== resolveEntry)
        }
        reject(new Error(
          `获取仓库锁超时（当前操作: ${existing.operation}，等待操作: ${operation}）`,
        ))
      }, LOCK_ACQUIRE_TIMEOUT_MS)

      const resolveEntry = () => {
        clearTimeout(timeout)
        resolve(() => this.release(repositoryUuid))
      }

      existing.queue.push({
        resolve: resolveEntry,
        reject: (error: Error) => {
          clearTimeout(timeout)
          reject(error)
        },
        operation,
      })

      logger.debug("Lock queued.", {
        repositoryUuid,
        operation,
        currentOperation: existing.operation,
        queueLength: existing.queue.length,
      })
    })
  }

  private release(repositoryUuid: string): void {
    const lock = this.locks.get(repositoryUuid)
    if (!lock) return

    const next = lock.queue.shift()
    if (next) {
      lock.operation = next.operation
      logger.debug("Lock transferred.", { repositoryUuid, operation: next.operation })
      next.resolve()
    } else {
      this.locks.delete(repositoryUuid)
      logger.debug("Lock released.", { repositoryUuid })
    }
  }
}

export const repositoryLockManager = new RepositoryLockManager()
```

- [ ] **Step 2: 修改 RepositoryGitService 使用共享锁**

修改 `desktop/electron/services/repository-git-service.ts`，将 `runExclusive` 改为使用 `repositoryLockManager`：

```ts
// 添加 import
import { repositoryLockManager } from "./repository-lock-manager"

class RepositoryGitService {
  // 删除: private activeOperations = new Map<string, SynapseRepositoryOperationKind>()

  async syncRepository(
    repository: SynapseRepositoryConfig,
    onProgress: ProgressListener,
  ): Promise<SynapseRepositoryOperationResult> {
    // ... 前面的检查逻辑不变 ...

    const release = await repositoryLockManager.acquire(repository.uuid, "sync")
    try {
      onProgress({
        repositoryUuid: repository.uuid,
        operation: "sync",
        statusText: "正在检查远程更新...",
        percent: 0,
      })

      await runRepositoryGitCommand(repository.uuid, "sync", [
        "pull",
        "--ff-only",
        "--progress",
      ], {
        cwd: repository.localPath,
        onProgress,
      })

      const nextState = await repositoryStore.getRepositoryState(repository)
      const completedAt = new Date().toISOString()

      onProgress({
        repositoryUuid: repository.uuid,
        operation: "sync",
        statusText: "仓库同步完成。",
        percent: 100,
      })

      logger.info("Repository sync completed.", {
        repositoryUuid: repository.uuid,
        completedAt,
      })

      return {
        operation: "sync" as const,
        repository: nextState,
        completedAt,
      }
    } catch (error) {
      logger.error("Repository sync failed.", {
        repositoryUuid: repository.uuid,
        error,
      })
      throw error
    } finally {
      release()
    }
  }

  // 删除整个 runExclusive 方法
}
```

- [ ] **Step 3: 修改 ContentSubmissionService 使用共享锁**

修改 `desktop/electron/services/content-submission-service.ts`，将 `runPushExclusive` 改为使用 `repositoryLockManager`：

```ts
// 添加 import
import { repositoryLockManager } from "./repository-lock-manager"

class ContentSubmissionService {
  // 删除: private pendingPushChains = new Map<string, Promise<void>>()

  // flushPendingPushes 方法中，将 this.runPushExclusive(repository.uuid, async () => { ... })
  // 改为：
  async flushPendingPushes(
    repository: SynapseRepositoryConfig,
    onProgress?: PushProgressListener,
  ): Promise<void> {
    // ... 前面的检查逻辑不变 ...

    const release = await repositoryLockManager.acquire(repository.uuid, "push")
    try {
      // ... 原 runPushExclusive 回调内的逻辑 ...
    } finally {
      release()
    }
  }

  // 删除整个 runPushExclusive 方法
}
```

- [ ] **Step 4: 运行 typecheck 验证**

Run: `cd desktop && pnpm typecheck`
Expected: 无类型错误

- [ ] **Step 5: Commit**

```bash
git add desktop/electron/services/repository-lock-manager.ts desktop/electron/services/repository-git-service.ts desktop/electron/services/content-submission-service.ts
git commit -m "fix: introduce shared per-repository lock to prevent concurrent git operations"
```

---

### Task 5: RepositoryManager 初始化失败处理

**Files:**
- Modify: `desktop/src/app-shell/repository.tsx:14-61`

- [ ] **Step 1: 添加初始化错误状态和重试**

修改 `desktop/src/app-shell/repository.tsx`：

```tsx
import { createContext, type ReactNode, useCallback, useContext, useEffect, useState } from "react"
import {
  getRepositoryManager,
  resetRepositoryManager,
  type RepositoryManager,
  type RepositoryOperationState,
} from "@/app-shell/repository-manager"
import { createRendererLogger } from "@/app-shell/logging"
import { Button } from "@/components/ui/button"
import { LoaderCircle } from "lucide-react"

const logger = createRendererLogger("app.repository")

const RepositoryManagerContext = createContext<RepositoryManager | null>(null)

function RepositoryManagerProvider({ children }: { children: ReactNode }) {
  const [manager] = useState(() => getRepositoryManager())
  const [isReady, setIsReady] = useState(false)
  const [initError, setInitError] = useState<string | null>(null)
  const [isRetrying, setIsRetrying] = useState(false)

  const initialize = useCallback(() => {
    setInitError(null)
    setIsRetrying(true)

    void manager
      .initialize()
      .then(() => {
        setIsReady(true)
        logger.info("RepositoryManager initialized.")
      })
      .catch((error) => {
        logger.error("Failed to initialize RepositoryManager.", error)
        setInitError(error instanceof Error ? error.message : "初始化失败。")
      })
      .finally(() => {
        setIsRetrying(false)
      })
  }, [manager])

  useEffect(() => {
    logger.info("Initializing RepositoryManager.")
    initialize()

    return () => {
      resetRepositoryManager()
    }
  }, [initialize])

  if (initError) {
    return (
      <main className="flex min-h-screen items-center justify-center bg-background px-6 py-10">
        <div className="flex w-full max-w-md flex-col gap-4 rounded-xl border border-border bg-card p-6">
          <h1 className="text-lg font-medium text-foreground">无法初始化</h1>
          <p className="text-sm text-muted-foreground">{initError}</p>
          <Button variant="outline" disabled={isRetrying} onClick={initialize}>
            {isRetrying ? <LoaderCircle className="mr-2 size-4 animate-spin" /> : null}
            重试
          </Button>
        </div>
      </main>
    )
  }

  if (!isReady) {
    return (
      <RepositoryManagerContext.Provider value={manager}>
        {children}
      </RepositoryManagerContext.Provider>
    )
  }

  return (
    <RepositoryManagerContext.Provider value={manager}>
      {children}
    </RepositoryManagerContext.Provider>
  )
}

function useRepositoryManager(): RepositoryManager {
  const context = useContext(RepositoryManagerContext)

  if (!context) {
    throw new Error("useRepositoryManager must be used within RepositoryManagerProvider.")
  }

  return context
}

export {
  RepositoryManagerProvider,
  useRepositoryManager,
}

export type { RepositoryOperationState } from "@/app-shell/repository-manager"
```

- [ ] **Step 2: 运行 typecheck 验证**

Run: `cd desktop && pnpm typecheck`
Expected: 无类型错误

- [ ] **Step 3: Commit**

```bash
git add desktop/src/app-shell/repository.tsx
git commit -m "fix: show error state with retry when RepositoryManager initialization fails"
```

---

### Task 6: 退出时 flush 并行化 + 独立超时

**Files:**
- Modify: `desktop/electron/bootstrap/before-quit.ts:103-106`

- [ ] **Step 1: 修改 runPendingPushFlow 中的 flush 逻辑**

修改 `desktop/electron/bootstrap/before-quit.ts`，将顺序 flush 改为并行 + 独立超时：

```ts
// 在 runPendingPushFlow 函数中，替换 line 103-106:
// Before:
if (result.response === 0) {
  for (const repository of config.repositories) {
    await contentSubmissionService.flushPendingPushes(repository)
  }
}

// After:
if (result.response === 0) {
  const PER_REPO_FLUSH_TIMEOUT_MS = 5_000

  await Promise.allSettled(
    config.repositories.map(async (repository) => {
      try {
        await Promise.race([
          contentSubmissionService.flushPendingPushes(repository),
          new Promise<never>((_, reject) =>
            setTimeout(
              () => reject(new Error("单仓库 flush 超时。")),
              PER_REPO_FLUSH_TIMEOUT_MS,
            ),
          ),
        ])
      } catch (error) {
        logger.warn("Before-quit flush failed for repository.", {
          repositoryUuid: repository.uuid,
          error,
        })
      }
    }),
  )
}
```

- [ ] **Step 2: 运行 typecheck 验证**

Run: `cd desktop && pnpm typecheck`
Expected: 无类型错误

- [ ] **Step 3: Commit**

```bash
git add desktop/electron/bootstrap/before-quit.ts
git commit -m "fix: parallelize before-quit flush with per-repository timeout"
```

---

### Task 7: IdentityGate error 状态添加重试

**Files:**
- Modify: `desktop/src/app-shell/components/identity-gate.tsx:52-60`

- [ ] **Step 1: 添加重试按钮到 error 状态**

修改 `desktop/src/app-shell/components/identity-gate.tsx:52-60`：

```tsx
// Before:
if (error) {
  return (
    <IdentityScreenShell>
      <div className="flex flex-col gap-3">
        <h1 className="text-lg font-medium text-foreground">无法读取身份信息</h1>
        <p className="text-sm text-muted-foreground">{error}</p>
      </div>
    </IdentityScreenShell>
  )
}

// After:
if (error) {
  return (
    <IdentityScreenShell>
      <div className="flex flex-col gap-3">
        <h1 className="text-lg font-medium text-foreground">无法读取身份信息</h1>
        <p className="text-sm text-muted-foreground">{error}</p>
        <div className="flex justify-end">
          <Button
            variant="outline"
            onClick={() => window.location.reload()}
          >
            重试
          </Button>
        </div>
      </div>
    </IdentityScreenShell>
  )
}
```

`Button` 已在文件顶部 import（line 6）。`useLocalIdentity` hook 没有暴露 retry 方法，最简单可靠的重试方式是 reload 页面，与全局 ErrorBoundary 的恢复策略一致。

- [ ] **Step 2: 运行 typecheck 验证**

Run: `cd desktop && pnpm typecheck`
Expected: 无类型错误

- [ ] **Step 3: Commit**

```bash
git add desktop/src/app-shell/components/identity-gate.tsx
git commit -m "fix: add retry button to IdentityGate error state"
```

---

### Task 8: ContentDetailDialog 保存流程修复

**Files:**
- Modify: `desktop/src/modules/content/components/content-detail-dialog.tsx:274-313`

- [ ] **Step 1: 修改 handleSave 为先保存再关闭**

修改 `desktop/src/modules/content/components/content-detail-dialog.tsx:274-313`：

```tsx
// Before:
const handleSave = async (payload: TPayload, force = false) => {
  if (!detail) {
    return
  }

  logger.info(`${labels.singular} save initiated from detail dialog.`, {
    contentId: detail.id,
    contentType,
    force,
  })
  setIsEditOpen(false)
  onOpenChange(false)

  const serializedPayload = serializePayload
    ? await serializePayload(payload)
    : payload

  void promise(
    async () => {
      // ... save logic ...
    },
    { loading: "正在保存...", ... },
  )
}

// After:
const [isSaving, setIsSaving] = useState(false)

const handleSave = async (payload: TPayload, force = false) => {
  if (!detail) {
    return
  }

  logger.info(`${labels.singular} save initiated from detail dialog.`, {
    contentId: detail.id,
    contentType,
    force,
  })

  setIsSaving(true)

  const serializedPayload = serializePayload
    ? await serializePayload(payload)
    : payload

  void promise(
    async () => {
      const updatePayload: SynapseUpdateContentPayload<typeof item.type> = {
        ...serializedPayload as SynapseUpdateContentPayload<typeof item.type>,
        id: detail.id,
        baseHistoryDirname: detail.latestHistoryDirname,
        force,
      }
      const result = await manager.updateContent(contentType, updatePayload)

      if (result.status !== "saved") {
        return result
      }

      invalidateIconImageCache(contentType, detail.id)
      onContentChanged?.()

      if (result.pendingPushCount > 0 && activeRepository) {
        await manager.waitForBackgroundPush(activeRepository.uuid)
      }

      return result
    },
    {
      loading: "正在保存...",
      success: (result) => {
        if (result.status === "conflict") {
          // conflict 处理逻辑不变 — 保持弹窗打开
          logger.warn("Content save conflict detected.", {
            contentId: detail.id,
            contentType,
            latestHistoryDirname: result.latestHistoryDirname ?? null,
          })
          setConflictState({
            latestHistoryDirname: result.latestHistoryDirname ?? "",
            latestModifiedAt: result.latestModifiedAt ?? "",
            latestModifiedByDisplayName: result.latestModifiedByDisplayName ?? "",
            mode: "save",
            payload,
          })
          return "内容有冲突，请确认。"
        }

        // 保存成功后关闭弹窗
        setIsEditOpen(false)
        onOpenChange(false)
        return `${labels.singular}已保存。`
      },
      error: (error) => {
        // 保存失败时保持弹窗打开
        return error instanceof Error ? error.message : "保存失败。"
      },
    },
  ).finally(() => {
    setIsSaving(false)
  })
}
```

注意：需要确认 `promise()` 工具函数的 `success` 回调中原有的 conflict 处理逻辑完整保留。同时需要将 `isSaving` 状态传递给编辑表单组件，禁用保存按钮和关闭按钮。具体的 prop 传递取决于 `ContentEditForm` 的接口——在实现时检查该组件是否接受 `disabled` 或 `loading` prop。

- [ ] **Step 2: 运行 typecheck 验证**

Run: `cd desktop && pnpm typecheck`
Expected: 无类型错误

- [ ] **Step 3: Commit**

```bash
git add desktop/src/modules/content/components/content-detail-dialog.tsx
git commit -m "fix: keep dialog open during save to prevent data loss on failure"
```

---

### Task 9: backgroundPush 失败自动重试

**Files:**
- Modify: `desktop/electron/modules/content/ipc.ts:79-160` (scheduleBackgroundPush)

- [ ] **Step 1: 添加指数退避重试逻辑**

修改 `desktop/electron/modules/content/ipc.ts` 中的 `scheduleBackgroundPush` 函数：

```ts
const BACKGROUND_PUSH_MAX_RETRIES = 3
const BACKGROUND_PUSH_RETRY_DELAYS = [5_000, 15_000, 45_000]

function scheduleBackgroundPush(eventBus: EventBus, repository: SynapseRepositoryConfig): void {
  const activeState = backgroundPushStates.get(repository.uuid)

  if (activeState) {
    activeState.rerunRequested = true
    return
  }

  const nextState = {
    rerunRequested: false,
  }

  backgroundPushStates.set(repository.uuid, nextState)

  void (async () => {
    let retryCount = 0

    try {
      while (true) {
        nextState.rerunRequested = false

        eventBus.emit({
          domain: "repository",
          type: "repository.progress",
          payload: {
            repositoryUuid: repository.uuid,
            operation: "push",
            statusText: retryCount > 0 ? `正在重试同步（第 ${retryCount} 次）...` : "正在同步...",
            percent: 0,
          },
          timestamp: new Date().toISOString(),
        })

        try {
          await contentSubmissionService.flushPendingPushes(repository, (statusText) => {
            eventBus.emit({
              domain: "repository",
              type: "repository.progress",
              payload: {
                repositoryUuid: repository.uuid,
                operation: "push",
                statusText,
                percent: null,
              },
              timestamp: new Date().toISOString(),
            })
          })

          retryCount = 0
        } catch (error) {
          const message = error instanceof Error ? error.message : "推送到仓库失败。"

          if (retryCount < BACKGROUND_PUSH_MAX_RETRIES) {
            const delay = BACKGROUND_PUSH_RETRY_DELAYS[retryCount] ?? 45_000
            retryCount++

            logger.warn("Background push failed, scheduling retry.", {
              repositoryUuid: repository.uuid,
              retryCount,
              delayMs: delay,
              error: message,
            })

            eventBus.emit({
              domain: "repository",
              type: "repository.updated",
              payload: {
                repositoryUuid: repository.uuid,
                operation: "push",
                completedAt: new Date().toISOString(),
                error: `${message} ${delay / 1000}秒后重试...`,
                message,
              },
              timestamp: new Date().toISOString(),
            })

            await new Promise<void>((resolve) => setTimeout(resolve, delay))
            continue
          }

          await notifyPendingPushesUpdated(eventBus, repository)

          eventBus.emit({
            domain: "repository",
            type: "repository.updated",
            payload: {
              repositoryUuid: repository.uuid,
              operation: "push",
              completedAt: new Date().toISOString(),
              error: message,
              message,
            },
            timestamp: new Date().toISOString(),
          })
          return
        }

        const pendingPushes = await contentSubmissionService.readPendingPushState(repository)

        eventBus.emit({
          domain: "repository",
          type: "repository.pendingPushesUpdated",
          payload: {
            repositoryUuid: repository.uuid,
            pendingPushes,
          },
          timestamp: new Date().toISOString(),
        })

        if (nextState.rerunRequested || pendingPushes.count > 0) {
          continue
        }

        // 原有的 repository.updated 成功事件和 break 逻辑保持不变
        // ... (从原代码中保留 success path)
        break
      }
    } finally {
      backgroundPushStates.delete(repository.uuid)
    }
  })()
}
```

注意：实现时需要保留原函数中 while 循环末尾的 `repository.updated` 成功事件发送和 `break` 逻辑。上面的代码展示了核心的重试结构，实现时需要与原代码的完整 while 循环体合并。同时需要在文件顶部添加 `logger` 的 import（如果尚未存在）。

- [ ] **Step 2: 运行 typecheck 验证**

Run: `cd desktop && pnpm typecheck`
Expected: 无类型错误

- [ ] **Step 3: Commit**

```bash
git add desktop/electron/modules/content/ipc.ts
git commit -m "fix: add exponential backoff retry for background push failures"
```

---

### Task 10: 最终验证

- [ ] **Step 1: 运行完整 typecheck**

Run: `cd desktop && pnpm typecheck`
Expected: 无类型错误

- [ ] **Step 2: 运行测试**

Run: `cd desktop && pnpm test`
Expected: 所有测试通过

- [ ] **Step 3: 检查所有修改文件**

Run: `git diff --stat main`
Expected: 确认所有修改文件与计划一致
