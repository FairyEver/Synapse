# Git Sync Manager Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Build a centralized Git sync manager so all save/sync entry points share one state source, recover cleanly from weak networks, and expose Git status through the top-right status center.

**Architecture:** Add typed sync snapshots and a main-process `RepositorySyncCoordinator` that owns push/sync execution, retry metadata, and Git failure classification. Renderer `RepositoryManager` consumes one snapshot stream and feeds the toolbar status center; content pages stop inferring offline/pending state locally.

**Tech Stack:** Electron main process, TypeScript, React 19, shadcn/ui + Radix, Vitest, existing EventBus IPC bridge, SQLite-backed repository cache.

---

## File Structure

- `desktop/src/types/repository.ts`: shared sync snapshot, failure category, and pending push metadata types.
- `desktop/electron/services/git-error-utils.ts`: typed Git failure classifier and UI message metadata.
- `desktop/electron/services/__tests__/git-error-utils.test.ts`: classifier coverage.
- `desktop/electron/services/repository-cache-database.ts`: pending push schema migration columns.
- `desktop/electron/services/pending-pushes-service.ts`: retry metadata persistence helpers.
- `desktop/electron/services/__tests__/pending-pushes-service.test.ts`: pending row metadata and migration coverage.
- `desktop/electron/services/repository-sync-coordinator.ts`: single owner for repository sync execution and snapshots.
- `desktop/electron/services/__tests__/repository-sync-coordinator.test.ts`: coordinator request merging, final snapshots, and retry policy tests.
- `desktop/electron/bootstrap/descriptors.ts`: register `repo.sync-coordinator`.
- `desktop/electron/modules/repository/ipc.ts`: expose snapshot read APIs and route sync/flush/maintenance through coordinator.
- `desktop/electron/modules/content/ipc.ts`: remove local background push state and submit push intent to coordinator.
- `desktop/electron/modules/content/ipc.test.ts`: verify content IPC submits push intent to the coordinator once.
- `desktop/electron/bootstrap/before-quit.ts`: use coordinator flush/summary path.
- `desktop/electron/preload.ts`: expose `repository.getSyncSnapshots` and `repository.onSyncSnapshotUpdated`.
- `desktop/src/types/bridge.ts`: add bridge methods for sync snapshots.
- `desktop/src/app-shell/repository-manager.ts`: store and distribute sync snapshots; remove local offline inference.
- `desktop/src/app-shell/use-repository-manager.ts`: expose `useRepositorySyncSnapshot`.
- `desktop/src/app-shell/use-app-shell-toolbar-state.ts`: derive toolbar state from sync snapshot.
- `desktop/src/app-shell/components/sync-status-chip.tsx`: support `attention` and read-only status center entry.
- `desktop/src/app-shell/components/git-sync-status-center.tsx`: top-right detail panel.
- `desktop/src/app-shell/components/app-shell-actions.tsx`: render status center instead of pending-only chip behavior.
- `desktop/src/App.tsx`: remove `isOffline` and scattered pending push dialog ownership.
- `desktop/src/modules/content/create-content-module.tsx`: stop disabling creation due to pending push; use local-first save copy.
- `desktop/src/modules/content/components/content-detail-dialog.tsx`: stop waiting for background push after save; stop disabling edit due to pending push.
- `desktop/src/modules/content/components/content-browser-page.tsx`: remove pending-push-only action blocking.
- `desktop/src/modules/editor-scan/components/scan-item-detail-dialog.tsx`: remove pending-push-only publish blocking.
- `desktop/src/app-shell/__tests__/repository-manager.test.ts`: snapshot state coverage.
- `desktop/src/app-shell/__tests__/git-sync-status-center.test.tsx`: status center rendering coverage.

---

### Task 1: Shared Sync Types And Git Failure Classifier

**Files:**
- Modify: `desktop/src/types/repository.ts`
- Modify: `desktop/electron/services/git-error-utils.ts`
- Create: `desktop/electron/services/__tests__/git-error-utils.test.ts`

- [ ] **Step 1: Add shared sync types**

Add these exports to `desktop/src/types/repository.ts` after `SynapseRepositoryOperationKind`.

```ts
export const SYNAPSE_REPOSITORY_SYNC_FAILURE_CATEGORIES = [
  "network",
  "timeout",
  "auth",
  "upstream-missing",
  "diverged",
  "missing-path",
  "not-git",
  "ignored-paths",
  "git-missing",
  "no-changes",
  "unknown",
] as const

export type SynapseRepositorySyncFailureCategory =
  (typeof SYNAPSE_REPOSITORY_SYNC_FAILURE_CATEGORIES)[number]

export type SynapseRepositorySyncStatus =
  | "synced"
  | "syncing"
  | "pending"
  | "offline"
  | "attention"

export type SynapseRepositorySyncPhase =
  | "preparing"
  | "running"
  | "retry-wait"
  | "blocked"
  | "completed"

export type SynapseRepositorySyncPrimaryAction =
  | "retry"
  | "open-settings"
  | "resolve-git"
  | null
```

Then extend `SynapsePendingPushEntry` and add the snapshot/event types near the existing pending push types.

```ts
export type SynapsePendingPushEntry = {
  id: number
  commitHash: string | null
  action: string
  targetId: string
  createdAt: string
  retryCount: number
  lastError: string | null
  lastErrorCategory?: SynapseRepositorySyncFailureCategory | null
  lastAttemptAt?: string | null
  nextRetryAt?: string | null
  title: string | null
}

export type SynapseRepositorySyncSnapshot = {
  repositoryUuid: string
  status: SynapseRepositorySyncStatus
  operation: SynapseRepositoryOperationKind | null
  phase: SynapseRepositorySyncPhase
  pendingCount: number
  pendingItems: SynapsePendingPushEntry[]
  message: string
  detail?: string
  failureCategory?: SynapseRepositorySyncFailureCategory | null
  lastAttemptAt?: string | null
  nextRetryAt?: string | null
  retryCount: number
  canRetryNow: boolean
  primaryAction: SynapseRepositorySyncPrimaryAction
}

export type SynapseRepositorySyncSnapshotUpdatedEvent = {
  repositoryUuid: string
  snapshot: SynapseRepositorySyncSnapshot
}
```

- [ ] **Step 2: Run typecheck to capture current failures**

Run:

```bash
pnpm --filter @synapse/desktop run typecheck
```

Expected: PASS. If it fails, fix only type errors caused by the new exported types before continuing.

- [ ] **Step 3: Add the typed classifier**

Replace `desktop/electron/services/git-error-utils.ts` with this shape while preserving `formatGitFailureMessage`.

```ts
import type { SynapseRepositorySyncFailureCategory } from "../../src/types/repository"

export type GitFailureInfo = {
  category: SynapseRepositorySyncFailureCategory
  message: string
  detail?: string
  recoverable: boolean
  primaryAction: "retry" | "open-settings" | "resolve-git" | null
}

function firstUsefulLine(output: string): string | undefined {
  return output
    .trim()
    .split(/\r?\n/)
    .map((line) => line.trim())
    .find((line) => line.length > 0)
}

export function classifyGitFailure(output: string, fallbackMessage: string): GitFailureInfo {
  const normalizedOutput = output.trim()
  const loweredOutput = normalizedOutput.toLowerCase()
  const detail = firstUsefulLine(normalizedOutput)

  if (
    loweredOutput.includes("could not resolve host")
    || loweredOutput.includes("failed to connect")
    || loweredOutput.includes("network is unreachable")
    || loweredOutput.includes("connection reset")
  ) {
    return {
      category: "network",
      message: "网络不可用，稍后自动重试。",
      detail,
      recoverable: true,
      primaryAction: "retry",
    }
  }

  if (loweredOutput.includes("connection timed out") || loweredOutput.includes("operation timed out")) {
    return {
      category: "timeout",
      message: "同步超时，稍后自动重试。",
      detail,
      recoverable: true,
      primaryAction: "retry",
    }
  }

  if (
    loweredOutput.includes("authentication failed")
    || loweredOutput.includes("could not read username")
    || loweredOutput.includes("permission denied (publickey)")
    || loweredOutput.includes("permission denied")
    || loweredOutput.includes("fatal: could not read from remote repository")
  ) {
    return {
      category: "auth",
      message: "Git 认证失败，请检查系统凭证或 SSH Key。",
      detail,
      recoverable: false,
      primaryAction: "resolve-git",
    }
  }

  if (
    loweredOutput.includes("there is no tracking information for the current branch")
    || loweredOutput.includes("no upstream configured for branch")
    || loweredOutput.includes("has no upstream branch")
  ) {
    return {
      category: "upstream-missing",
      message: "当前分支还没有配置上游分支。",
      detail,
      recoverable: false,
      primaryAction: "resolve-git",
    }
  }

  if (
    loweredOutput.includes("not possible to fast-forward")
    || loweredOutput.includes("non-fast-forward")
    || loweredOutput.includes("[rejected]")
    || loweredOutput.includes("fetch first")
    || loweredOutput.includes("merge conflict")
    || loweredOutput.includes("could not apply")
  ) {
    return {
      category: "diverged",
      message: "仓库分支需要手动处理后再同步。",
      detail,
      recoverable: false,
      primaryAction: "resolve-git",
    }
  }

  if (loweredOutput.includes("not a git repository")) {
    return {
      category: "not-git",
      message: "当前目录不是 Git 仓库。",
      detail,
      recoverable: false,
      primaryAction: "open-settings",
    }
  }

  if (
    loweredOutput.includes("paths are ignored by one of your .gitignore files")
    || loweredOutput.includes("the following paths are ignored")
  ) {
    return {
      category: "ignored-paths",
      message: "内容目录被 .gitignore 忽略，请调整仓库规则。",
      detail,
      recoverable: false,
      primaryAction: "resolve-git",
    }
  }

  if (loweredOutput.includes("nothing to commit") || loweredOutput.includes("no changes added to commit")) {
    return {
      category: "no-changes",
      message: "当前没有可提交的改动。",
      detail,
      recoverable: false,
      primaryAction: null,
    }
  }

  return {
    category: "unknown",
    message: detail ? `${fallbackMessage}\n${detail}` : fallbackMessage,
    detail,
    recoverable: false,
    primaryAction: null,
  }
}

export function formatGitFailureMessage(output: string, fallbackMessage: string): string {
  return classifyGitFailure(output, fallbackMessage).message
}
```

