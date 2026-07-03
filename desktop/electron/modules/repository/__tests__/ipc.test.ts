import path from "node:path"
import { beforeEach, describe, expect, it, vi } from "vitest"

const mocks = vi.hoisted(() => {
  type TestInstallStatusMap = Record<string, Array<{
    editorId: string
    scope: "global"
    status: "installed" | "needs_update"
  }>>

  let installStatus: TestInstallStatusMap = {
    "skill-1": [{
      editorId: "codex",
      scope: "global",
      status: "installed",
    }],
  }
  let nextInstallStatus: TestInstallStatusMap = {
    "skill-1": [{
      editorId: "codex",
      scope: "global",
      status: "needs_update",
    }],
  }

  return {
    coordinator: {
      requestMaintenance: vi.fn(),
      requestPush: vi.fn(),
      requestSync: vi.fn(),
    },
    contentIndexService: {
      syncIndex: vi.fn(),
    },
    contentSubmissionService: {
      readPendingPushState: vi.fn(),
    },
    eventBus: {
      emit: vi.fn(),
    },
    auditSink: {
      clearForTests: vi.fn(),
      list: vi.fn(() => []),
      record: vi.fn(),
    },
    installStatusCacheService: {
      buildCache: vi.fn(async () => {
        installStatus = nextInstallStatus
      }),
      getAll: vi.fn(() => installStatus),
    },
    logger: {
      debug: vi.fn(),
      error: vi.fn(),
      info: vi.fn(),
      warn: vi.fn(),
    },
    repository: {
      uuid: "repo-1",
      name: "Repo",
      localPath: "/repo",
      contentDirs: {},
    },
    repositoryState: {
      repositoryUuid: "repo-1",
      localPath: "/repo",
      status: "ready",
      isGitRepository: true,
      gitRootPath: "/repo",
    },
    repositoryStructureService: {
      checkInitializationPreview: vi.fn(),
      createLocalRepository: vi.fn(),
      ensureContentDirectories: vi.fn(),
      initializeStructure: vi.fn(),
      validateDirectoryStructure: vi.fn(),
    },
    permissionGuard: {
      check: vi.fn(),
      registerPolicy: vi.fn(),
    },
    resetInstallStatus: () => {
      installStatus = {
        "skill-1": [{
          editorId: "codex",
          scope: "global",
          status: "installed",
        }],
      }
      nextInstallStatus = {
        "skill-1": [{
          editorId: "codex",
          scope: "global",
          status: "needs_update",
        }],
      }
    },
    setNextInstallStatus: (next: typeof installStatus) => {
      nextInstallStatus = next
    },
  }
})

vi.mock("electron", () => ({
  BrowserWindow: {
    getAllWindows: vi.fn(() => []),
    getFocusedWindow: vi.fn(() => null),
  },
  dialog: {
    showOpenDialog: vi.fn(),
  },
}))

vi.mock("../../../services/config-store", () => ({
  configStore: {
    load: vi.fn(async () => ({ activeRepoUuid: "repo-1", repositories: [mocks.repository], global: {} })),
  },
}))

vi.mock("../../../services/content-index-service", () => ({
  contentIndexService: mocks.contentIndexService,
}))

vi.mock("../../../services/content-submission-service", () => ({
  contentSubmissionService: mocks.contentSubmissionService,
}))

vi.mock("../../../services/install-status-cache-service", () => ({
  installStatusCacheService: mocks.installStatusCacheService,
}))

vi.mock("../../../services/log-store", () => ({
  createMainLogger: () => mocks.logger,
}))

vi.mock("../../../services/repository-store", () => ({
  repositoryStore: {
    getRepositoryState: vi.fn(async () => mocks.repositoryState),
  },
}))

vi.mock("../../../services/repository-structure-service", () => ({
  repositoryStructureService: mocks.repositoryStructureService,
}))

vi.mock("../../../services/repository-sync-coordinator", () => ({
  RepositorySyncCoordinator: vi.fn(),
}))

