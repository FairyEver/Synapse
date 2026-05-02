import type { Mock } from "vitest"
import { beforeEach, describe, expect, it, vi } from "vitest"
import type { EventBus } from "../../runtime/event-bus"
import type { SynapseRepositoryConfig } from "../../../src/types/config"
import type { SynapsePendingPushEntry, SynapsePendingPushState } from "../../../src/types/repository"
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
  },
  pendingPushesService: {
    countAll: vi.fn(),
    markAttempt: vi.fn(),
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

vi.mock("../repository-store", () => ({
  repositoryStore: serviceMocks.repositoryStore,
}))

const repository: SynapseRepositoryConfig = {
  uuid: "repo-1",
  name: "Docs",
  localPath: "/tmp/synapse-docs",
  contentDirs: {},
}

const emptyPendingState: SynapsePendingPushState = {
  count: 0,
  items: [],
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

function createDeferred<T>() {
  let resolve!: (value: T | PromiseLike<T>) => void
  let reject!: (reason?: unknown) => void
  const promise = new Promise<T>((promiseResolve, promiseReject) => {
    resolve = promiseResolve
    reject = promiseReject
  })

  return { promise, reject, resolve }
}

describe("RepositorySyncCoordinator", () => {
  beforeEach(() => {
    vi.useFakeTimers()
    vi.setSystemTime(new Date("2026-05-02T10:00:00.000Z"))
    vi.clearAllMocks()
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