- [ ] **Step 4: Add classifier tests**

Create `desktop/electron/services/__tests__/git-error-utils.test.ts`.

```ts
import { describe, expect, it } from "vitest"
import { classifyGitFailure, formatGitFailureMessage } from "../git-error-utils"

describe("git-error-utils", () => {
  it("classifies network failures as recoverable", () => {
    const result = classifyGitFailure("fatal: unable to access: Could not resolve host: github.com", "fallback")

    expect(result.category).toBe("network")
    expect(result.recoverable).toBe(true)
    expect(result.message).toBe("网络不可用，稍后自动重试。")
  })

  it("classifies timeouts as recoverable", () => {
    const result = classifyGitFailure("fatal: connection timed out", "fallback")

    expect(result.category).toBe("timeout")
    expect(result.recoverable).toBe(true)
  })

  it("classifies authentication failures as attention", () => {
    const result = classifyGitFailure("Permission denied (publickey).", "fallback")

    expect(result.category).toBe("auth")
    expect(result.recoverable).toBe(false)
    expect(result.primaryAction).toBe("resolve-git")
  })

  it("keeps formatGitFailureMessage compatible", () => {
    expect(formatGitFailureMessage("fatal: not a git repository", "fallback"))
      .toBe("当前目录不是 Git 仓库。")
  })
})
```

- [ ] **Step 5: Run the focused test**

Run:

```bash
pnpm --filter @synapse/desktop exec vitest run electron/services/__tests__/git-error-utils.test.ts
```

Expected: PASS.

- [ ] **Step 6: Commit Task 1**

```bash
git add desktop/src/types/repository.ts desktop/electron/services/git-error-utils.ts desktop/electron/services/__tests__/git-error-utils.test.ts
git commit -m "feat: classify repository sync failures"
```

---

### Task 2: Pending Push Retry Metadata

**Files:**
- Modify: `desktop/electron/services/repository-cache-database.ts`
- Modify: `desktop/electron/services/pending-pushes-service.ts`
- Create: `desktop/electron/services/__tests__/pending-pushes-service.test.ts`

- [ ] **Step 1: Add schema migration columns**

In `ensureRepositoryCacheSchema`, after the `CREATE TABLE IF NOT EXISTS pending_pushes` block, add migration statements guarded the same way existing `ALTER TABLE` migrations are guarded.

```ts
  if (options.includePendingPushes) {
    database.exec(`
      CREATE TABLE IF NOT EXISTS pending_pushes (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        commit_hash TEXT,
        action TEXT,
        target_id TEXT,
        title TEXT,
        created_at TEXT,
        retry_count INTEGER DEFAULT 0,
        last_error TEXT
      );
    `)

    for (const stmt of [
      `ALTER TABLE pending_pushes ADD COLUMN last_attempt_at TEXT`,
      `ALTER TABLE pending_pushes ADD COLUMN next_retry_at TEXT`,
      `ALTER TABLE pending_pushes ADD COLUMN last_error_category TEXT`,
    ]) {
      try {
        database.exec(stmt)
      } catch (error) {
        const message = (error as Error).message ?? ""
        if (!message.includes("duplicate column")) {
          throw error
        }
      }
    }
  }
```

- [ ] **Step 2: Map new fields on read**

Update `mapPendingPushRow` in `pending-pushes-service.ts`.

```ts
    retryCount: row.retry_count,
    lastError: typeof row.last_error === "string" ? row.last_error : null,
    lastAttemptAt: typeof row.last_attempt_at === "string" ? row.last_attempt_at : null,
    nextRetryAt: typeof row.next_retry_at === "string" ? row.next_retry_at : null,
    lastErrorCategory: typeof row.last_error_category === "string"
      ? row.last_error_category as SynapsePendingPushEntry["lastErrorCategory"]
      : null,
```

- [ ] **Step 3: Add markAttempt and metadata-aware markFailure**

Add `DatabaseSync` type import at the top of `pending-pushes-service.ts`.

```ts
import type { DatabaseSync } from "node:sqlite"
```

Add this method to `PendingPushesService`.

```ts
  async markAttempt(
    repository: SynapseRepositoryConfig,
    attemptedAt: string,
    ids?: number[],
  ): Promise<SynapsePendingPushState> {
    const targetIds = getTargetIds(ids)

    if (!(await this.canUsePendingPushes(repository))) {
      return { count: 0, items: [] }
    }

    return withRepositoryCacheDatabase(repository.uuid, (database) => {
      const placeholders = targetIds?.map(() => "?").join(", ")
      const statement = database.prepare(`
        UPDATE pending_pushes
        SET last_attempt_at = ?
        ${placeholders ? `WHERE id IN (${placeholders})` : ""}
      `)

      if (targetIds) {
        statement.run(attemptedAt, ...targetIds)
      } else {
        statement.run(attemptedAt)
      }

      return this.readStateRows(database)
    }, { includePendingPushes: true })
  }
```

Refactor repeated row-reading into a private helper inside the class.

```ts
  private readStateRows(database: DatabaseSync): SynapsePendingPushState {
    const rows = database.prepare(`
      SELECT *
      FROM pending_pushes
      ORDER BY created_at ASC, id ASC
    `).all() as Record<string, unknown>[]
    const items = rows
      .map(mapPendingPushRow)
      .filter((item): item is SynapsePendingPushEntry => item !== null)

    return { count: items.length, items }
  }
```

Update `markFailure` signature and SQL.

```ts
  async markFailure(
    repository: SynapseRepositoryConfig,
    lastError: string,
    ids?: number[],
    metadata: {
      category?: SynapsePendingPushEntry["lastErrorCategory"]
      nextRetryAt?: string | null
    } = {},
  ): Promise<SynapsePendingPushState> {
```

```ts
        UPDATE pending_pushes
        SET retry_count = retry_count + 1,
            last_error = ?,
            last_error_category = ?,
            next_retry_at = ?
        ${placeholders ? `WHERE id IN (${placeholders})` : ""}
```

Run `statement.run(lastError, metadata.category ?? null, metadata.nextRetryAt ?? null, ...targetIds)`.

- [ ] **Step 4: Add pending metadata tests**

Create `desktop/electron/services/__tests__/pending-pushes-service.test.ts` with an Electron app-path mock and temp database path.

```ts
import { mkdtemp, rm } from "node:fs/promises"
import os from "node:os"
import path from "node:path"
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest"
import type { SynapseRepositoryConfig } from "../../../src/types/config"

let userDataPath = ""

vi.mock("electron", () => ({
  app: {
    getPath: vi.fn(() => userDataPath),
  },
}))

vi.mock("../repository-store", () => ({
  repositoryStore: {
    getRepositoryState: vi.fn(async (repository: SynapseRepositoryConfig) => ({
      repositoryUuid: repository.uuid,
      localPath: repository.localPath,
      status: "ready",
      isGitRepository: true,
      gitRootPath: repository.localPath,
    })),
  },
}))

describe("pendingPushesService", () => {
  const repository: SynapseRepositoryConfig = {
    uuid: "repo-1",
    name: "Repo",
    localPath: "/repo",
    contentDirs: {},
  }

  beforeEach(async () => {
    userDataPath = await mkdtemp(path.join(os.tmpdir(), "synapse-pending-"))
    vi.resetModules()
  })

  afterEach(async () => {
    await rm(userDataPath, { recursive: true, force: true })
  })

  it("persists retry metadata", async () => {
    const { pendingPushesService } = await import("../pending-pushes-service")
    const enqueued = await pendingPushesService.enqueue(repository, {
      action: "update",
      commitHash: "abc",
      targetId: "rule-1",
      title: "Rule",
    })

    await pendingPushesService.markAttempt(repository, "2026-05-02T00:00:00.000Z", [enqueued.items[0].id])
    await pendingPushesService.markFailure(repository, "网络不可用", [enqueued.items[0].id], {
      category: "network",
      nextRetryAt: "2026-05-02T00:01:00.000Z",
    })

    const state = await pendingPushesService.readState(repository)

    expect(state.items[0]).toMatchObject({
      retryCount: 1,
      lastError: "网络不可用",
      lastErrorCategory: "network",
      lastAttemptAt: "2026-05-02T00:00:00.000Z",
      nextRetryAt: "2026-05-02T00:01:00.000Z",
    })
  })
})
```

