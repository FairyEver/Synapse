import type { Mock } from "vitest"
import { beforeEach, describe, expect, it, vi } from "vitest"
import type { EventBus } from "../../runtime/event-bus"
import type { SynapseRepositoryConfig } from "../../../src/types/config"
import type {
  SynapsePendingPushEntry,
  SynapsePendingPushState,
  SynapseRepositoryOperationResult,
} from "../../../src/types/repository"
import { RepositorySyncCoordinator } from "../repository-sync-coordinator"

const serviceMocks = vi.hoisted(() => ({
  configStore: {
    load: vi.fn(),
  },
  contentIndexService: {
    syncIndex: vi.fn(),
  },
  contentSubmissionService: {
    flushPendingPushes: vi.fn(),
    flushPendingPushesInExclusive: vi.fn(),
    readUnpushedCommitCount: vi.fn(),
    runRepositoryGitExclusive: vi.fn(),
  },
  pendingPushesService: {
    countAll: vi.fn(),
    markAttempt: vi.fn(),
    markFailure: vi.fn(),
    readState: vi.fn(),
  },
  repositoryGitService: {
    syncRepository: vi.fn(),
    syncRepositoryInExclusive: vi.fn(),
  },
  repositoryMaintenanceService: {
    runManualMaintenance: vi.fn(),
    runManualMaintenanceInExclusive: vi.fn(),
  },
  repositoryStore: {
    getRepositoryState: vi.fn(),
  },
}))

vi.mock("../config-store", () => ({
  configStore: serviceMocks.configStore,
}))

vi.mock("../content-index-service", () => ({
  contentIndexService: serviceMocks.contentIndexService,
}))

vi.mock("../content-submission-service", () => ({
  contentSubmissionService: serviceMocks.contentSubmissionService,
}))

vi.mock("../log-store", () => ({
  createMainLogger: () => ({
    debug: vi.fn(),
    error: vi.fn(),
    info: vi.fn(),
    warn: vi.fn(),
  }),
}))

vi.mock("../pending-pushes-service", () => ({
  pendingPushesService: serviceMocks.pendingPushesService,
}))

vi.mock("../repository-git-service", () => ({
  repositoryGitService: serviceMocks.repositoryGitService,
}))

vi.mock("../repository-maintenance-service", () => ({
  repositoryMaintenanceService: serviceMocks.repositoryMaintenanceService,
}))

vi.mock("../repository-lock-manager", () => ({
  repositoryLockManager: {
    acquire: vi.fn(async () => vi.fn()),
  },
}))

vi.mock("../repository-store", () => ({
  repositoryStore: serviceMocks.repositoryStore,
}))

const repository: SynapseRepositoryConfig = {
  uuid: "repo-1",
  name: "Docs",
  localPath: "/tmp/synapse-docs",
  contentDirs: {},
}

const secondRepository: SynapseRepositoryConfig = {
  uuid: "repo-2",
  name: "Playbooks",
  localPath: "/tmp/synapse-playbooks",
  contentDirs: {},
}

const emptyPendingState: SynapsePendingPushState = {
  count: 0,
  items: [],
}

const repositoryState = {
  repositoryUuid: "repo-1",
  localPath: "/tmp/synapse-docs",
  status: "ready" as const,
  isGitRepository: true,
  gitRootPath: "/tmp/synapse-docs",
}

function createPendingEntry(overrides: Partial<SynapsePendingPushEntry> = {}): SynapsePendingPushEntry {
  return {
    id: 1,
    action: "save",
    commitHash: null,
    createdAt: "2026-05-01T00:00:00.000Z",
    lastError: null,
    lastErrorCategory: null,
    retryCount: 0,
    targetId: "rule-1",
    title: "Rule 1",
    ...overrides,
  }
}

function createPendingState(items: SynapsePendingPushEntry[]): SynapsePendingPushState {
  return {
    count: items.length,
    items,
  }
}

function createEventBus(): EventBus {
  return {
    emit: vi.fn(),
    emitInternal: vi.fn(),
    on: vi.fn(() => vi.fn()),
    onType: vi.fn(() => vi.fn()),
  }
}

function lastSnapshotFrom(eventBus: EventBus) {
  const emit = eventBus.emit as Mock
  const lastCall = emit.mock.calls.at(-1)

  return lastCall?.[0].payload.snapshot
}

function emittedEventsOfType(eventBus: EventBus, type: string) {
  const emit = eventBus.emit as Mock

  return emit.mock.calls
    .map((call) => call[0])
    .filter((event) => event.type === type)
}

function createDeferred<T>() {
  let resolve!: (value: T | PromiseLike<T>) => void
  let reject!: (reason?: unknown) => void
  const promise = new Promise<T>((promiseResolve, promiseReject) => {
    resolve = promiseResolve
    reject = promiseReject
  })

  return { promise, reject, resolve }
}

function createMaintenanceResult(overrides: Partial<{
  message: string
  pendingPushCount: number
}> = {}) {
  return {
    compactedCount: 0,
    deletedAttachmentCount: 0,
    message: "没有需要整理的内容。",
    pendingPushCount: 0,
    pushed: false,
    ...overrides,
  }
}