function createContext() {
  return {
    moduleId: "repository",
    resolve: vi.fn((id: string) => {
      if (id === "core.event-bus") {
        return mocks.eventBus
      }
      if (id === "repo.sync-coordinator") {
        return mocks.coordinator
      }
      if (id === "core.permission-guard") {
        return mocks.permissionGuard
      }
      if (id === "core.audit-sink") {
        return mocks.auditSink
      }
      throw new Error(`Unexpected service id: ${id}`)
    }),
  }
}

describe("repositoryIpcModule", () => {
  beforeEach(() => {
    vi.clearAllMocks()
    mocks.resetInstallStatus()
    mocks.coordinator.requestSync.mockResolvedValue({
      operation: "sync",
      repository: mocks.repositoryState,
      completedAt: "2026-05-21T13:00:00.000Z",
    })
    mocks.coordinator.requestMaintenance.mockResolvedValue({
      operation: "maintenance",
      repository: mocks.repositoryState,
      completedAt: "2026-05-21T13:00:00.000Z",
      message: "维护完成",
      pendingPushCount: 0,
    })
    mocks.coordinator.requestPush.mockResolvedValue(undefined)
    mocks.repositoryStructureService.checkInitializationPreview.mockResolvedValue({
      isEmpty: false,
      nonGitEntries: ["notes.md"],
      operationToken: "preview-token",
      dangerFlags: [],
    })
    mocks.repositoryStructureService.initializeStructure.mockResolvedValue({
      initializedAt: "2026-05-21T14:00:00.000Z",
      pendingPushCount: 1,
      repository: mocks.repositoryState,
    })
    mocks.contentSubmissionService.readPendingPushState.mockResolvedValue({ count: 0, items: [] })
    mocks.permissionGuard.check.mockResolvedValue({ allowed: true })
    mocks.repositoryStructureService.createLocalRepository.mockResolvedValue({
      createdAt: "2026-05-21T12:00:00.000Z",
      repository: {
        uuid: "repo-local",
        name: "Local Repo",
        localPath: "/parent/Local Repo",
        contentDirs: {},
      },
    })
  })

  it("guards local repository creation with write permission and audit", async () => {
    const { repositoryIpcModule } = await import("../ipc")
    const parentPath = path.resolve("/parent")
    const resourcePath = path.resolve("/parent", "Local Repo")

    await repositoryIpcModule.methods.createLocalRepository.handler(createContext() as never, {
      name: "Local Repo",
      parentPath: "/parent",
    })

    expect(mocks.permissionGuard.check).toHaveBeenCalledWith({
      action: "fs.write.outside-userdata",
      actor: { kind: "user" },
      resource: resourcePath,
      context: {
        source: "repository.createLocalRepository",
        parentPath,
      },
    })
    expect(mocks.repositoryStructureService.createLocalRepository).toHaveBeenCalledWith({
      name: "Local Repo",
      parentPath: "/parent",
    })
    expect(mocks.auditSink.record).toHaveBeenCalledWith(expect.objectContaining({
      action: "fs.write.outside-userdata",
      actor: { kind: "user" },
      resource: resourcePath,
      outcome: "allowed",
      metadata: { source: "repository.createLocalRepository" },
    }))
  })

  it("returns inaccessible state for repositories that fail during batch state refresh", async () => {
    const { repositoryIpcModule } = await import("../ipc")
    const { repositoryStore } = await import("../../../services/repository-store")
    vi.mocked(repositoryStore.getRepositoryState).mockRejectedValueOnce(new Error("EACCES: permission denied"))

    await expect(repositoryIpcModule.methods.getStates.handler(createContext() as never, undefined))
      .resolves.toEqual([{
        repositoryUuid: "repo-1",
        localPath: "/repo",
        status: "inaccessible",
        isGitRepository: false,
        gitRootPath: null,
      }])
    expect(mocks.logger.warn).toHaveBeenCalledWith(
      "Repository state resolution failed; returning inaccessible state.",
      expect.objectContaining({ repositoryUuid: "repo-1" }),
    )
  })

  it("does not create a local repository when write permission is denied", async () => {
    const { repositoryIpcModule } = await import("../ipc")
    const resourcePath = path.resolve("/parent", "Local Repo")
    mocks.permissionGuard.check.mockResolvedValueOnce({
      allowed: false,
      reason: "denied by test-policy",
      policyId: "test-policy",
    })

    await expect(repositoryIpcModule.methods.createLocalRepository.handler(createContext() as never, {
      name: "Local Repo",
      parentPath: "/parent",
    })).rejects.toThrow("denied by test-policy")

    expect(mocks.repositoryStructureService.createLocalRepository).not.toHaveBeenCalled()
    expect(mocks.auditSink.record).toHaveBeenCalledWith(expect.objectContaining({
      action: "fs.write.outside-userdata",
      actor: { kind: "user" },
      resource: resourcePath,
      outcome: "denied",
      metadata: {
        source: "repository.createLocalRepository",
        reason: "denied by test-policy",
        policyId: "test-policy",
      },
    }))
  })

  it("logs repository initialization preview lifecycle", async () => {
    const { repositoryIpcModule } = await import("../ipc")

    await repositoryIpcModule.methods.checkInitializationPreview.handler(createContext() as never, {
      repositoryUuid: "repo-1",
    })

    expect(mocks.logger.info).toHaveBeenCalledWith(
      "Handling repository.checkInitializationPreview request. repositoryUuid: repo-1",
    )
    expect(mocks.logger.info).toHaveBeenCalledWith(
      "repository.checkInitializationPreview request completed. repositoryUuid: repo-1, isEmpty: false, nonGitEntryCount: 1, dangerFlagCount: 0",
    )
  })

  it("logs repository initialization preview failures", async () => {
    const { repositoryIpcModule } = await import("../ipc")
    mocks.repositoryStructureService.checkInitializationPreview.mockRejectedValueOnce(new Error("preview failed"))

    await expect(repositoryIpcModule.methods.checkInitializationPreview.handler(createContext() as never, {
      repositoryUuid: "repo-1",
    })).rejects.toThrow("preview failed")

    expect(mocks.logger.error).toHaveBeenCalledWith(
      "repository.checkInitializationPreview request failed. repositoryUuid: repo-1, error: Error: preview failed",
    )
  })

  it("logs repository initialization failures without exposing confirmation tokens", async () => {
    const { repositoryIpcModule } = await import("../ipc")
    mocks.repositoryStructureService.initializeStructure.mockRejectedValueOnce(new Error("init failed"))

    await expect(repositoryIpcModule.methods.initializeStructure.handler(createContext() as never, {
      repositoryUuid: "repo-1",
      options: { confirmedOperationToken: "secret-token" },
    })).rejects.toThrow("init failed")

    expect(mocks.logger.info).toHaveBeenCalledWith(
      "Handling repository.initializeStructure request. repositoryUuid: repo-1, hasConfirmedOperationToken: true",
    )
    expect(mocks.logger.error).toHaveBeenCalledWith(
      "repository.initializeStructure request failed. repositoryUuid: repo-1, error: Error: init failed",
    )
    expect(JSON.stringify([
      mocks.logger.info.mock.calls,
      mocks.logger.error.mock.calls,
    ])).not.toContain("secret-token")
  })

  it("keeps repository directory validation read-only", async () => {
    const { repositoryIpcModule } = await import("../ipc")
    mocks.repositoryStructureService.validateDirectoryStructure.mockResolvedValueOnce({
      isValid: false,
      initializationPreview: {
        isEmpty: false,
        nonGitEntries: ["notes.md"],
        operationToken: "preview-token",
        dangerFlags: [],
      },
      missingDirectories: ["rules"],
      message: "missing rules",
    })

    await repositoryIpcModule.methods.validateDirectory.handler(createContext() as never, {
      targetPath: "/repo",
    })

    expect(mocks.repositoryStructureService.ensureContentDirectories).not.toHaveBeenCalled()
    expect(mocks.repositoryStructureService.validateDirectoryStructure).toHaveBeenCalledWith("/repo")
  })

  it("refreshes and broadcasts changed install status after repository sync", async () => {
    const { repositoryIpcModule } = await import("../ipc")

    await repositoryIpcModule.methods.sync.handler(createContext() as never, {
      repositoryUuid: "repo-1",
    })

    expect(mocks.contentIndexService.syncIndex).toHaveBeenCalledWith(mocks.repository)
    expect(mocks.installStatusCacheService.buildCache).toHaveBeenCalledTimes(1)
    expect(mocks.eventBus.emit).toHaveBeenCalledWith(expect.objectContaining({
      domain: "install-status",
      type: "install-status.changed",
      payload: {
        contentId: "skill-1",
        entries: [{
          editorId: "codex",
          scope: "global",
          status: "needs_update",
        }],
      },
    }), { backpressure: "block" })
  })

  it("does not coalesce multiple install status changes after repository sync", async () => {
    const { repositoryIpcModule } = await import("../ipc")
    mocks.setNextInstallStatus({
      "skill-1": [{
        editorId: "codex",
        scope: "global",
        status: "needs_update",
      }],
      "skill-2": [{
        editorId: "cursor",
        scope: "global",
        status: "installed",
      }],
    })

    await repositoryIpcModule.methods.sync.handler(createContext() as never, {
      repositoryUuid: "repo-1",
    })

    const installStatusEmits = mocks.eventBus.emit.mock.calls.filter(([event]) =>
      event.type === "install-status.changed",
    )
    expect(installStatusEmits).toHaveLength(2)
    expect(installStatusEmits.every(([, options]) => options?.backpressure === "block")).toBe(true)
  })

  it("sanitizes Git errors in repository sync failure logs", async () => {
    const { repositoryIpcModule } = await import("../ipc")
    mocks.coordinator.requestSync.mockRejectedValueOnce(
      new Error("fatal: Authentication failed for 'https://token:ghp_secret123456@github.com/owner/repo.git' at /Users/me/.ssh/id_rsa"),
    )

    await expect(repositoryIpcModule.methods.sync.handler(createContext() as never, {
      repositoryUuid: "repo-1",
    })).rejects.toThrow("Authentication failed")

    const logged = JSON.stringify(mocks.logger.error.mock.calls)
    expect(logged).not.toContain("ghp_secret123456")
    expect(logged).not.toContain("/Users/me/.ssh/id_rsa")
    expect(logged).toContain("[redacted]")
    expect(logged).toContain("[path]")
  })

  it("sanitizes Git errors in repository maintenance failure logs", async () => {
    const { repositoryIpcModule } = await import("../ipc")
    mocks.coordinator.requestMaintenance.mockRejectedValueOnce(
      new Error("fatal: Authentication failed for 'https://token:ghp_secret123456@github.com/owner/repo.git' at /Users/me/.ssh/id_rsa"),
    )

    await expect(repositoryIpcModule.methods.runMaintenance.handler(createContext() as never, {
      repositoryUuid: "repo-1",
    })).rejects.toThrow("Authentication failed")

    const logged = JSON.stringify(mocks.logger.error.mock.calls)
    expect(logged).not.toContain("ghp_secret123456")
    expect(logged).not.toContain("/Users/me/.ssh/id_rsa")
    expect(logged).toContain("[redacted]")
    expect(logged).toContain("[path]")
  })

  it("sanitizes Git errors in pending push flush failure logs", async () => {
    const { repositoryIpcModule } = await import("../ipc")
    mocks.coordinator.requestPush.mockRejectedValueOnce(
      new Error("fatal: Authentication failed for 'https://token:ghp_secret123456@github.com/owner/repo.git' at /Users/me/.ssh/id_rsa"),
    )

    await expect(repositoryIpcModule.methods.flushPendingPushes.handler(createContext() as never, {
      repositoryUuid: "repo-1",
    })).rejects.toThrow("Authentication failed")

    const logged = JSON.stringify(mocks.logger.error.mock.calls)
    expect(logged).not.toContain("ghp_secret123456")
    expect(logged).not.toContain("/Users/me/.ssh/id_rsa")
    expect(logged).toContain("[redacted]")
    expect(logged).toContain("[path]")
  })
})