- [ ] **Step 5: Run the focused test**

Run:

```bash
pnpm --filter @synapse/desktop exec vitest run electron/services/__tests__/pending-pushes-service.test.ts
```

Expected: PASS.

- [ ] **Step 6: Commit Task 2**

```bash
git add desktop/electron/services/repository-cache-database.ts desktop/electron/services/pending-pushes-service.ts desktop/electron/services/__tests__/pending-pushes-service.test.ts
git commit -m "feat: track pending push retry metadata"
```

---

### Task 3: RepositorySyncCoordinator Core

**Files:**
- Create: `desktop/electron/services/repository-sync-coordinator.ts`
- Create: `desktop/electron/services/__tests__/repository-sync-coordinator.test.ts`

- [ ] **Step 1: Create coordinator service skeleton**

Create `desktop/electron/services/repository-sync-coordinator.ts`.

```ts
import type { EventBus } from "../runtime/event-bus"
import type { SynapseRepositoryConfig } from "../../src/types/config"
import type {
  SynapsePendingPushState,
  SynapseRepositoryOperationResult,
  SynapseRepositorySyncSnapshot,
  SynapseRepositorySyncSnapshotUpdatedEvent,
} from "../../src/types/repository"
import { configStore } from "./config-store"
import { contentIndexService } from "./content-index-service"
import { contentSubmissionService } from "./content-submission-service"
import { classifyGitFailure } from "./git-error-utils"
import { createMainLogger } from "./log-store"
import { pendingPushesService } from "./pending-pushes-service"
import { repositoryGitService } from "./repository-git-service"
import { repositoryMaintenanceService } from "./repository-maintenance-service"
import { repositoryStore } from "./repository-store"

const logger = createMainLogger("service.repository-sync")
const MAX_RETRY_DELAY_MS = 5 * 60 * 1000

type SyncRequestReason = "content-saved" | "manual" | "recovery" | "maintenance" | "initialize" | "quit"
type RepositoryExecutionState = {
  running: boolean
  rerunRequested: boolean
  retryTimer: NodeJS.Timeout | null
}

type RepositorySyncCoordinatorDeps = {
  eventBus: EventBus
  now?: () => Date
}

function createEmptySnapshot(repositoryUuid: string): SynapseRepositorySyncSnapshot {
  return {
    repositoryUuid,
    status: "synced",
    operation: null,
    phase: "completed",
    pendingCount: 0,
    pendingItems: [],
    message: "已同步",
    retryCount: 0,
    canRetryNow: false,
    primaryAction: null,
  }
}
```

- [ ] **Step 2: Implement snapshot helpers**

Add the class with snapshot read and emit methods.

```ts
class RepositorySyncCoordinator {
  private readonly eventBus: EventBus
  private readonly now: () => Date
  private readonly executions = new Map<string, RepositoryExecutionState>()
  private readonly snapshots = new Map<string, SynapseRepositorySyncSnapshot>()

  constructor(deps: RepositorySyncCoordinatorDeps) {
    this.eventBus = deps.eventBus
    this.now = deps.now ?? (() => new Date())
  }

  getSnapshot(repositoryUuid: string): SynapseRepositorySyncSnapshot {
    return this.snapshots.get(repositoryUuid) ?? createEmptySnapshot(repositoryUuid)
  }

  getSnapshots(): SynapseRepositorySyncSnapshot[] {
    return Array.from(this.snapshots.values())
  }

  async refreshSnapshot(repository: SynapseRepositoryConfig): Promise<SynapseRepositorySyncSnapshot> {
    const pending = await pendingPushesService.readState(repository)
    const snapshot = this.createSnapshotFromPending(repository.uuid, pending)
    this.emitSnapshot(snapshot)
    return snapshot
  }

  private createSnapshotFromPending(
    repositoryUuid: string,
    pending: SynapsePendingPushState,
  ): SynapseRepositorySyncSnapshot {
    if (pending.count === 0) {
      return createEmptySnapshot(repositoryUuid)
    }

    const firstError = pending.items.find((item) => item.lastErrorCategory || item.lastError)
    const retryCount = pending.items.reduce((total, item) => total + item.retryCount, 0)
    const nextRetryAt = pending.items
      .map((item) => item.nextRetryAt)
      .filter((value): value is string => Boolean(value))
      .sort()[0] ?? null

    return {
      repositoryUuid,
      status: firstError?.lastErrorCategory === "network" || firstError?.lastErrorCategory === "timeout"
        ? "offline"
        : firstError?.lastErrorCategory
          ? "attention"
          : "pending",
      operation: null,
      phase: nextRetryAt ? "retry-wait" : "completed",
      pendingCount: pending.count,
      pendingItems: pending.items,
      message: firstError?.lastError ?? `${pending.count} 条变更等待同步`,
      detail: firstError?.title ?? undefined,
      failureCategory: firstError?.lastErrorCategory ?? null,
      lastAttemptAt: pending.items.find((item) => item.lastAttemptAt)?.lastAttemptAt ?? null,
      nextRetryAt,
      retryCount,
      canRetryNow: true,
      primaryAction: firstError?.lastErrorCategory ? "retry" : "retry",
    }
  }

  private emitSnapshot(snapshot: SynapseRepositorySyncSnapshot): void {
    this.snapshots.set(snapshot.repositoryUuid, snapshot)
    this.eventBus.emit({
      domain: "repository",
      type: "repository.syncSnapshotUpdated",
      payload: {
        repositoryUuid: snapshot.repositoryUuid,
        snapshot,
      } satisfies SynapseRepositorySyncSnapshotUpdatedEvent,
      timestamp: this.now().toISOString(),
    })
  }
}

export { RepositorySyncCoordinator }
```

- [ ] **Step 3: Add requestPush loop**

Add `requestPush`, execution state helpers, and failure handling.

```ts
  async requestPush(repository: SynapseRepositoryConfig, reason: SyncRequestReason): Promise<void> {
    const state = this.getExecutionState(repository.uuid)

    if (state.running) {
      state.rerunRequested = true
      return
    }

    state.running = true

    try {
      let shouldContinue = false
      do {
        state.rerunRequested = false
        shouldContinue = await this.runPushOnce(repository, reason)
      } while (state.rerunRequested || shouldContinue)
    } finally {
      state.running = false
      await this.refreshSnapshot(repository)
    }
  }

  private getExecutionState(repositoryUuid: string): RepositoryExecutionState {
    let state = this.executions.get(repositoryUuid)
    if (!state) {
      state = { running: false, rerunRequested: false, retryTimer: null }
      this.executions.set(repositoryUuid, state)
    }
    return state
  }

  private async runPushOnce(repository: SynapseRepositoryConfig, reason: SyncRequestReason): Promise<boolean> {
    const pending = await pendingPushesService.readState(repository)
    if (pending.count === 0) {
      this.emitSnapshot(createEmptySnapshot(repository.uuid))
      return false
    }

    const attemptedIds = pending.items.map((item) => item.id)
    const attemptedAt = this.now().toISOString()
    const nextRetryCount = Math.max(1, ...pending.items.map((item) => item.retryCount + 1))
    await pendingPushesService.markAttempt(repository, attemptedAt, attemptedIds)
    this.emitSnapshot({
      repositoryUuid: repository.uuid,
      status: "syncing",
      operation: "push",
      phase: "running",
      pendingCount: pending.count,
      pendingItems: pending.items,
      message: "正在同步变更",
      lastAttemptAt: attemptedAt,
      retryCount: pending.items.reduce((sum, item) => sum + item.retryCount, 0),
      canRetryNow: false,
      primaryAction: null,
    })

    try {
      await contentSubmissionService.flushPendingPushes(repository, (statusText) => {
        const current = this.getSnapshot(repository.uuid)
        this.emitSnapshot({ ...current, status: "syncing", operation: "push", phase: "running", message: statusText })
      })
      await contentIndexService.syncIndex(repository)
      const remaining = await pendingPushesService.readState(repository)
      return remaining.count > 0
    } catch (error) {
      await this.handlePushFailure(repository, attemptedIds, nextRetryCount, error)
      return false
    }
  }
```