describe("RepositorySyncCoordinator", () => {
  beforeEach(() => {
    vi.useFakeTimers()
    vi.setSystemTime(new Date("2026-05-02T10:00:00.000Z"))
    vi.resetAllMocks()
    serviceMocks.contentSubmissionService.runRepositoryGitExclusive.mockImplementation(
      async (_repository: SynapseRepositoryConfig, _operation: string, callback: (state: typeof repositoryState) => Promise<unknown>) => callback(repositoryState),
    )
    serviceMocks.contentSubmissionService.readUnpushedCommitCount.mockResolvedValue(0)
    serviceMocks.contentSubmissionService.flushPendingPushesInExclusive.mockImplementation(
      async (targetRepository: SynapseRepositoryConfig, _state: typeof repositoryState, onProgress: unknown, options: unknown) => (
        serviceMocks.contentSubmissionService.flushPendingPushes(targetRepository, onProgress, options)
      ),
    )
    serviceMocks.repositoryGitService.syncRepositoryInExclusive.mockImplementation(
      async (targetRepository: SynapseRepositoryConfig, _state: typeof repositoryState, onProgress: unknown) => (
        serviceMocks.repositoryGitService.syncRepository(targetRepository, onProgress)
      ),
    )
    serviceMocks.repositoryMaintenanceService.runManualMaintenanceInExclusive.mockImplementation(
      async (targetRepository: SynapseRepositoryConfig, _state: typeof repositoryState, onProgress: unknown) => (
        serviceMocks.repositoryMaintenanceService.runManualMaintenance(targetRepository, onProgress)
      ),
    )
  })

  it("emits a synced snapshot when the pending queue is empty", async () => {
    serviceMocks.pendingPushesService.readState.mockResolvedValue(emptyPendingState)
    const eventBus = createEventBus()
    const coordinator = new RepositorySyncCoordinator({ eventBus })

    const snapshot = await coordinator.refreshSnapshot(repository)

    expect(snapshot).toMatchObject({
      repositoryUuid: "repo-1",
      status: "synced",
      operation: null,
      phase: "completed",
      pendingCount: 0,
      message: "已同步",
    })
    expect(eventBus.emit).toHaveBeenCalledWith(expect.objectContaining({
      domain: "repository",
      type: "repository.syncSnapshotUpdated",
      payload: {
        repositoryUuid: "repo-1",
        snapshot,
      },
      timestamp: "2026-05-02T10:00:00.000Z",
    }))
  })

  it("reports local ahead commits as pending when the pending database has no rows", async () => {
    serviceMocks.pendingPushesService.readState.mockResolvedValue(emptyPendingState)
    serviceMocks.contentSubmissionService.readUnpushedCommitCount.mockResolvedValue(2)
    const eventBus = createEventBus()
    const coordinator = new RepositorySyncCoordinator({ eventBus })

    await expect(coordinator.refreshSnapshot(repository)).resolves.toMatchObject({
      status: "pending",
      pendingCount: 2,
      pendingItems: [],
      message: "2 个本地提交等待同步",
      primaryAction: "retry",
    })
  })

  it("marks network push failures as offline retry-wait snapshots", async () => {
    const pendingItem = createPendingEntry()
    const failedItem = createPendingEntry({
      lastError: "网络不可用，稍后自动重试。",
      lastErrorCategory: "network",
      nextRetryAt: "2026-05-02T10:00:30.000Z",
      retryCount: 1,
    })
    const pendingState = createPendingState([pendingItem])
    const failedState = createPendingState([failedItem])
    serviceMocks.pendingPushesService.readState
      .mockResolvedValueOnce(pendingState)
      .mockResolvedValueOnce(failedState)
    serviceMocks.pendingPushesService.markAttempt.mockResolvedValue(pendingState)
    serviceMocks.pendingPushesService.markFailure.mockResolvedValue(failedState)
    serviceMocks.contentSubmissionService.flushPendingPushes.mockRejectedValue(
      new Error("fatal: unable to access: Could not resolve host: github.com"),
    )
    const eventBus = createEventBus()
    const coordinator = new RepositorySyncCoordinator({ eventBus })

    await expect(coordinator.requestPush(repository, "manual")).rejects.toThrow("Could not resolve host")

    expect(serviceMocks.contentSubmissionService.flushPendingPushes).toHaveBeenCalledWith(
      repository,
      expect.any(Function),
      { recordFailure: false },
    )
    expect(serviceMocks.pendingPushesService.markFailure).toHaveBeenCalledTimes(1)
    expect(serviceMocks.pendingPushesService.markFailure).toHaveBeenCalledWith(
      repository,
      "网络不可用，稍后自动重试。",
      [1],
      {
        category: "network",
        nextRetryAt: "2026-05-02T10:00:30.000Z",
      },
    )
    expect(lastSnapshotFrom(eventBus)).toMatchObject({
      repositoryUuid: "repo-1",
      status: "offline",
      phase: "retry-wait",
      failureCategory: "network",
      nextRetryAt: "2026-05-02T10:00:30.000Z",
      pendingCount: 1,
      primaryAction: "retry",
    })
  })

  it("preserves nonrecoverable push failure state after the final refresh", async () => {
    const pendingItem = createPendingEntry()
    const failedItem = createPendingEntry({
      lastError: "Git 认证失败，请检查系统凭证或 SSH Key。",
      lastErrorCategory: "auth",
      retryCount: 1,
    })
    const pendingState = createPendingState([pendingItem])
    const failedState = createPendingState([failedItem])
    serviceMocks.pendingPushesService.readState
      .mockResolvedValueOnce(pendingState)
      .mockResolvedValue(failedState)
    serviceMocks.pendingPushesService.markAttempt.mockResolvedValue(pendingState)
    serviceMocks.pendingPushesService.markFailure.mockResolvedValue(failedState)
    serviceMocks.contentSubmissionService.flushPendingPushes.mockRejectedValue(
      new Error("Permission denied (publickey)."),
    )
    const eventBus = createEventBus()
    const coordinator = new RepositorySyncCoordinator({ eventBus })

    await expect(coordinator.requestPush(repository, "manual")).rejects.toThrow("Permission denied")

    expect(lastSnapshotFrom(eventBus)).toMatchObject({
      repositoryUuid: "repo-1",
      status: "attention",
      phase: "blocked",
      failureCategory: "auth",
      primaryAction: "resolve-git",
    })
  })

  it("maps persisted failed pending state to the correct blocked action", async () => {
    serviceMocks.pendingPushesService.readState.mockResolvedValue(createPendingState([
      createPendingEntry({
        lastError: "当前目录不是 Git 仓库。",
        lastErrorCategory: "not-git",
        retryCount: 1,
      }),
    ]))
    const eventBus = createEventBus()
    const coordinator = new RepositorySyncCoordinator({ eventBus })

    const snapshot = await coordinator.refreshSnapshot(repository)

    expect(snapshot).toMatchObject({
      repositoryUuid: "repo-1",
      status: "attention",
      phase: "blocked",
      failureCategory: "not-git",
      primaryAction: "open-settings",
    })
  })

  it("hydrates snapshots for configured repositories from persisted pending state", async () => {
    serviceMocks.pendingPushesService.readState
      .mockResolvedValueOnce(emptyPendingState)
      .mockResolvedValueOnce(createPendingState([
        createPendingEntry({
          id: 2,
          lastError: "网络不可用，稍后自动重试。",
          lastErrorCategory: "network",
          nextRetryAt: "2026-05-02T10:00:30.000Z",
          retryCount: 1,
          targetId: "playbook-1",
        }),
      ]))
    const eventBus = createEventBus()
    const coordinator = new RepositorySyncCoordinator({ eventBus })

    const snapshots = await coordinator.getSnapshotsForRepositories([repository, secondRepository])

    expect(snapshots).toHaveLength(2)
    expect(snapshots).toEqual([
      expect.objectContaining({
        repositoryUuid: "repo-1",
        status: "synced",
        pendingCount: 0,
      }),
      expect.objectContaining({
        repositoryUuid: "repo-2",
        status: "offline",
        pendingCount: 1,
        failureCategory: "network",
      }),
    ])
    expect(coordinator.getSnapshots()).toEqual(snapshots)
  })

  it("isolates snapshot hydration failures per configured repository", async () => {
    serviceMocks.pendingPushesService.readState
      .mockRejectedValueOnce(new Error("cache read failed at /Users/me/repo token=secret-value"))
      .mockResolvedValueOnce(emptyPendingState)
    const eventBus = createEventBus()
    const coordinator = new RepositorySyncCoordinator({ eventBus })

    const snapshots = await coordinator.getSnapshotsForRepositories([repository, secondRepository])

    expect(snapshots).toHaveLength(2)
    expect(snapshots).toEqual([
      expect.objectContaining({
        repositoryUuid: "repo-1",
        status: "attention",
        phase: "blocked",
        pendingCount: 0,
        failureCategory: "unknown",
      }),
      expect.objectContaining({
        repositoryUuid: "repo-2",
        status: "synced",
        pendingCount: 0,
      }),
    ])
    expect(JSON.stringify(snapshots[0])).not.toContain("/Users/me/repo")
    expect(JSON.stringify(snapshots[0])).not.toContain("secret-value")
    expect(coordinator.getSnapshots()).toEqual(snapshots)
  })

  it("rearms persisted recoverable retry timers when hydrating snapshots", async () => {
    const failedState = createPendingState([
      createPendingEntry({
        lastError: "网络不可用，稍后自动重试。",
        lastErrorCategory: "network",
        nextRetryAt: "2026-05-02T10:01:00.000Z",
        retryCount: 2,
      }),
    ])
    const pendingState = createPendingState([createPendingEntry({ retryCount: 2 })])
    serviceMocks.pendingPushesService.readState
      .mockResolvedValueOnce(failedState)
      .mockResolvedValueOnce(pendingState)
      .mockResolvedValueOnce(emptyPendingState)
      .mockResolvedValueOnce(emptyPendingState)
    serviceMocks.pendingPushesService.markAttempt.mockResolvedValue(pendingState)
    serviceMocks.contentSubmissionService.flushPendingPushes.mockResolvedValue(undefined)
    const eventBus = createEventBus()
    const coordinator = new RepositorySyncCoordinator({ eventBus })

    await expect(coordinator.refreshSnapshot(repository)).resolves.toMatchObject({
      repositoryUuid: "repo-1",
      status: "offline",
      phase: "retry-wait",
      nextRetryAt: "2026-05-02T10:01:00.000Z",
    })

    await vi.advanceTimersByTimeAsync(59_999)
    expect(serviceMocks.contentSubmissionService.flushPendingPushes).not.toHaveBeenCalled()

    await vi.advanceTimersByTimeAsync(1)
    await vi.waitFor(() => {
      expect(serviceMocks.contentSubmissionService.flushPendingPushes).toHaveBeenCalledTimes(1)
    })
  })

  it("clears stale retry timers when a manual retry succeeds", async () => {
    const pendingItem = createPendingEntry()
    const failedItem = createPendingEntry({
      lastError: "网络不可用，稍后自动重试。",
      lastErrorCategory: "network",
      nextRetryAt: "2026-05-02T10:00:30.000Z",
      retryCount: 1,
    })
    const pendingState = createPendingState([pendingItem])
    const failedState = createPendingState([failedItem])
    serviceMocks.pendingPushesService.readState
      .mockResolvedValueOnce(pendingState)
      .mockResolvedValueOnce(failedState)
      .mockResolvedValueOnce(pendingState)
      .mockResolvedValueOnce(emptyPendingState)
      .mockResolvedValueOnce(emptyPendingState)
      .mockResolvedValueOnce(pendingState)
      .mockResolvedValue(emptyPendingState)
    serviceMocks.pendingPushesService.markAttempt.mockResolvedValue(pendingState)
    serviceMocks.pendingPushesService.markFailure.mockResolvedValue(failedState)
    serviceMocks.contentSubmissionService.flushPendingPushes
      .mockRejectedValueOnce(new Error("fatal: unable to access: Could not resolve host: github.com"))
      .mockResolvedValueOnce(undefined)
      .mockResolvedValue(undefined)
    serviceMocks.contentIndexService.syncIndex.mockResolvedValue(undefined)
    const eventBus = createEventBus()
    const coordinator = new RepositorySyncCoordinator({ eventBus })

    await expect(coordinator.requestPush(repository, "manual")).rejects.toThrow("Could not resolve host")
    await expect(coordinator.requestPush(repository, "manual")).resolves.toBeUndefined()

    await vi.advanceTimersByTimeAsync(30_000)

    expect(serviceMocks.contentSubmissionService.flushPendingPushes).toHaveBeenCalledTimes(2)
    expect(lastSnapshotFrom(eventBus)).toMatchObject({
      repositoryUuid: "repo-1",
      status: "synced",
      pendingCount: 0,
    })
  })

  it("runs a follow-up push requested during final snapshot refresh", async () => {
    const pendingState = createPendingState([createPendingEntry()])
    const finalRefresh = createDeferred<SynapsePendingPushState>()
    serviceMocks.pendingPushesService.readState
      .mockResolvedValueOnce(pendingState)
      .mockResolvedValueOnce(emptyPendingState)
      .mockReturnValueOnce(finalRefresh.promise)
      .mockResolvedValueOnce(pendingState)
      .mockResolvedValue(emptyPendingState)
    serviceMocks.pendingPushesService.markAttempt.mockResolvedValue(pendingState)
    serviceMocks.contentSubmissionService.flushPendingPushes.mockResolvedValue(undefined)
    serviceMocks.contentIndexService.syncIndex.mockResolvedValue(undefined)
    const eventBus = createEventBus()
    const coordinator = new RepositorySyncCoordinator({ eventBus })

    const firstRequest = coordinator.requestPush(repository, "manual")

    await vi.waitFor(() => {
      expect(serviceMocks.contentSubmissionService.flushPendingPushes).toHaveBeenCalledTimes(1)
    })
    await vi.waitFor(() => {
      expect(serviceMocks.pendingPushesService.readState).toHaveBeenCalledTimes(3)
    })

    const secondRequest = coordinator.requestPush(repository, "content-saved")

    expect(secondRequest).not.toBe(firstRequest)

    finalRefresh.resolve(emptyPendingState)

    await Promise.all([firstRequest, secondRequest])
    expect(serviceMocks.contentSubmissionService.flushPendingPushes).toHaveBeenCalledTimes(2)
  })

  it("does not clear an existing retry timer when push is only queued behind sync", async () => {
    const pendingState = createPendingState([createPendingEntry()])
    const failedState = createPendingState([
      createPendingEntry({
        lastError: "网络不可用，稍后自动重试。",
        lastErrorCategory: "network",
        nextRetryAt: "2026-05-02T10:00:30.000Z",
        retryCount: 1,
      }),
    ])
    const sync = createDeferred<SynapseRepositoryOperationResult>()
    serviceMocks.pendingPushesService.readState
      .mockResolvedValueOnce(pendingState)
      .mockResolvedValueOnce(failedState)
      .mockResolvedValueOnce(emptyPendingState)
      .mockResolvedValueOnce(emptyPendingState)
      .mockResolvedValue(emptyPendingState)
    serviceMocks.pendingPushesService.markAttempt.mockResolvedValue(pendingState)
    serviceMocks.pendingPushesService.markFailure.mockResolvedValue(failedState)
    serviceMocks.contentSubmissionService.flushPendingPushes
      .mockRejectedValueOnce(new Error("fatal: unable to access: Could not resolve host: github.com"))
      .mockResolvedValue(undefined)
    serviceMocks.contentIndexService.syncIndex.mockResolvedValue(undefined)
    serviceMocks.repositoryGitService.syncRepository.mockReturnValue(sync.promise)
    const eventBus = createEventBus()
    const coordinator = new RepositorySyncCoordinator({ eventBus })

    await expect(coordinator.requestPush(repository, "manual")).rejects.toThrow("Could not resolve host")
    const syncRequest = coordinator.requestSync(repository, "manual")

    await vi.waitFor(() => {
      expect(serviceMocks.repositoryGitService.syncRepository).toHaveBeenCalledTimes(1)
    })
    const queuedPush = coordinator.requestPush(repository, "content-saved")

    expect(vi.getTimerCount()).toBe(1)
    await vi.advanceTimersByTimeAsync(30_000)
    expect(serviceMocks.contentSubmissionService.flushPendingPushes).toHaveBeenCalledTimes(1)

    sync.resolve({
      operation: "sync",
      repository: repositoryState,
      completedAt: "2026-05-02T10:00:30.000Z",
    })

    await expect(syncRequest).resolves.toMatchObject({ operation: "sync" })
    await expect(queuedPush).resolves.toBeUndefined()
    expect(serviceMocks.contentSubmissionService.flushPendingPushes).toHaveBeenCalledTimes(1)
  })

  it("rejects manual sync when pending push fails", async () => {
    const pendingItem = createPendingEntry()
    const failedItem = createPendingEntry({
      lastError: "网络不可用，稍后自动重试。",
      lastErrorCategory: "network",
      nextRetryAt: "2026-05-02T10:00:30.000Z",
      retryCount: 1,
    })
    const pendingState = createPendingState([pendingItem])
    const failedState = createPendingState([failedItem])
    serviceMocks.pendingPushesService.readState
      .mockResolvedValueOnce(pendingState)
      .mockResolvedValue(failedState)
    serviceMocks.pendingPushesService.markAttempt.mockResolvedValue(pendingState)
    serviceMocks.pendingPushesService.markFailure.mockResolvedValue(failedState)
    serviceMocks.contentSubmissionService.flushPendingPushes.mockRejectedValue(
      new Error("fatal: unable to access: Could not resolve host: github.com"),
    )
    const eventBus = createEventBus()
    const coordinator = new RepositorySyncCoordinator({ eventBus })

    await expect(coordinator.requestSync(repository, "manual")).rejects.toThrow("Could not resolve host")

    expect(serviceMocks.pendingPushesService.markFailure).toHaveBeenCalledTimes(1)
    expect(serviceMocks.repositoryStore.getRepositoryState).not.toHaveBeenCalled()
    expect(lastSnapshotFrom(eventBus)).toMatchObject({
      repositoryUuid: "repo-1",
      status: "offline",
      phase: "retry-wait",
      failureCategory: "network",
      pendingCount: 1,
    })
  })

  it("joins a running push when manual sync starts before the push fails", async () => {
    const pendingItem = createPendingEntry()
    const failedItem = createPendingEntry({
      lastError: "网络不可用，稍后自动重试。",
      lastErrorCategory: "network",
      nextRetryAt: "2026-05-02T10:00:30.000Z",
      retryCount: 1,
    })
    const pendingState = createPendingState([pendingItem])
    const failedState = createPendingState([failedItem])
    serviceMocks.pendingPushesService.readState
      .mockResolvedValueOnce(pendingState)
      .mockResolvedValue(failedState)
    serviceMocks.pendingPushesService.markAttempt.mockResolvedValue(pendingState)
    serviceMocks.pendingPushesService.markFailure.mockResolvedValue(failedState)
    const flush = createDeferred<void>()
    serviceMocks.contentSubmissionService.flushPendingPushes.mockReturnValue(flush.promise)
    const eventBus = createEventBus()
    const coordinator = new RepositorySyncCoordinator({ eventBus })

    const pushRequest = coordinator.requestPush(repository, "content-saved")

    await vi.waitFor(() => {
      expect(serviceMocks.contentSubmissionService.flushPendingPushes).toHaveBeenCalledTimes(1)
    })
    const syncRequest = coordinator.requestSync(repository, "manual")
    const pushExpectation = expect(pushRequest).rejects.toThrow("Could not resolve host")
    const syncExpectation = expect(syncRequest).rejects.toThrow("Could not resolve host")

    flush.reject(new Error("fatal: unable to access: Could not resolve host: github.com"))

    await Promise.all([pushExpectation, syncExpectation])
    expect(serviceMocks.contentSubmissionService.flushPendingPushes).toHaveBeenCalledTimes(1)
    expect(serviceMocks.pendingPushesService.markFailure).toHaveBeenCalledTimes(1)
    expect(serviceMocks.repositoryStore.getRepositoryState).not.toHaveBeenCalled()
    expect(lastSnapshotFrom(eventBus)).toMatchObject({
      repositoryUuid: "repo-1",
      status: "offline",
      phase: "retry-wait",
      failureCategory: "network",
    })
  })

  it("waits for an active push before starting a no-pending manual sync", async () => {
    const pendingState = createPendingState([createPendingEntry()])
    const push = createDeferred<void>()
    const syncResult = {
      operation: "sync" as const,
      repository: {
        repositoryUuid: "repo-1",
        localPath: "/tmp/synapse-docs",
        status: "ready" as const,
        isGitRepository: true,
        gitRootPath: "/tmp/synapse-docs",
      },
      completedAt: "2026-05-02T10:00:20.000Z",
    }
    serviceMocks.pendingPushesService.readState
      .mockResolvedValueOnce(pendingState)
      .mockResolvedValue(emptyPendingState)
    serviceMocks.pendingPushesService.markAttempt.mockResolvedValue(pendingState)
    serviceMocks.contentSubmissionService.flushPendingPushes.mockReturnValue(push.promise)
    serviceMocks.contentIndexService.syncIndex.mockResolvedValue(undefined)
    serviceMocks.repositoryGitService.syncRepository.mockResolvedValue(syncResult)
    const eventBus = createEventBus()
    const coordinator = new RepositorySyncCoordinator({ eventBus })

    const pushRequest = coordinator.requestPush(repository, "content-saved")

    await vi.waitFor(() => {
      expect(serviceMocks.contentSubmissionService.flushPendingPushes).toHaveBeenCalledTimes(1)
    })
    const syncRequest = coordinator.requestSync(repository, "manual")

    expect(serviceMocks.repositoryGitService.syncRepository).not.toHaveBeenCalled()

    push.resolve()

    await expect(pushRequest).resolves.toBeUndefined()
    await expect(syncRequest).resolves.toEqual(syncResult)
    expect(serviceMocks.repositoryGitService.syncRepository).toHaveBeenCalledTimes(1)
    expect(serviceMocks.pendingPushesService.readState).toHaveBeenCalledTimes(5)
  })

  it("emits legacy progress events during sync", async () => {
    const syncResult = {
      operation: "sync" as const,
      repository: repositoryState,
      completedAt: "2026-05-02T10:00:20.000Z",
    }
    serviceMocks.pendingPushesService.readState.mockResolvedValue(emptyPendingState)
    serviceMocks.repositoryGitService.syncRepository.mockImplementation(
      async (_repository, onProgress: (event: {
        repositoryUuid: string
        operation: "sync"
        statusText: string
        percent: number | null
      }) => void) => {
        onProgress({
          repositoryUuid: "repo-1",
          operation: "sync",
          statusText: "正在拉取仓库",
          percent: 40,
        })
        return syncResult
      },
    )
    const eventBus = createEventBus()
    const coordinator = new RepositorySyncCoordinator({ eventBus })

    await expect(coordinator.requestSync(repository, "manual")).resolves.toEqual(syncResult)

    expect(emittedEventsOfType(eventBus, "repository.progress")).toContainEqual(expect.objectContaining({
      domain: "repository",
      payload: {
        repositoryUuid: "repo-1",
        operation: "sync",
        statusText: "正在拉取仓库",
        percent: 40,
      },
    }))
  })

  it("does not hydrate over an active sync snapshot", async () => {
    const syncResult = {
      operation: "sync" as const,
      repository: repositoryState,
      completedAt: "2026-05-02T10:00:20.000Z",
    }
    const sync = createDeferred<typeof syncResult>()
    serviceMocks.pendingPushesService.readState.mockResolvedValue(emptyPendingState)
    serviceMocks.repositoryGitService.syncRepository.mockReturnValue(sync.promise)
    const eventBus = createEventBus()
    const coordinator = new RepositorySyncCoordinator({ eventBus })

    const syncRequest = coordinator.requestSync(repository, "manual")

    await vi.waitFor(() => {
      expect(serviceMocks.repositoryGitService.syncRepository).toHaveBeenCalledTimes(1)
    })

    const beforeEvents = emittedEventsOfType(eventBus, "repository.syncSnapshotUpdated")
    expect(beforeEvents.at(-1)?.payload.snapshot).toMatchObject({
      repositoryUuid: "repo-1",
      status: "syncing",
      operation: "sync",
    })

    const snapshots = await coordinator.getSnapshotsForRepositories([repository])

    expect(snapshots).toEqual([
      expect.objectContaining({
        repositoryUuid: "repo-1",
        status: "syncing",
        operation: "sync",
      }),
    ])
    expect(emittedEventsOfType(eventBus, "repository.syncSnapshotUpdated")).toHaveLength(
      beforeEvents.length,
    )

    sync.resolve(syncResult)
    await expect(syncRequest).resolves.toEqual(syncResult)
  })

  it("waits for an active push before starting maintenance", async () => {
    const pendingState = createPendingState([createPendingEntry()])
    const push = createDeferred<void>()
    const maintenanceResult = createMaintenanceResult({ message: "整理完成。" })
    serviceMocks.pendingPushesService.readState
      .mockResolvedValueOnce(pendingState)
      .mockResolvedValue(emptyPendingState)
    serviceMocks.pendingPushesService.markAttempt.mockResolvedValue(pendingState)
    serviceMocks.contentSubmissionService.flushPendingPushes.mockReturnValue(push.promise)
    serviceMocks.contentIndexService.syncIndex.mockResolvedValue(undefined)
    serviceMocks.repositoryMaintenanceService.runManualMaintenance.mockResolvedValue(maintenanceResult)
    serviceMocks.repositoryStore.getRepositoryState.mockResolvedValue(repositoryState)
    const eventBus = createEventBus()
    const coordinator = new RepositorySyncCoordinator({ eventBus })

    const pushRequest = coordinator.requestPush(repository, "content-saved")

    await vi.waitFor(() => {
      expect(serviceMocks.contentSubmissionService.flushPendingPushes).toHaveBeenCalledTimes(1)
    })
    const maintenanceRequest = coordinator.requestMaintenance(repository)

    expect(serviceMocks.repositoryMaintenanceService.runManualMaintenance).not.toHaveBeenCalled()

    push.resolve()

    await expect(pushRequest).resolves.toBeUndefined()
    await expect(maintenanceRequest).resolves.toMatchObject({
      operation: "maintenance",
      message: "整理完成。",
      pendingPushCount: 0,
    })
    expect(serviceMocks.repositoryMaintenanceService.runManualMaintenance).toHaveBeenCalledTimes(1)
  })

  it("emits legacy progress events during push and leaves index refresh to the flush service", async () => {
    const pendingState = createPendingState([createPendingEntry()])
    serviceMocks.pendingPushesService.readState
      .mockResolvedValueOnce(pendingState)
      .mockResolvedValue(emptyPendingState)
    serviceMocks.pendingPushesService.markAttempt.mockResolvedValue(pendingState)
    serviceMocks.contentSubmissionService.flushPendingPushes.mockImplementation(
      async (_repository, onProgress: (statusText: string) => void) => {
        onProgress("正在推送变更")
      },
    )
    const eventBus = createEventBus()
    const coordinator = new RepositorySyncCoordinator({ eventBus })

    await expect(coordinator.requestPush(repository, "manual")).resolves.toBeUndefined()

    expect(emittedEventsOfType(eventBus, "repository.progress")).toContainEqual(expect.objectContaining({
      domain: "repository",
      payload: {
        repositoryUuid: "repo-1",
        operation: "push",
        statusText: "正在推送变更",
        percent: null,
      },
    }))
    expect(serviceMocks.contentIndexService.syncIndex).not.toHaveBeenCalled()
  })

  it("waits for active maintenance before starting a push", async () => {
    const pendingState = createPendingState([createPendingEntry()])
    const maintenance = createDeferred<ReturnType<typeof createMaintenanceResult>>()
    serviceMocks.pendingPushesService.readState
      .mockResolvedValueOnce(emptyPendingState)
      .mockResolvedValueOnce(pendingState)
      .mockResolvedValue(emptyPendingState)
    serviceMocks.repositoryMaintenanceService.runManualMaintenance.mockReturnValue(maintenance.promise)
    serviceMocks.repositoryStore.getRepositoryState.mockResolvedValue(repositoryState)
    serviceMocks.pendingPushesService.markAttempt.mockResolvedValue(pendingState)
    serviceMocks.contentSubmissionService.flushPendingPushes.mockResolvedValue(undefined)
    serviceMocks.contentIndexService.syncIndex.mockResolvedValue(undefined)
    const eventBus = createEventBus()
    const coordinator = new RepositorySyncCoordinator({ eventBus })

    const maintenanceRequest = coordinator.requestMaintenance(repository)

    await vi.waitFor(() => {
      expect(serviceMocks.repositoryMaintenanceService.runManualMaintenance).toHaveBeenCalledTimes(1)
    })
    const pushRequest = coordinator.requestPush(repository, "content-saved")

    expect(serviceMocks.contentSubmissionService.flushPendingPushes).not.toHaveBeenCalled()

    maintenance.resolve(createMaintenanceResult())

    await expect(maintenanceRequest).resolves.toMatchObject({ operation: "maintenance" })
    await expect(pushRequest).resolves.toBeUndefined()
    expect(serviceMocks.contentSubmissionService.flushPendingPushes).toHaveBeenCalledTimes(1)
  })

  it("emits legacy progress events during maintenance", async () => {
    const maintenanceResult = createMaintenanceResult({ message: "整理完成。" })
    serviceMocks.repositoryMaintenanceService.runManualMaintenance.mockImplementation(
      async (_repository, onProgress: (statusText: string) => void) => {
        onProgress("正在整理仓库")
        return maintenanceResult
      },
    )
    serviceMocks.repositoryStore.getRepositoryState.mockResolvedValue(repositoryState)
    serviceMocks.pendingPushesService.readState.mockResolvedValue(emptyPendingState)
    const eventBus = createEventBus()
    const coordinator = new RepositorySyncCoordinator({ eventBus })

    await expect(coordinator.requestMaintenance(repository)).resolves.toMatchObject({
      operation: "maintenance",
      message: "整理完成。",
    })

    expect(emittedEventsOfType(eventBus, "repository.progress")).toContainEqual(expect.objectContaining({
      domain: "repository",
      payload: {
        repositoryUuid: "repo-1",
        operation: "maintenance",
        statusText: "正在整理仓库",
        percent: null,
      },
    }))
  })

  it("emits a terminal failure snapshot when maintenance fails", async () => {
    serviceMocks.pendingPushesService.readState.mockResolvedValue(emptyPendingState)
    serviceMocks.repositoryMaintenanceService.runManualMaintenance.mockImplementation(
      async (_repository, onProgress: (statusText: string) => void) => {
        onProgress("正在整理仓库")
        throw new Error("fatal: not a git repository")
      },
    )
    const eventBus = createEventBus()
    const coordinator = new RepositorySyncCoordinator({ eventBus })

    await expect(coordinator.requestMaintenance(repository)).rejects.toThrow("not a git repository")

    expect(lastSnapshotFrom(eventBus)).toMatchObject({
      repositoryUuid: "repo-1",
      status: "attention",
      operation: "maintenance",
      phase: "blocked",
      failureCategory: "not-git",
      message: "当前目录不是 Git 仓库。",
    })
  })

  it("schedules recoverable push retries from the persisted nextRetryAt timestamp", async () => {
    const pendingItem = createPendingEntry({ retryCount: 1 })
    const failedItem = createPendingEntry({
      lastError: "网络不可用，稍后自动重试。",
      lastErrorCategory: "network",
      nextRetryAt: "2026-05-02T10:01:00.000Z",
      retryCount: 2,
    })
    const pendingState = createPendingState([pendingItem])
    const failedState = createPendingState([failedItem])
    serviceMocks.pendingPushesService.readState
      .mockResolvedValueOnce(pendingState)
      .mockResolvedValueOnce(failedState)
      .mockResolvedValueOnce(pendingState)
    serviceMocks.pendingPushesService.markAttempt.mockResolvedValue(pendingState)
    serviceMocks.pendingPushesService.markFailure.mockResolvedValue(failedState)
    serviceMocks.contentSubmissionService.flushPendingPushes
      .mockRejectedValueOnce(new Error("fatal: unable to access: Could not resolve host: github.com"))
      .mockReturnValueOnce(new Promise<void>(() => {}))
    const eventBus = createEventBus()
    const coordinator = new RepositorySyncCoordinator({ eventBus })

    await expect(coordinator.requestPush(repository, "manual")).rejects.toThrow("Could not resolve host")

    expect(serviceMocks.pendingPushesService.markFailure).toHaveBeenCalledWith(
      repository,
      "网络不可用，稍后自动重试。",
      [1],
      expect.objectContaining({
        nextRetryAt: "2026-05-02T10:01:00.000Z",
      }),
    )
    await vi.advanceTimersByTimeAsync(59_999)
    expect(serviceMocks.contentSubmissionService.flushPendingPushes).toHaveBeenCalledTimes(1)

    await vi.advanceTimersByTimeAsync(1)
    await vi.waitFor(() => {
      expect(serviceMocks.contentSubmissionService.flushPendingPushes).toHaveBeenCalledTimes(2)
    })
  })

  it("merges duplicate manual sync requests when there are no pending pushes", async () => {
    const syncResult = {
      operation: "sync" as const,
      repository: {
        repositoryUuid: "repo-1",
        localPath: "/tmp/synapse-docs",
        status: "ready" as const,
        isGitRepository: true,
        gitRootPath: "/tmp/synapse-docs",
      },
      completedAt: "2026-05-02T10:00:15.000Z",
    }
    const sync = createDeferred<typeof syncResult>()
    serviceMocks.pendingPushesService.readState.mockResolvedValue(emptyPendingState)
    serviceMocks.repositoryGitService.syncRepository.mockReturnValue(sync.promise)
    const eventBus = createEventBus()
    const coordinator = new RepositorySyncCoordinator({ eventBus })

    const firstRequest = coordinator.requestSync(repository, "manual")
    const secondRequest = coordinator.requestSync(repository, "manual")

    await vi.waitFor(() => {
      expect(serviceMocks.repositoryGitService.syncRepository).toHaveBeenCalledTimes(1)
    })
    sync.resolve(syncResult)

    await expect(firstRequest).resolves.toEqual(syncResult)
    await expect(secondRequest).resolves.toEqual(syncResult)
    expect(serviceMocks.repositoryGitService.syncRepository).toHaveBeenCalledTimes(1)
  })

  it("continues a queued push after an active sync rejects", async () => {
    const pendingItem = createPendingEntry()
    const failedItem = createPendingEntry({
      lastError: "网络不可用，稍后自动重试。",
      lastErrorCategory: "network",
      nextRetryAt: "2026-05-02T10:00:30.000Z",
      retryCount: 1,
    })
    const pendingState = createPendingState([pendingItem])
    const failedState = createPendingState([failedItem])
    const sync = createDeferred<never>()
    serviceMocks.pendingPushesService.readState
      .mockResolvedValueOnce(emptyPendingState)
      .mockResolvedValueOnce(pendingState)
      .mockResolvedValueOnce(failedState)
      .mockResolvedValue(failedState)
    serviceMocks.repositoryGitService.syncRepository.mockReturnValue(sync.promise)
    serviceMocks.pendingPushesService.markAttempt.mockResolvedValue(pendingState)
    serviceMocks.pendingPushesService.markFailure.mockResolvedValue(failedState)
    serviceMocks.contentSubmissionService.flushPendingPushes.mockRejectedValue(
      new Error("fatal: unable to access: Could not resolve host: github.com"),
    )
    const eventBus = createEventBus()
    const coordinator = new RepositorySyncCoordinator({ eventBus })

    const syncRequest = coordinator.requestSync(repository, "manual")

    await vi.waitFor(() => {
      expect(serviceMocks.repositoryGitService.syncRepository).toHaveBeenCalledTimes(1)
    })
    const pushRequest = coordinator.requestPush(repository, "content-saved")
    const syncExpectation = expect(syncRequest).rejects.toThrow("sync failed")
    const pushExpectation = expect(pushRequest).rejects.toThrow("Could not resolve host")

    sync.reject(new Error("sync failed"))

    await Promise.all([syncExpectation, pushExpectation])
    expect(serviceMocks.contentSubmissionService.flushPendingPushes).toHaveBeenCalledTimes(1)
    expect(serviceMocks.pendingPushesService.markFailure).toHaveBeenCalledTimes(1)
    expect(serviceMocks.pendingPushesService.markFailure).toHaveBeenCalledWith(
      repository,
      "网络不可用，稍后自动重试。",
      [1],
      expect.objectContaining({
        category: "network",
      }),
    )
    expect(lastSnapshotFrom(eventBus)).toMatchObject({
      repositoryUuid: "repo-1",
      status: "offline",
      phase: "retry-wait",
      failureCategory: "network",
    })
  })

  it("preserves failed sync snapshot when queued push has no pending work", async () => {
    const sync = createDeferred<never>()
    serviceMocks.pendingPushesService.readState.mockResolvedValue(emptyPendingState)
    serviceMocks.repositoryGitService.syncRepository.mockReturnValue(sync.promise)
    const eventBus = createEventBus()
    const coordinator = new RepositorySyncCoordinator({ eventBus })

    const syncRequest = coordinator.requestSync(repository, "manual")

    await vi.waitFor(() => {
      expect(serviceMocks.repositoryGitService.syncRepository).toHaveBeenCalledTimes(1)
    })
    const pushRequest = coordinator.requestPush(repository, "content-saved")

    sync.reject(new Error("fatal: not a git repository"))

    await expect(syncRequest).rejects.toThrow("not a git repository")
    await expect(pushRequest).rejects.toThrow("not a git repository")
    expect(serviceMocks.contentSubmissionService.flushPendingPushes).not.toHaveBeenCalled()
    expect(lastSnapshotFrom(eventBus)).toMatchObject({
      repositoryUuid: "repo-1",
      status: "attention",
      operation: "sync",
      phase: "blocked",
      failureCategory: "not-git",
    })
  })

  it("preserves failed maintenance snapshot when queued push has no pending work", async () => {
    const maintenance = createDeferred<never>()
    serviceMocks.pendingPushesService.readState.mockResolvedValue(emptyPendingState)
    serviceMocks.repositoryMaintenanceService.runManualMaintenance.mockReturnValue(maintenance.promise)
    const eventBus = createEventBus()
    const coordinator = new RepositorySyncCoordinator({ eventBus })

    const maintenanceRequest = coordinator.requestMaintenance(repository)

    await vi.waitFor(() => {
      expect(serviceMocks.repositoryMaintenanceService.runManualMaintenance).toHaveBeenCalledTimes(1)
    })
    const pushRequest = coordinator.requestPush(repository, "content-saved")

    maintenance.reject(new Error("fatal: not a git repository"))

    await expect(maintenanceRequest).rejects.toThrow("not a git repository")
    await expect(pushRequest).rejects.toThrow("not a git repository")
    expect(serviceMocks.contentSubmissionService.flushPendingPushes).not.toHaveBeenCalled()
    expect(lastSnapshotFrom(eventBus)).toMatchObject({
      repositoryUuid: "repo-1",
      status: "attention",
      operation: "maintenance",
      phase: "blocked",
      failureCategory: "not-git",
    })
  })

  it("merges duplicate push requests while a push is already running", async () => {
    const pendingState = createPendingState([createPendingEntry()])
    serviceMocks.pendingPushesService.readState
      .mockResolvedValueOnce(pendingState)
      .mockResolvedValueOnce(emptyPendingState)
      .mockResolvedValue(emptyPendingState)
    serviceMocks.pendingPushesService.markAttempt.mockResolvedValue(pendingState)
    let resolveFlush: () => void = () => {}
    serviceMocks.contentSubmissionService.flushPendingPushes.mockImplementation(
      () => new Promise<void>((resolve) => {
        resolveFlush = resolve
      }),
    )
    serviceMocks.contentIndexService.syncIndex.mockResolvedValue(undefined)
    const eventBus = createEventBus()
    const coordinator = new RepositorySyncCoordinator({ eventBus })

    const firstRequest = coordinator.requestPush(repository, "manual")
    const secondRequest = coordinator.requestPush(repository, "content-saved")

    expect(secondRequest).toBe(firstRequest)

    await vi.waitFor(() => {
      expect(serviceMocks.contentSubmissionService.flushPendingPushes).toHaveBeenCalledTimes(1)
    })
    resolveFlush()
    await Promise.all([firstRequest, secondRequest])

    expect(serviceMocks.contentSubmissionService.flushPendingPushes).toHaveBeenCalledTimes(1)
    expect(serviceMocks.contentSubmissionService.flushPendingPushes).toHaveBeenCalledWith(
      repository,
      expect.any(Function),
      { recordFailure: false },
    )
    expect(lastSnapshotFrom(eventBus)).toMatchObject({
      repositoryUuid: "repo-1",
      status: "synced",
      pendingCount: 0,
    })
  })
})
