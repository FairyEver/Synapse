import type { EventBus } from "../runtime/event-bus"
import type { SynapseRepositoryConfig } from "../../src/types/config"
import type {
  SynapsePendingPushState,
  SynapseRepositoryOperationKind,
  SynapseRepositoryOperationResult,
  SynapseRepositoryProgressEvent,
  SynapseRepositorySyncSnapshot,
  SynapseRepositorySyncSnapshotUpdatedEvent,
} from "../../src/types/repository"
import { configStore } from "./config-store"
import { contentSubmissionService } from "./content-submission-service"
import { sanitizeError } from "./error-sanitize"
import { classifyGitFailure } from "./git-error-utils"
import { createMainLogger } from "./log-store"
import { pendingPushesService } from "./pending-pushes-service"
import { repositoryGitService } from "./repository-git-service"
import { repositoryLockManager } from "./repository-lock-manager"
import { repositoryMaintenanceService } from "./repository-maintenance-service"
import { repositoryStore } from "./repository-store"

const logger = createMainLogger("service.repository-sync")
const MAX_RETRY_DELAY_MS = 5 * 60 * 1000

type SyncRequestReason = "content-saved" | "manual" | "recovery" | "maintenance" | "initialize" | "quit"

type RepositoryExecutionState = {
  currentPromise: Promise<void> | null
  maintenancePromise: Promise<SynapseRepositoryOperationResult> | null
  pushFinalizing: boolean
  rerunRequested: boolean
  syncPromise: Promise<SynapseRepositoryOperationResult> | null
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

function toSafeErrorMessage(error: unknown): string {
  const message = error instanceof Error ? error.message : String(error)

  return sanitizeError(message) || "同步快照刷新失败。"
}

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

  async getSnapshotsForRepositories(
    repositories: SynapseRepositoryConfig[],
  ): Promise<SynapseRepositorySyncSnapshot[]> {
    const snapshots: SynapseRepositorySyncSnapshot[] = []

    for (const repository of repositories) {
      if (this.hasActiveOperation(repository.uuid)) {
        snapshots.push(this.getSnapshot(repository.uuid))
      } else {
        snapshots.push(await this.refreshSnapshotForHydration(repository))
      }
    }

    return snapshots
  }

  async refreshSnapshot(repository: SynapseRepositoryConfig): Promise<SynapseRepositorySyncSnapshot> {
    const pending = await pendingPushesService.readState(repository)
    const snapshot = this.createSnapshotFromPending(repository.uuid, pending)

    this.emitSnapshot(snapshot)
    this.syncRetryTimerFromSnapshot(repository, snapshot)
    return snapshot
  }

  requestPush(repository: SynapseRepositoryConfig, reason: SyncRequestReason): Promise<void> {
    const state = this.getExecutionState(repository.uuid)

    if (state.syncPromise) {
      return this.requestPushAfterOperationSettles(repository, reason, state.syncPromise)
    }

    if (state.maintenancePromise) {
      return this.requestPushAfterOperationSettles(repository, reason, state.maintenancePromise)
    }

    if (state.currentPromise) {
      if (state.pushFinalizing) {
        return state.currentPromise
          .catch(() => undefined)
          .then(() => this.requestPush(repository, reason))
      }

      state.rerunRequested = true
      return state.currentPromise
    }

    this.clearRetryTimer(state)
    state.pushFinalizing = false
    state.currentPromise = this.runPushLoop(repository, reason, state)

    return state.currentPromise
  }

  private async requestPushAfterOperationSettles(
    repository: SynapseRepositoryConfig,
    reason: SyncRequestReason,
    operationPromise: Promise<unknown>,
  ): Promise<void> {
    let operationError: unknown = null

    try {
      await operationPromise
    } catch (error) {
      operationError = error
    }

    if (operationError) {
      const pending = await pendingPushesService.readState(repository)

      if (pending.count === 0) {
        throw operationError
      }
    }

    return this.requestPush(repository, reason)
  }

  private async runPushLoop(
    repository: SynapseRepositoryConfig,
    reason: SyncRequestReason,
    state: RepositoryExecutionState,
  ): Promise<void> {
    try {
      let shouldContinue = false

      do {
        state.rerunRequested = false
        shouldContinue = await this.runPushOnce(repository, reason)
      } while (state.rerunRequested || shouldContinue)
    } finally {
      state.pushFinalizing = true
      try {
        const tSnapshot = Date.now()
        logger.info("runPushLoop: calling refreshSnapshot.", { repositoryUuid: repository.uuid })
        await this.refreshSnapshot(repository)
        logger.info("runPushLoop: refreshSnapshot done.", { durationMs: Date.now() - tSnapshot, repositoryUuid: repository.uuid })
      } finally {
        state.pushFinalizing = false
        state.currentPromise = null
      }
    }
  }

  async requestSync(
    repository: SynapseRepositoryConfig,
    reason: SyncRequestReason,
  ): Promise<SynapseRepositoryOperationResult> {
    const state = this.getExecutionState(repository.uuid)

    if (state.maintenancePromise) {
      await state.maintenancePromise
      return this.requestSync(repository, reason)
    }

    if (state.currentPromise) {
      await state.currentPromise
      return this.requestSync(repository, reason)
    }

    if (state.syncPromise) {
      return state.syncPromise
    }

    state.syncPromise = this.runSync(repository, reason, state)

    return state.syncPromise
  }

  private async runSync(
    repository: SynapseRepositoryConfig,
    reason: SyncRequestReason,
    state: RepositoryExecutionState,
  ): Promise<SynapseRepositoryOperationResult> {
    this.emitSnapshot({
      ...createEmptySnapshot(repository.uuid),
      status: "syncing",
      operation: "sync",
      phase: "running",
      message: "正在同步仓库",
      canRetryNow: false,
    })

    try {
      const release = await repositoryLockManager.acquire(repository.uuid, "sync")
      try {
        const pending = await pendingPushesService.readState(repository)

        if (pending.count > 0) {
          let shouldContinue = false

          do {
            shouldContinue = await this.runPushOnce(repository, reason, {
              alreadyExclusive: true,
            })
          } while (shouldContinue)

          const result = {
            operation: "push" as const,
            repository: await repositoryStore.getRepositoryState(repository),
            completedAt: this.now().toISOString(),
            pendingPushCount: (await pendingPushesService.readState(repository)).count,
          }
          release()
          await this.refreshSnapshot(repository)
          return result
        }

        const result = await repositoryGitService.syncRepository(repository, (event) => {
          this.emitLegacyProgress(event)
          const current = this.getSnapshot(repository.uuid)

          this.emitSnapshot({
            ...current,
            status: "syncing",
            operation: "sync",
            phase: "running",
            message: event.statusText,
          })
        }, { skipLock: true })
        release()
        await this.refreshSnapshot(repository)
        return result
      } catch (error) {
        release()
        throw error
      }
    } catch (error) {
      await this.handleOperationFailure(repository, "sync", error)
      throw error
    } finally {
      state.syncPromise = null
    }
  }

  async requestMaintenance(repository: SynapseRepositoryConfig): Promise<SynapseRepositoryOperationResult> {
    const state = this.getExecutionState(repository.uuid)

    if (state.currentPromise) {
      await state.currentPromise
      return this.requestMaintenance(repository)
    }

    if (state.syncPromise) {
      await state.syncPromise
      return this.requestMaintenance(repository)
    }

    if (state.maintenancePromise) {
      return state.maintenancePromise
    }

    state.maintenancePromise = this.runMaintenance(repository, state)

    return state.maintenancePromise
  }

  private async runMaintenance(
    repository: SynapseRepositoryConfig,
    state: RepositoryExecutionState,
  ): Promise<SynapseRepositoryOperationResult> {
    try {
      this.emitLegacyProgress({
        repositoryUuid: repository.uuid,
        operation: "maintenance",
        statusText: "正在准备整理...",
        percent: 0,
      })
      const release = await repositoryLockManager.acquire(repository.uuid, "maintenance")
      let result: Awaited<ReturnType<typeof repositoryMaintenanceService.runManualMaintenance>>
      try {
        result = await repositoryMaintenanceService.runManualMaintenance(repository, (statusText) => {
          this.emitLegacyProgress({
            repositoryUuid: repository.uuid,
            operation: "maintenance",
            statusText,
            percent: null,
          })
          const current = this.getSnapshot(repository.uuid)

          this.emitSnapshot({
            ...current,
            status: "syncing",
            operation: "maintenance",
            phase: "running",
            message: statusText,
          })
        })
      } finally {
        release()
      }

      await this.refreshSnapshot(repository)

      return {
        operation: "maintenance",
        repository: await repositoryStore.getRepositoryState(repository),
        completedAt: this.now().toISOString(),
        message: result.message,
        pendingPushCount: result.pendingPushCount,
      }
    } catch (error) {
      await this.handleOperationFailure(repository, "maintenance", error)
      throw error
    } finally {
      state.maintenancePromise = null
    }
  }

  async countAllPending(): Promise<number> {
    const config = await configStore.load()

    return pendingPushesService.countAll(config.repositories)
  }

  private getExecutionState(repositoryUuid: string): RepositoryExecutionState {
    let state = this.executions.get(repositoryUuid)

    if (!state) {
      state = {
        currentPromise: null,
        maintenancePromise: null,
        pushFinalizing: false,
        rerunRequested: false,
        syncPromise: null,
        retryTimer: null,
      }
      this.executions.set(repositoryUuid, state)
    }

    return state
  }

  private hasActiveOperation(repositoryUuid: string): boolean {
    const state = this.executions.get(repositoryUuid)

    return Boolean(state?.currentPromise || state?.syncPromise || state?.maintenancePromise)
  }

  private async refreshSnapshotForHydration(
    repository: SynapseRepositoryConfig,
  ): Promise<SynapseRepositorySyncSnapshot> {
    try {
      return await this.refreshSnapshot(repository)
    } catch (error) {
      const snapshot = this.createRefreshFailureSnapshot(repository.uuid, error)
      this.emitSnapshot(snapshot)
      logger.warn("repository.sync-snapshot-refresh-failed", {
        category: snapshot.failureCategory,
        error: toSafeErrorMessage(error),
        repositoryUuid: repository.uuid,
      })
      return snapshot
    }
  }

  private createSnapshotFromPending(
    repositoryUuid: string,
    pending: SynapsePendingPushState,
  ): SynapseRepositorySyncSnapshot {
    if (pending.count === 0) {
      return createEmptySnapshot(repositoryUuid)
    }

    const firstError = pending.firstErrorItem
      ?? pending.items.find((item) => item.lastErrorCategory || item.lastError)
    const retryCount = pending.retryCount
      ?? pending.items.reduce((total, item) => total + item.retryCount, 0)
    const nextRetryAt = pending.nextRetryAt
      ?? pending.items
        .map((item) => item.nextRetryAt)
        .filter((value): value is string => Boolean(value))
        .sort()[0] ?? null
    const failureCategory = firstError?.lastErrorCategory ?? null
    const failureSnapshotState = failureCategory
      ? this.getPersistedFailureSnapshotState(failureCategory)
      : null

    return {
      repositoryUuid,
      status: failureSnapshotState?.status ?? "pending",
      operation: null,
      phase: failureSnapshotState?.phase ?? (nextRetryAt ? "retry-wait" : "completed"),
      pendingCount: pending.count,
      pendingItems: pending.items,
      message: firstError?.lastError ?? `${pending.count} 条变更等待同步`,
      detail: failureCategory ? undefined : firstError?.title ?? undefined,
      failureCategory,
      lastAttemptAt: pending.lastAttemptAt ?? pending.items.find((item) => item.lastAttemptAt)?.lastAttemptAt ?? null,
      nextRetryAt,
      retryCount,
      canRetryNow: true,
      primaryAction: failureSnapshotState?.primaryAction ?? "retry",
    }
  }

  private createRefreshFailureSnapshot(
    repositoryUuid: string,
    error: unknown,
  ): SynapseRepositorySyncSnapshot {
    const failure = classifyGitFailure(toSafeErrorMessage(error), "同步快照刷新失败。")

    return {
      ...createEmptySnapshot(repositoryUuid),
      status: failure.recoverable ? "offline" : "attention",
      phase: failure.recoverable ? "retry-wait" : "blocked",
      message: failure.message,
      detail: failure.detail,
      failureCategory: failure.category,
      canRetryNow: true,
      primaryAction: failure.primaryAction,
    }
  }

  private getPersistedFailureSnapshotState(
    category: NonNullable<SynapseRepositorySyncSnapshot["failureCategory"]>,
  ): Pick<SynapseRepositorySyncSnapshot, "phase" | "primaryAction" | "status"> {
    if (category === "network" || category === "timeout") {
      return {
        status: "offline",
        phase: "retry-wait",
        primaryAction: "retry",
      }
    }

    if (category === "missing-path" || category === "not-git") {
      return {
        status: "attention",
        phase: "blocked",
        primaryAction: "open-settings",
      }
    }

    if (
      category === "auth"
      || category === "diverged"
      || category === "git-missing"
      || category === "ignored-paths"
      || category === "no-changes"
      || category === "upstream-missing"
    ) {
      return {
        status: "attention",
        phase: "blocked",
        primaryAction: "resolve-git",
      }
    }

    return {
      status: "attention",
      phase: "blocked",
      primaryAction: null,
    }
  }

  private async runPushOnce(
    repository: SynapseRepositoryConfig,
    _reason: SyncRequestReason,
    options: {
      alreadyExclusive?: boolean
    } = {},
  ): Promise<boolean> {
    const pending = await pendingPushesService.readState(repository, { limit: null })

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
      this.emitLegacyProgress({
        repositoryUuid: repository.uuid,
        operation: "push",
        statusText: "正在准备推送...",
        percent: 0,
      })
      const flushOptions = options.alreadyExclusive
        ? { skipLock: true, recordFailure: false }
        : { recordFailure: false }

      const tFlush = Date.now()
      logger.info("runPushOnce: flushPendingPushes starting.", { repositoryUuid: repository.uuid, pendingCount: pending.count })
      await contentSubmissionService.flushPendingPushes(
        repository,
        (statusText: string) => {
          this.emitLegacyProgress({
            repositoryUuid: repository.uuid,
            operation: "push",
            statusText,
            percent: null,
          })
          const current = this.getSnapshot(repository.uuid)

          this.emitSnapshot({
            ...current,
            status: "syncing",
            operation: "push",
            phase: "running",
            message: statusText,
          })
        },
        flushOptions,
      )
      logger.info("runPushOnce: flushPendingPushes done.", { durationMs: Date.now() - tFlush, repositoryUuid: repository.uuid })

      const remaining = await pendingPushesService.readState(repository)

      return remaining.count > 0
    } catch (error) {
      await this.handlePushFailure(repository, attemptedIds, nextRetryCount, error)
      throw error
    }
  }

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
    const nextRetryAt = failure.recoverable ? this.calculateNextRetryAt(nextRetryCount) : null
    const retryState = await pendingPushesService.markFailure(repository, failure.message, attemptedIds, {
      category: failure.category,
      nextRetryAt,
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
      this.scheduleRetry(repository, nextRetryAt)
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

  private scheduleRetry(repository: SynapseRepositoryConfig, nextRetryAt: string | null): void {
    const state = this.getExecutionState(repository.uuid)

    this.clearRetryTimer(state)

    const retryAtTime = nextRetryAt ? new Date(nextRetryAt).getTime() : Number.NaN
    const delayMs = Number.isNaN(retryAtTime)
      ? 30_000
      : Math.max(0, retryAtTime - this.now().getTime())

    state.retryTimer = setTimeout(() => {
      state.retryTimer = null
      void this.requestPush(repository, "recovery").catch((error) => {
        logger.warn("Scheduled repository push retry failed.", {
          error,
          repositoryUuid: repository.uuid,
        })
      })
    }, delayMs)
    state.retryTimer.unref?.()
  }

  private syncRetryTimerFromSnapshot(
    repository: SynapseRepositoryConfig,
    snapshot: SynapseRepositorySyncSnapshot,
  ): void {
    const state = this.getExecutionState(repository.uuid)

    if (
      snapshot.pendingCount > 0
      && snapshot.phase === "retry-wait"
      && snapshot.primaryAction === "retry"
      && (snapshot.status === "offline" || snapshot.status === "pending")
      && snapshot.nextRetryAt
    ) {
      this.scheduleRetry(repository, snapshot.nextRetryAt)
      return
    }

    this.clearRetryTimer(state)
  }

  private clearRetryTimer(state: RepositoryExecutionState): void {
    if (!state.retryTimer) {
      return
    }

    clearTimeout(state.retryTimer)
    state.retryTimer = null
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

  private emitLegacyProgress(payload: SynapseRepositoryProgressEvent): void {
    this.eventBus.emit({
      domain: "repository",
      type: "repository.progress",
      payload,
      timestamp: this.now().toISOString(),
    })
  }
}

export { RepositorySyncCoordinator }