- [ ] **Step 4: Add retry classification**

Add these methods to the coordinator.

```ts
  private calculateNextRetryAt(retryCount: number): string {
    const delayMs = Math.min(30_000 * Math.max(1, retryCount), MAX_RETRY_DELAY_MS)
    return new Date(this.now().getTime() + delayMs).toISOString()
  }

  private async handlePushFailure(
    repository: SynapseRepositoryConfig,
    attemptedIds: number[],
    nextRetryCount: number,
    error: unknown,
  ): Promise<void> {
    const fallback = error instanceof Error ? error.message : "推送到仓库失败。"
    const failure = classifyGitFailure(fallback, "推送到仓库失败。")
    const retryState = await pendingPushesService.markFailure(repository, failure.message, attemptedIds, {
      category: failure.category,
      nextRetryAt: failure.recoverable ? this.calculateNextRetryAt(nextRetryCount) : null,
    })
    const snapshot = this.createSnapshotFromPending(repository.uuid, retryState)

    this.emitSnapshot({
      ...snapshot,
      status: failure.recoverable ? "offline" : "attention",
      phase: failure.recoverable ? "retry-wait" : "blocked",
      message: failure.message,
      detail: failure.detail,
      failureCategory: failure.category,
      canRetryNow: true,
      primaryAction: failure.primaryAction,
    })

    if (failure.recoverable) {
      this.scheduleRetry(repository)
    }

    logger.warn("Repository push failed.", {
      category: failure.category,
      repositoryUuid: repository.uuid,
    })
  }

  private async handleOperationFailure(
    repository: SynapseRepositoryConfig,
    operation: SynapseRepositoryOperationKind,
    error: unknown,
  ): Promise<void> {
    const fallback = error instanceof Error ? error.message : "仓库同步失败。"
    const failure = classifyGitFailure(fallback, "仓库同步失败。")
    const pending = await pendingPushesService.readState(repository)
    const snapshot = this.createSnapshotFromPending(repository.uuid, pending)

    this.emitSnapshot({
      ...snapshot,
      status: failure.recoverable ? "offline" : "attention",
      operation,
      phase: failure.recoverable ? "retry-wait" : "blocked",
      message: failure.message,
      detail: failure.detail,
      failureCategory: failure.category,
      canRetryNow: true,
      primaryAction: failure.primaryAction,
    })
  }

  private scheduleRetry(repository: SynapseRepositoryConfig): void {
    const state = this.getExecutionState(repository.uuid)
    if (state.retryTimer) {
      clearTimeout(state.retryTimer)
    }
    state.retryTimer = setTimeout(() => {
      state.retryTimer = null
      void this.requestPush(repository, "recovery")
    }, 30_000)
    state.retryTimer.unref?.()
  }
```

- [ ] **Step 5: Add requestSync, maintenance, and summary methods**

Add methods that keep manual sync centralized.

```ts
  async requestSync(repository: SynapseRepositoryConfig, reason: SyncRequestReason): Promise<SynapseRepositoryOperationResult> {
    const pending = await pendingPushesService.readState(repository)
    if (pending.count > 0) {
      await this.requestPush(repository, reason)
      const repositoryState = await repositoryStore.getRepositoryState(repository)
      return {
        operation: "push",
        repository: repositoryState,
        completedAt: this.now().toISOString(),
        pendingPushCount: (await pendingPushesService.readState(repository)).count,
      }
    }

    this.emitSnapshot({
      ...createEmptySnapshot(repository.uuid),
      status: "syncing",
      operation: "sync",
      phase: "running",
      message: "正在同步仓库",
      canRetryNow: false,
    })

    try {
      const result = await repositoryGitService.syncRepository(repository, (event) => {
        const current = this.getSnapshot(repository.uuid)
        this.emitSnapshot({ ...current, status: "syncing", operation: "sync", phase: "running", message: event.statusText })
      })
      await this.refreshSnapshot(repository)
      return result
    } catch (error) {
      await this.handleOperationFailure(repository, "sync", error)
      throw error
    }
  }

  async requestMaintenance(repository: SynapseRepositoryConfig): Promise<SynapseRepositoryOperationResult> {
    const result = await repositoryMaintenanceService.runManualMaintenance(repository, (statusText) => {
      const current = this.getSnapshot(repository.uuid)
      this.emitSnapshot({ ...current, status: "syncing", operation: "maintenance", phase: "running", message: statusText })
    })
    await this.refreshSnapshot(repository)
    return {
      operation: "maintenance",
      repository: await repositoryStore.getRepositoryState(repository),
      completedAt: this.now().toISOString(),
      message: result.message,
      pendingPushCount: result.pendingPushCount,
    }
  }

  async countAllPending(): Promise<number> {
    const config = await configStore.load()
    return pendingPushesService.countAll(config.repositories)
  }
```

- [ ] **Step 6: Add coordinator tests**

Create `desktop/electron/services/__tests__/repository-sync-coordinator.test.ts`. Mock `pendingPushesService`, `contentSubmissionService`, `contentIndexService`, `repositoryStore`, `repositoryGitService`, and `repositoryMaintenanceService`.

```ts
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest"
import type { EventBus } from "../../runtime/event-bus"
import type { SynapseRepositoryConfig } from "../../../src/types/config"
import type { SynapsePendingPushState } from "../../../src/types/repository"

const mocks = vi.hoisted(() => ({
  contentIndexService: {
    syncIndex: vi.fn(async () => undefined),
  },
  contentSubmissionService: {
    flushPendingPushes: vi.fn(async () => undefined),
  },
  pendingPushesService: {
    markAttempt: vi.fn(async () => undefined),
    markFailure: vi.fn(),
    readState: vi.fn(),
  },
  repositoryGitService: {
    syncRepository: vi.fn(),
  },
  repositoryMaintenanceService: {
    runManualMaintenance: vi.fn(),
  },
  repositoryStore: {
    getRepositoryState: vi.fn(async () => ({
      repositoryUuid: "repo-1",
      localPath: "/repo",
      status: "ready",
      isGitRepository: true,
      gitRootPath: "/repo",
    })),
  },
}))

vi.mock("../content-index-service", () => ({
  contentIndexService: mocks.contentIndexService,
}))

vi.mock("../content-submission-service", () => ({
  contentSubmissionService: mocks.contentSubmissionService,
}))

vi.mock("../pending-pushes-service", () => ({
  pendingPushesService: mocks.pendingPushesService,
}))

vi.mock("../repository-git-service", () => ({
  repositoryGitService: mocks.repositoryGitService,
}))

vi.mock("../repository-maintenance-service", () => ({
  repositoryMaintenanceService: mocks.repositoryMaintenanceService,
}))

vi.mock("../repository-store", () => ({
  repositoryStore: mocks.repositoryStore,
}))

vi.mock("../config-store", () => ({
  configStore: {
    load: vi.fn(async () => ({ repositories: [] })),
  },
}))

vi.mock("../log-store", () => ({
  createMainLogger: () => ({
    debug: vi.fn(),
    error: vi.fn(),
    info: vi.fn(),
    warn: vi.fn(),
  }),
}))

const repository: SynapseRepositoryConfig = {
  uuid: "repo-1",
  name: "Repo",
  localPath: "/repo",
  contentDirs: {},
}

const emptyPending: SynapsePendingPushState = {
  count: 0,
  items: [],
}

const pending: SynapsePendingPushState = {
  count: 1,
  items: [{
    id: 1,
    commitHash: "abc",
    action: "update",
    targetId: "rule-1",
    title: "Rule",
    createdAt: "2026-05-02T00:00:00.000Z",
    retryCount: 0,
    lastError: null,
    lastErrorCategory: null,
    lastAttemptAt: null,
    nextRetryAt: null,
  }],
}

function createEventBus() {
  const events: unknown[] = []
  return {
    events,
    eventBus: {
      emit: vi.fn((event) => events.push(event)),
    } as unknown as EventBus,
  }
}

async function createCoordinator() {
  const { RepositorySyncCoordinator } = await import("../repository-sync-coordinator")
  const { eventBus, events } = createEventBus()
  const coordinator = new RepositorySyncCoordinator({
    eventBus,
    now: () => new Date("2026-05-02T00:00:00.000Z"),
  })

  return { coordinator, events }
}

describe("RepositorySyncCoordinator", () => {
  beforeEach(() => {
    vi.clearAllMocks()
    mocks.pendingPushesService.readState.mockResolvedValue(emptyPending)
    mocks.pendingPushesService.markFailure.mockResolvedValue(emptyPending)
  })

  afterEach(() => {
    vi.clearAllTimers()
    vi.useRealTimers()
  })

  it("emits synced snapshot for empty pending queue", async () => {
    const { coordinator, events } = await createCoordinator()

    await coordinator.refreshSnapshot(repository)

    expect(coordinator.getSnapshot(repository.uuid).status).toBe("synced")
    expect(events).toHaveLength(1)
  })

  it("classifies network push failures as offline snapshots", async () => {
    vi.useFakeTimers()
    const failedPending: SynapsePendingPushState = {
      count: 1,
      items: [{
        ...pending.items[0],
        retryCount: 1,
        lastError: "网络不可用，稍后自动重试。",
        lastErrorCategory: "network",
        lastAttemptAt: "2026-05-02T00:00:00.000Z",
        nextRetryAt: "2026-05-02T00:00:30.000Z",
      }],
    }
    mocks.pendingPushesService.readState
      .mockResolvedValueOnce(pending)
      .mockResolvedValueOnce(failedPending)
    mocks.pendingPushesService.markFailure.mockResolvedValue(failedPending)
    mocks.contentSubmissionService.flushPendingPushes.mockRejectedValueOnce(
      new Error("fatal: unable to access remote: Could not resolve host"),
    )
    const { coordinator } = await createCoordinator()

    await coordinator.requestPush(repository, "manual")

    expect(coordinator.getSnapshot(repository.uuid)).toMatchObject({
      status: "offline",
      phase: "retry-wait",
      failureCategory: "network",
      primaryAction: "retry",
    })
    expect(mocks.pendingPushesService.markFailure).toHaveBeenCalledWith(
      repository,
      "网络不可用，稍后自动重试。",
      [1],
      {
        category: "network",
        nextRetryAt: "2026-05-02T00:00:30.000Z",
      },
    )
  })

  it("merges duplicate push requests while running", async () => {
    let resolveFlush: () => void = () => {}
    const flushPromise = new Promise<void>((resolve) => {
      resolveFlush = resolve
    })
    mocks.pendingPushesService.readState
      .mockResolvedValueOnce(pending)
      .mockResolvedValueOnce(emptyPending)
      .mockResolvedValueOnce(emptyPending)
    mocks.contentSubmissionService.flushPendingPushes.mockReturnValueOnce(flushPromise)
    const { coordinator } = await createCoordinator()

    const first = coordinator.requestPush(repository, "manual")
    await new Promise((resolve) => setTimeout(resolve, 0))
    const second = coordinator.requestPush(repository, "content-saved")

    expect(mocks.contentSubmissionService.flushPendingPushes).toHaveBeenCalledTimes(1)

    resolveFlush()
    await Promise.all([first, second])

    expect(mocks.contentSubmissionService.flushPendingPushes).toHaveBeenCalledTimes(1)
  })
})
```

