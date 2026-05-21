import { beforeEach, describe, expect, it, vi } from "vitest"

const mocks = vi.hoisted(() => {
  let installStatus = {
    "skill-1": [{
      editorId: "codex",
      scope: "global",
      status: "installed",
    }],
  }

  return {
    coordinator: {
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
    installStatusCacheService: {
      buildCache: vi.fn(async () => {
        installStatus = {
          "skill-1": [{
            editorId: "codex",
            scope: "global",
            status: "needs_update",
          }],
        }
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
    resetInstallStatus: () => {
      installStatus = {
        "skill-1": [{
          editorId: "codex",
          scope: "global",
          status: "installed",
        }],
      }
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
  repositoryStructureService: {
    checkInitializationPreview: vi.fn(),
    createLocalRepository: vi.fn(),
    ensureContentDirectories: vi.fn(),
    initializeStructure: vi.fn(),
    validateDirectoryStructure: vi.fn(),
  },
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
    mocks.contentSubmissionService.readPendingPushState.mockResolvedValue({ count: 0, items: [] })
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
    }))
  })
})