- [ ] **Step 7: Run coordinator tests**

Run:

```bash
pnpm --filter @synapse/desktop exec vitest run electron/services/__tests__/repository-sync-coordinator.test.ts
```

Expected: PASS.

- [ ] **Step 8: Commit Task 3**

```bash
git add desktop/electron/services/repository-sync-coordinator.ts desktop/electron/services/__tests__/repository-sync-coordinator.test.ts
git commit -m "feat: add repository sync coordinator"
```

---

### Task 4: IPC, Preload, And Service Wiring

**Files:**
- Modify: `desktop/electron/bootstrap/descriptors.ts`
- Modify: `desktop/electron/bootstrap/registry.ts`
- Modify: `desktop/electron/bootstrap/index.ts`
- Modify: `desktop/electron/modules/repository/ipc.ts`
- Modify: `desktop/electron/preload.ts`
- Modify: `desktop/src/types/bridge.ts`

- [ ] **Step 1: Register the coordinator descriptor**

In `descriptors.ts`, import the class and add a descriptor.

```ts
import { RepositorySyncCoordinator } from "../services/repository-sync-coordinator"
```

```ts
export const repoSyncCoordinatorDescriptor: ServiceDescriptor<RepositorySyncCoordinator> = {
  id: "repo.sync-coordinator",
  criticality: "degraded",
  dependsOn: ["core.event-bus", "repo.pending-pushes"],
  create(ctx) {
    return new RepositorySyncCoordinator({
      eventBus: ctx.registry.get<EventBus>("core.event-bus"),
    })
  },
}
```

In `registry.ts`, add `repoSyncCoordinatorDescriptor` to the descriptor import list and register it after `repoPendingPushesDescriptor`.

```ts
  repoMaintenanceDescriptor,
  repoPendingPushesDescriptor,
  repoSyncCoordinatorDescriptor,
  repoWatchDescriptor,
```

```ts
  registry.register(repoMaintenanceDescriptor)
  registry.register(repoPendingPushesDescriptor)
  registry.register(repoSyncCoordinatorDescriptor)
  registry.register(createUiTrayDescriptor(options.trayShowOrCreate))
```

In `index.ts`, export the new descriptor from the bootstrap barrel.

```ts
  repoMaintenanceDescriptor,
  repoPendingPushesDescriptor,
  repoSyncCoordinatorDescriptor,
  repoWatchDescriptor,
```

- [ ] **Step 2: Add IPC schemas**

In `repository/ipc.ts`, import `RepositorySyncCoordinator` and update `pendingPushEntrySchema` so it includes the retry metadata added in Task 2.

```ts
const syncFailureCategorySchema = z.enum([
  "network",
  "timeout",
  "auth",
  "upstream-missing",
  "diverged",
  "missing-path",
  "not-git",
  "ignored-paths",
  "git-missing",
  "no-changes",
  "unknown",
])
```

```ts
const pendingPushEntrySchema = z.object({
  id: z.number(),
  commitHash: z.string().nullable(),
  action: z.string(),
  targetId: z.string(),
  createdAt: z.string(),
  retryCount: z.number(),
  lastError: z.string().nullable(),
  lastErrorCategory: syncFailureCategorySchema.nullable().optional(),
  lastAttemptAt: z.string().nullable().optional(),
  nextRetryAt: z.string().nullable().optional(),
  title: z.string().nullable(),
})
```

Define the sync snapshot schema after `pendingPushesSchema`.

```ts
const syncSnapshotSchema = z.object({
  repositoryUuid: z.string(),
  status: z.enum(["synced", "syncing", "pending", "offline", "attention"]),
  operation: z.enum(["sync", "push", "maintenance", "initialize"]).nullable(),
  phase: z.enum(["preparing", "running", "retry-wait", "blocked", "completed"]),
  pendingCount: z.number(),
  pendingItems: z.array(pendingPushEntrySchema),
  message: z.string(),
  detail: z.string().optional(),
  failureCategory: syncFailureCategorySchema.nullable().optional(),
  lastAttemptAt: z.string().nullable().optional(),
  nextRetryAt: z.string().nullable().optional(),
  retryCount: z.number(),
  canRetryNow: z.boolean(),
  primaryAction: z.enum(["retry", "open-settings", "resolve-git"]).nullable(),
})
```

- [ ] **Step 3: Expose `getSyncSnapshots`**

Add a repository IPC method.

```ts
    getSyncSnapshots: {
      kind: "invoke",
      channel: "synapse:repository:get-sync-snapshots",
      request: z.void(),
      response: z.array(syncSnapshotSchema),
      handler: async (ctx) => {
        const coordinator = ctx.resolve<RepositorySyncCoordinator>("repo.sync-coordinator")
        return coordinator.getSnapshots()
      },
    },
```

- [ ] **Step 4: Route manual sync and flush through coordinator**

In `sync`, resolve the coordinator and replace `repositoryGitService.syncRepository(...)` with:

```ts
const coordinator = ctx.resolve<RepositorySyncCoordinator>("repo.sync-coordinator")
const result = await coordinator.requestSync(repository, "manual")
```

In `flushPendingPushes`, replace direct `contentSubmissionService.flushPendingPushes(...)` with:

```ts
const coordinator = ctx.resolve<RepositorySyncCoordinator>("repo.sync-coordinator")
await coordinator.requestPush(repository, "manual")
```

Keep existing `repository.updated` and `repository.pendingPushesUpdated` emissions during the transition only if renderer still depends on them. Do not emit duplicate user messages from the IPC handler.

- [ ] **Step 5: Add preload bridge methods**

In `desktop/electron/preload.ts`, add the generated channel key to `IPC_CHANNELS.repository` after running `generate:ipc`, then add the bridge methods to `repository`:

```ts
    getSyncSnapshots: invoke(IPC_CHANNELS.repository.getSyncSnapshots),
    onSyncSnapshotUpdated: createDomainEventPayloadSubscription<SynapseRepositorySyncSnapshotUpdatedEvent>(
      subscribe,
      "repository",
      "repository.syncSnapshotUpdated",
    ),
```

Also import `SynapseRepositorySyncSnapshotUpdatedEvent` from repository types at the top if not already imported.

- [ ] **Step 6: Update `SynapseBridge`**

In `desktop/src/types/bridge.ts`, import `SynapseRepositorySyncSnapshot` and `SynapseRepositorySyncSnapshotUpdatedEvent`, then add:

```ts
    getSyncSnapshots: () => Promise<SynapseRepositorySyncSnapshot[]>
    onSyncSnapshotUpdated: (
      listener: (payload: SynapseRepositorySyncSnapshotUpdatedEvent) => void
    ) => () => void
```

- [ ] **Step 7: Generate IPC and typecheck**

Run:

```bash
pnpm --filter @synapse/desktop run generate:ipc
pnpm --filter @synapse/desktop run typecheck
```

Expected: PASS.

- [ ] **Step 8: Commit Task 4**

```bash
git add desktop/electron/bootstrap/descriptors.ts desktop/electron/bootstrap/registry.ts desktop/electron/bootstrap/index.ts desktop/electron/modules/repository/ipc.ts desktop/electron/preload.ts desktop/src/types/bridge.ts desktop/electron/generated/ipc-channels.generated.ts
git commit -m "feat: expose repository sync snapshots"
```

---

### Task 5: Route Content, Maintenance, And Quit Flows Through Coordinator

**Files:**
- Modify: `desktop/electron/modules/content/ipc.ts`
- Modify: `desktop/electron/modules/repository/ipc.ts`
- Modify: `desktop/electron/bootstrap/before-quit.ts`
- Modify: `desktop/electron/services/content-submission-service.ts`
- Modify: `desktop/electron/bootstrap/__tests__/before-quit.test.ts`
- Create: `desktop/electron/modules/content/ipc.test.ts`

- [ ] **Step 1: Remove content IPC background push state**

Delete the `backgroundPushStates` map and `scheduleBackgroundPush` function from `desktop/electron/modules/content/ipc.ts`.

- [ ] **Step 2: Request coordinator push after saved content mutations**

In `create`, `update`, and `restore` handlers, replace:

```ts
if (result.status === "saved" && result.pendingPushCount > 0 && repository) {
  scheduleBackgroundPush(eventBus, repository)
}
```

with:

```ts
if (result.status === "saved" && result.pendingPushCount > 0 && repository) {
  const coordinator = ctx.resolve<RepositorySyncCoordinator>("repo.sync-coordinator")
  void coordinator.requestPush(repository, "content-saved")
}
```

Import `RepositorySyncCoordinator`.

- [ ] **Step 3: Keep delete and purge remote checks**

Do not change `deleteContent`, `restoreContent`, or `purge` safety semantics in `content-submission-service.ts` except for post-commit push ownership. Verify delete and purge still call their conflict-check paths before local mutation.

- [ ] **Step 4: Route repository maintenance through coordinator**

In repository IPC `runMaintenance`, replace direct `repositoryMaintenanceService.runManualMaintenance` with:

```ts
const coordinator = ctx.resolve<RepositorySyncCoordinator>("repo.sync-coordinator")
const maintenanceResult = await coordinator.requestMaintenance(repository)
```

Use `maintenanceResult` directly for response fields.

- [ ] **Step 5: Update before-quit flow**

In `before-quit.ts`, resolve coordinator from `deps.registry` and use it for flushing.

```ts
const coordinator = deps.registry.get<RepositorySyncCoordinator>("repo.sync-coordinator")
const pendingPushCount = await coordinator.countAllPending()
```

For "先同步":

```ts
if (result.response === 0) {
  for (const repository of config.repositories) {
    await coordinator.requestPush(repository, "quit")
  }
}
```

- [ ] **Step 6: Add focused tests**

Update `desktop/electron/bootstrap/__tests__/before-quit.test.ts` so the mocked registry returns a coordinator for `repo.sync-coordinator`. Add this test case inside the existing `describe`.

```ts
it("flushes pending pushes through the coordinator before quit when requested", async () => {
  const { configStore } = await import("../../services/config-store")
  const { attachBeforeQuitHandler } = await import("../before-quit")
  const coordinator = {
    countAllPending: vi.fn(async () => 1),
    requestPush: vi.fn(async () => undefined),
  }
  vi.mocked(configStore.load).mockResolvedValueOnce({
    repositories: [{
      uuid: "repo-1",
      name: "Repo",
      localPath: "/repo",
      contentDirs: {},
    }],
  } as never)
  electronMock.showMessageBox.mockResolvedValueOnce({ response: 0 } as never)
  let allowQuit = false
  const stopAll = vi.fn(async () => {})

  attachBeforeQuitHandler({
    state: { current: null },
    registry: {
      get: vi.fn((id: string) => {
        if (id === "repo.sync-coordinator") {
          return coordinator
        }
        throw new Error(`Unexpected service id: ${id}`)
      }),
      stopAll,
    } as never,
    setAllowQuit: (value) => {
      allowQuit = value
    },
    isAllowedToQuit: () => allowQuit,
  })
  const beforeQuitHandler = electronMock.app.on.mock.calls.find(
    ([eventName]) => eventName === "before-quit",
  )?.[1] as (event: { preventDefault: () => void }) => Promise<void>

  await beforeQuitHandler({ preventDefault: vi.fn() })
  await new Promise((resolve) => setTimeout(resolve, 0))

  expect(coordinator.requestPush).toHaveBeenCalledWith(
    expect.objectContaining({ uuid: "repo-1" }),
    "quit",
  )
  expect(allowQuit).toBe(true)
})
```

Create `desktop/electron/modules/content/ipc.test.ts` to prove create and update submit push intent through the coordinator.

```ts
import { beforeEach, describe, expect, it, vi } from "vitest"

const mocks = vi.hoisted(() => ({
  coordinator: {
    requestPush: vi.fn(async () => undefined),
  },
  eventBus: {
    emit: vi.fn(),
  },
  repository: {
    uuid: "repo-1",
    name: "Repo",
    localPath: "/repo",
    contentDirs: {},
  },
  contentSubmissionService: {
    createContent: vi.fn(),
    readPendingPushState: vi.fn(async () => ({ count: 1, items: [] })),
    updateContent: vi.fn(),
  },
}))

vi.mock("electron", () => ({
  app: {
    getPath: vi.fn(() => "/tmp"),
  },
  dialog: {
    showSaveDialog: vi.fn(),
  },
}))

vi.mock("../../../src/config/content-types", () => ({
  getContentTypeDefinition: vi.fn(() => ({ download: { extension: ".md", dialogFilterName: "Markdown" } })),
}))

vi.mock("../../../src/lib/config", () => ({
  getActiveRepositoryConfig: vi.fn(() => mocks.repository),
}))

vi.mock("../../services/config-store", () => ({
  configStore: {
    load: vi.fn(async () => ({ repositories: [mocks.repository], activeRepositoryUuid: "repo-1" })),
  },
}))

vi.mock("../../services/content-download-service", () => ({
  contentDownloadService: { download: vi.fn() },
}))

vi.mock("../../services/content-install-service", () => ({
  contentInstallService: {
    installToEditor: vi.fn(),
    readEditorInstallFormValues: vi.fn(),
  },
}))

vi.mock("../../services/content-service", () => ({
  contentService: {
    getContent: vi.fn(),
    getDetail: vi.fn(),
    getHistory: vi.fn(),
    getHistoryVersion: vi.fn(),
    listContent: vi.fn(),
    listDeletedContent: vi.fn(),
    readIconImage: vi.fn(),
  },
}))

vi.mock("../../services/content-submission-service", () => ({
  contentSubmissionService: mocks.contentSubmissionService,
}))

vi.mock("../../services/content-window-service", () => ({
  contentWindowService: { openDetailWindow: vi.fn() },
}))

vi.mock("../../services/editor-adapter-service", () => ({
  editorAdapterService: {
    listAdapters: vi.fn(),
    resolveTarget: vi.fn(),
  },
}))

vi.mock("../../services/log-store", () => ({
  createMainLogger: () => ({
    info: vi.fn(),
    warn: vi.fn(),
    error: vi.fn(),
  }),
}))

function createContext() {
  return {
    moduleId: "content",
    resolve: vi.fn((id: string) => {
      if (id === "core.event-bus") {
        return mocks.eventBus
      }
      if (id === "repo.sync-coordinator") {
        return mocks.coordinator
      }
      throw new Error(`Unexpected service id: ${id}`)
    }),
  }
}

describe("contentIpcModule sync ownership", () => {
  beforeEach(() => {
    vi.clearAllMocks()
    mocks.contentSubmissionService.createContent.mockResolvedValue({
      status: "saved",
      pendingPushCount: 1,
    })
    mocks.contentSubmissionService.updateContent.mockResolvedValue({
      status: "saved",
      pendingPushCount: 1,
    })
  })

  it.each([
    ["create", "createContent"],
    ["update", "updateContent"],
  ] as const)("requests one coordinator push after %s saves with pending pushes", async (methodName, serviceName) => {
    const { contentIpcModule } = await import("./ipc")
    const method = contentIpcModule.methods[methodName]

    await method.handler(createContext() as never, {
      contentType: "rule",
      payload: { title: "Rule" },
    } as never)

    expect(mocks.contentSubmissionService[serviceName]).toHaveBeenCalledTimes(1)
    expect(mocks.coordinator.requestPush).toHaveBeenCalledTimes(1)
    expect(mocks.coordinator.requestPush).toHaveBeenCalledWith(mocks.repository, "content-saved")
  })
})
```

- [ ] **Step 7: Run focused tests**

Run:

```bash
pnpm --filter @synapse/desktop exec vitest run electron/bootstrap/__tests__/before-quit.test.ts
pnpm --filter @synapse/desktop exec vitest run electron/modules/content
```

Expected: PASS.

- [ ] **Step 8: Commit Task 5**

```bash
git add desktop/electron/modules/content/ipc.ts desktop/electron/modules/content/ipc.test.ts desktop/electron/modules/repository/ipc.ts desktop/electron/bootstrap/before-quit.ts desktop/electron/services/content-submission-service.ts desktop/electron/bootstrap/__tests__/before-quit.test.ts
git commit -m "feat: route repository sync through coordinator"
```

---

### Task 6: Renderer Snapshot Store

**Files:**
- Modify: `desktop/src/app-shell/repository-manager.ts`
- Modify: `desktop/src/app-shell/use-repository-manager.ts`
- Modify: `desktop/src/app-shell/__tests__/repository-manager.test.ts`

- [ ] **Step 1: Add sync snapshot state to RepositoryManager**

In `repository-manager.ts`, import `SynapseRepositorySyncSnapshot` and `SynapseRepositorySyncSnapshotUpdatedEvent`. Add:

```ts
  private syncSnapshots: Map<string, SynapseRepositorySyncSnapshot> = new Map()
  private unsubscribeSyncSnapshot: (() => void) | null = null
```

Destroy:

```ts
    this.unsubscribeSyncSnapshot?.()
```

- [ ] **Step 2: Load snapshots during initialize**

After pending pushes refresh:

```ts
    await this.refreshSyncSnapshots()
```

Implement:

```ts
  getSyncSnapshot(uuid: string): SynapseRepositorySyncSnapshot | undefined {
    return this.syncSnapshots.get(uuid)
  }

  private async refreshSyncSnapshots(): Promise<void> {
    const bridge = getSynapseBridge()?.repository
    if (!bridge?.getSyncSnapshots) {
      return
    }

    const snapshots = await bridge.getSyncSnapshots()
    this.syncSnapshots.clear()
    for (const snapshot of snapshots) {
      this.syncSnapshots.set(snapshot.repositoryUuid, snapshot)
    }
    this.notifyRepositorySubscribers()
  }
```

- [ ] **Step 3: Subscribe to snapshot updates**

Add to `setupBridgeListeners`.

```ts
    this.unsubscribeSyncSnapshot = bridge.onSyncSnapshotUpdated?.(
      (event: SynapseRepositorySyncSnapshotUpdatedEvent) => {
        this.syncSnapshots.set(event.repositoryUuid, event.snapshot)
        this.pendingPushes.set(event.repositoryUuid, {
          count: event.snapshot.pendingCount,
          items: event.snapshot.pendingItems,
        })
        this.notifyRepositorySubscribers()
      },
    ) ?? null
```

- [ ] **Step 4: Add hook**

In `use-repository-manager.ts`, add:

```ts
function useRepositorySyncSnapshot(uuid: string) {
  return useRepositorySubscription((manager) => manager.getSyncSnapshot(uuid))
}
```

Export it.

- [ ] **Step 5: Update repository manager test bridge**

In `repository-manager.test.ts`, add to mocked bridge:

```ts
getSyncSnapshots: vi.fn(async () => []),
onSyncSnapshotUpdated: vi.fn(() => () => {}),
```

Add a test:

```ts
it("stores sync snapshot updates", async () => {
  let snapshotListener: ((event: any) => void) | null = null
  const bridge = createBridge()
  bridge.repository.onSyncSnapshotUpdated = vi.fn((listener) => {
    snapshotListener = listener
    return () => {}
  })
  installBridge(bridge)
  const manager = new RepositoryManager()
  await manager.initialize()

  snapshotListener?.({
    repositoryUuid: repository.uuid,
    snapshot: {
      repositoryUuid: repository.uuid,
      status: "pending",
      operation: null,
      phase: "completed",
      pendingCount: 1,
      pendingItems: [],
      message: "1 条变更等待同步",
      retryCount: 0,
      canRetryNow: true,
      primaryAction: "retry",
    },
  })

  expect(manager.getSyncSnapshot(repository.uuid)?.status).toBe("pending")
})
```

- [ ] **Step 6: Run renderer store tests**

Run:

```bash
pnpm --filter @synapse/desktop exec vitest run src/app-shell/__tests__/repository-manager.test.ts
```

Expected: PASS.

- [ ] **Step 7: Commit Task 6**

```bash
git add desktop/src/app-shell/repository-manager.ts desktop/src/app-shell/use-repository-manager.ts desktop/src/app-shell/__tests__/repository-manager.test.ts
git commit -m "feat: store repository sync snapshots in renderer"
```

---

### Task 7: Top-Right Git Status Center

**Files:**
- Create: `desktop/src/app-shell/components/git-sync-status-center.tsx`
- Modify: `desktop/src/app-shell/components/sync-status-chip.tsx`
- Modify: `desktop/src/app-shell/components/app-shell-actions.tsx`
- Modify: `desktop/src/app-shell/use-app-shell-toolbar-state.ts`
- Create: `desktop/src/app-shell/__tests__/git-sync-status-center.test.tsx`

- [ ] **Step 1: Extend chip statuses**

Update `SyncStatus`:

```ts
type SyncStatus = "synced" | "pending" | "syncing" | "offline" | "attention"
```

Add config:

```ts
attention: {
  icon: CircleAlert,
  label: () => "需要处理",
},
```

Import `CircleAlert` from `lucide-react`.

- [ ] **Step 2: Create status center component**

Create `git-sync-status-center.tsx`.

```tsx
import { AlertCircle, Clock, RefreshCw, Settings } from "lucide-react"
import { Button } from "@/components/ui/button"
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover"
import { Separator } from "@/components/ui/separator"
import { ScrollArea } from "@/components/ui/scroll-area"
import { SyncStatusChip, type SyncStatus } from "@/app-shell/components/sync-status-chip"
import type { SynapseRepositoryConfig } from "@/types/config"
import type { SynapseRepositorySyncSnapshot } from "@/types/repository"

type GitSyncStatusCenterProps = {
  repository: SynapseRepositoryConfig | null
  snapshot: SynapseRepositorySyncSnapshot | undefined
  status: SyncStatus
  pendingCount: number
  onRetry: () => void
  onOpenSettings: () => void
}

function GitSyncStatusCenter({
  repository,
  snapshot,
  status,
  pendingCount,
  onRetry,
  onOpenSettings,
}: GitSyncStatusCenterProps) {
  const message = snapshot?.message ?? "已同步"
  const canRetry = snapshot?.canRetryNow === true || status === "pending" || status === "offline"

  return (
    <Popover>
      <PopoverTrigger asChild>
        <span>
          <SyncStatusChip status={status} pendingCount={pendingCount} />
        </span>
      </PopoverTrigger>
      <PopoverContent align="end" className="w-80">
        <div className="flex flex-col gap-3">
          <div className="flex items-start justify-between gap-3">
            <div className="min-w-0">
              <p className="truncate text-sm font-medium">{repository?.name ?? "仓库"}</p>
              <p className="text-sm text-muted-foreground">{message}</p>
            </div>
            {status === "syncing" ? <RefreshCw className="size-4 animate-spin text-muted-foreground" /> : null}
            {status === "attention" ? <AlertCircle className="size-4 text-muted-foreground" /> : null}
          </div>

          {snapshot?.nextRetryAt ? (
            <p className="flex items-center gap-2 text-xs text-muted-foreground">
              <Clock className="size-3.5" />
              下次重试：{new Date(snapshot.nextRetryAt).toLocaleTimeString()}
            </p>
          ) : null}

          {snapshot?.pendingItems.length ? (
            <>
              <Separator />
              <ScrollArea className="max-h-44">
                <div className="flex flex-col gap-2 pr-2">
                  {snapshot.pendingItems.map((item) => (
                    <div key={item.id} className="flex flex-col gap-0.5 text-sm">
                      <span className="truncate">{item.title ?? item.targetId}</span>
                      <span className="text-xs text-muted-foreground">{item.action}</span>
                    </div>
                  ))}
                </div>
              </ScrollArea>
            </>
          ) : null}

          <div className="flex justify-end gap-2">
            <Button variant="outline" size="sm" onClick={onOpenSettings}>
              <Settings data-icon="inline-start" />
              仓库设置
            </Button>
            {canRetry ? (
              <Button size="sm" onClick={onRetry}>
                立即同步
              </Button>
            ) : null}
          </div>
        </div>
      </PopoverContent>
    </Popover>
  )
}

export { GitSyncStatusCenter }
```

- [ ] **Step 3: Derive toolbar state from sync snapshot**

In `use-app-shell-toolbar-state.ts`, import `useRepositorySyncSnapshot`. Replace local `syncStatus` derivation with:

```ts
  const activeSyncSnapshot = useRepositorySyncSnapshot(activeRepository?.uuid ?? "")
```

Inside `useMemo`:

```ts
    const syncStatus: SyncStatus =
      activeSyncSnapshot?.status === "attention"
        ? "attention"
        : activeSyncSnapshot?.status === "offline"
          ? "offline"
          : activeSyncSnapshot?.status === "syncing"
            ? "syncing"
            : (activeSyncSnapshot?.pendingCount ?? activePendingPushState?.count ?? 0) > 0
              ? "pending"
              : "synced"
```

Return `syncSnapshot: activeSyncSnapshot`.

- [ ] **Step 4: Render status center in actions**

In `AppShellActions`, replace direct `SyncStatusChip` rendering with `GitSyncStatusCenter`. Add props:

```ts
activeRepository?: SynapseRepositoryConfig | null
syncSnapshot?: SynapseRepositorySyncSnapshot
onOpenRepositorySettings?: () => void
```

Render:

```tsx
<GitSyncStatusCenter
  repository={activeRepository ?? null}
  snapshot={syncSnapshot}
  status={syncStatus}
  pendingCount={pendingPushCount}
  onRetry={onSyncChipClick ?? (() => {})}
  onOpenSettings={onOpenRepositorySettings ?? (() => {})}
/>
```

- [ ] **Step 5: Wire App settings action**

In `App.tsx`, pass:

```tsx
activeRepository={activeRepository}
syncSnapshot={toolbarState.syncSnapshot}
onOpenRepositorySettings={() => {
  setActiveTab("settings", "sync-status")
}}
```

Opening the popover must not call `syncRepository` or `pushRepository`.

- [ ] **Step 6: Add UI test**

Create `desktop/src/app-shell/__tests__/git-sync-status-center.test.tsx`.

```tsx
import { render, screen } from "@testing-library/react"
import userEvent from "@testing-library/user-event"
import { describe, expect, it, vi } from "vitest"
import { GitSyncStatusCenter } from "../components/git-sync-status-center"

describe("GitSyncStatusCenter", () => {
  it("opens details without starting sync", async () => {
    const onRetry = vi.fn()
    render(
      <GitSyncStatusCenter
        repository={{ uuid: "repo-1", name: "Team Repo", localPath: "/repo", contentDirs: {} }}
        status="pending"
        pendingCount={1}
        snapshot={{
          repositoryUuid: "repo-1",
          status: "pending",
          operation: null,
          phase: "completed",
          pendingCount: 1,
          pendingItems: [],
          message: "1 条变更等待同步",
          retryCount: 0,
          canRetryNow: true,
          primaryAction: "retry",
        }}
        onRetry={onRetry}
        onOpenSettings={vi.fn()}
      />,
    )

    await userEvent.click(screen.getByRole("button", { name: /1 条待同步/ }))

    expect(screen.getByText("Team Repo")).toBeTruthy()
    expect(onRetry).not.toHaveBeenCalled()
  })
})
```

- [ ] **Step 7: Run UI tests**

Run:

```bash
pnpm --filter @synapse/desktop exec vitest run src/app-shell/__tests__/git-sync-status-center.test.tsx
```

Expected: PASS.

- [ ] **Step 8: Commit Task 7**

```bash
git add desktop/src/app-shell/components/git-sync-status-center.tsx desktop/src/app-shell/components/sync-status-chip.tsx desktop/src/app-shell/components/app-shell-actions.tsx desktop/src/app-shell/use-app-shell-toolbar-state.ts desktop/src/App.tsx desktop/src/app-shell/__tests__/git-sync-status-center.test.tsx
git commit -m "feat: add git sync status center"
```

---

### Task 8: Remove Scattered Sync State From Content UI

**Files:**
- Modify: `desktop/src/App.tsx`
- Modify: `desktop/src/modules/content/create-content-module.tsx`
- Modify: `desktop/src/modules/content/components/content-detail-dialog.tsx`
- Modify: `desktop/src/modules/content/components/content-browser-page.tsx`
- Modify: `desktop/src/modules/editor-scan/components/scan-item-detail-dialog.tsx`

- [ ] **Step 1: Remove App local offline state**

In `App.tsx`, delete:

```ts
const [isOffline, setIsOffline] = useState(false)
```

Delete `NETWORK_ERROR_PATTERNS` and `isNetworkError`.

Pass toolbar state without `isOffline`:

```ts
const toolbarState = useAppShellToolbarState({
  hasBlockingModalOpen,
})
```

Remove the old pending push alert dialog if `GitSyncStatusCenter` now owns the details. If the dialog is temporarily retained, it must read snapshot messages and not classify errors.

- [ ] **Step 2: Stop blocking create on pending pushes**

In `create-content-module.tsx`, remove `usePendingPushes` and `isSyncing`. Change `submitDisabledReason` to:

```ts
const submitDisabledReason =
  currentRepoProfileState?.status === "needs-onboarding"
    ? "请先完成当前目录的身份设置"
    : null
```

Change success copy:

```ts
return result.pendingPushCount > 0 ? "已保存，等待同步。" : "保存成功。"
```

- [ ] **Step 3: Stop waiting for push after edit save**

In `content-detail-dialog.tsx`, remove `usePendingPushes`, `pendingPushState`, and `isSyncing`. Delete:

```ts
if (result.pendingPushCount > 0 && activeRepository) {
  await manager.waitForBackgroundPush(activeRepository.uuid)
}
```

Change success copy:

```ts
return result.pendingPushCount > 0 ? "已保存，等待同步。" : "保存成功。"
```

Keep initialization blocking:

```ts
const submitDisabledReason =
  currentRepoProfileState?.status === "needs-onboarding"
    ? "请先完成当前目录的身份设置"
    : isRepositoryInitializing
      ? "当前目录正在初始化，请稍后。"
      : null
```

- [ ] **Step 4: Replace list-level pending disable checks**

Search:

```bash
rg -n "正在同步变更|usePendingPushes|pendingPushState|isSyncing" desktop/src/modules
```

For content browsing and editor scan actions, remove pending-push-based disabling. Keep disabling only for active destructive operations or repository initialization. Use `useRepositorySyncSnapshot` only when the UI needs to show a centralized message, not to block normal local-first saves.

- [ ] **Step 5: Run focused renderer tests**

Run:

```bash
pnpm --filter @synapse/desktop exec vitest run src/modules/content
pnpm --filter @synapse/desktop exec vitest run src/app-shell
```

Expected: PASS.

- [ ] **Step 6: Commit Task 8**

```bash
git add desktop/src/App.tsx desktop/src/modules/content/create-content-module.tsx desktop/src/modules/content/components/content-detail-dialog.tsx desktop/src/modules/content/components/content-browser-page.tsx desktop/src/modules/editor-scan/components/scan-item-detail-dialog.tsx
git commit -m "fix: centralize renderer sync state"
```

---

### Task 9: Final Verification And Hard Constraint Cleanup

**Files:**
- Check all changed files.

- [ ] **Step 1: Search for duplicate sync ownership**

Run:

```bash
rg -n "backgroundPushStates|isOffline|NETWORK_ERROR_PATTERNS|formatGitFailureMessage\\(|正在同步变更，请稍后|已保存并同步" desktop/src desktop/electron
```

Expected:

- No `backgroundPushStates`.
- No renderer-local `isOffline` for repository sync.
- `formatGitFailureMessage` only used by Git command fallback paths, not UI-specific code.
- No content form blocking solely because pending pushes exist.
- No success copy claiming pending changes are already synchronized.

- [ ] **Step 2: Run hard constraints**

Run:

```bash
pnpm --filter @synapse/desktop run check:hard-constraints
```

Expected: PASS.

- [ ] **Step 3: Run full desktop tests**

Run:

```bash
pnpm --filter @synapse/desktop run test
```

Expected: PASS.

- [ ] **Step 4: Run typecheck**

Run:

```bash
pnpm --filter @synapse/desktop run typecheck
```

Expected: PASS.

- [ ] **Step 5: Review final diff**

Run:

```bash
git status --short
git diff --stat
git diff --check
```

Expected:

- Only sync manager, repository IPC, bridge, app-shell, content sync-state, and tests changed.
- `git diff --check` prints no whitespace errors.

- [ ] **Step 6: Commit final verification fixes**

If Task 9 changed files:

```bash
git add <changed-files>
git commit -m "test: verify repository sync manager"
```

If Task 9 changed no files, skip this commit.
