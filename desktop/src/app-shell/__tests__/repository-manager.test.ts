import { describe, expect, it, vi } from "vitest"

const logger = vi.hoisted(() => ({
  error: vi.fn(),
  info: vi.fn(),
  warn: vi.fn(),
}))

vi.mock("@/app-shell/logging", () => ({
  createRendererLogger: () => logger,
}))

import { RepositoryManager } from "../repository-manager"
import { DEFAULT_AGENT_GLOBAL_CONFIG, DEFAULT_GLOBAL_CONFIG } from "@/constants/defaults"
import type { SynapseBridge } from "@/types/bridge"
import type { SynapseConfig, SynapseRepositoryConfig } from "@/types/config"
import type { SynapseContentMeta, SynapseContentType } from "@/types/content"
import type {
  SynapseRepositoryLocalState,
  SynapseRepositorySyncSnapshot,
  SynapseRepositorySyncSnapshotUpdatedEvent,
} from "@/types/repository"

const repository: SynapseRepositoryConfig = {
  uuid: "repo-1",
  name: "Main",
  localPath: "/repo",
  contentDirs: {},
}

const addedRepository: SynapseRepositoryConfig = {
  uuid: "repo-2",
  name: "Added",
  localPath: "/added",
  contentDirs: {},
}

const repositoryState: SynapseRepositoryLocalState = {
  repositoryUuid: repository.uuid,
  localPath: repository.localPath,
  status: "ready",
  isGitRepository: true,
  gitRootPath: repository.localPath,
}

const pendingSnapshot: SynapseRepositorySyncSnapshot = {
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
}

const addedPendingSnapshot: SynapseRepositorySyncSnapshot = {
  ...pendingSnapshot,
  repositoryUuid: addedRepository.uuid,
}

const config: SynapseConfig = {
  activeRepoUuid: repository.uuid,
  repositories: [repository],
  global: {
    ...DEFAULT_GLOBAL_CONFIG,
    themeMode: "system",
    projects: [],
    quickInputs: [],
    defaultQuickInputsSeededVersion: null,
    favorites: { rule: [], skill: [], prompt: [] },
    recentlyViewed: { rule: [], skill: [], prompt: [] },
    contentSortOrder: "modified-desc",
    variables: [],
  },
  agent: structuredClone(DEFAULT_AGENT_GLOBAL_CONFIG),
}

function createSkill(id: string): SynapseContentMeta<"skill"> {
  return {
    id,
    type: "skill",
    title: id,
    name: id,
    description: id,
    category: "development",
    icon: "Wrench",
    iconBg: "bg-muted",
    createdBy: "user",
    createdByDisplayName: "User",
    createdAt: "2026-04-27T00:00:00.000Z",
    modifiedBy: "user",
    modifiedByDisplayName: "User",
    modifiedAt: "2026-04-27T00:00:00.000Z",
    deleted: false,
    latestHistoryDirname: "20260427000000",
    attachmentCount: 0,
    source: "repository",
    isReadonly: false,
  }
}

function installBridge(bridge: SynapseBridge): void {
  Object.defineProperty(globalThis, "window", {
    value: { synapse: bridge },
    configurable: true,
  })
}

function createBridge(): SynapseBridge {
  let synced = false
  const contentChangedListeners: Array<(event: { contentType: SynapseContentType }) => void> = []

  const bridge = {
    platform: "darwin",
    versions: { chrome: "0", electron: "0", node: "0" },
    config: {
      get: vi.fn(async () => config),
      update: vi.fn(async () => config),
      exportBackup: vi.fn(async () => null),
      importBackup: vi.fn(async () => null),
      resetApp: vi.fn(async () => {}),
    },
    resourceRepository: {
      item: {
        list: vi.fn(async ({ contentType }: { contentType: SynapseContentType }) => {
        if (contentType !== "skill") {
          return []
        }

        const ids = synced
          ? ["skill-1", "skill-2", "skill-3", "skill-4"]
          : ["skill-1", "skill-2", "skill-3"]
        return ids.map(createSkill)
        }),
        onChanged: vi.fn((listener: (event: { contentType: SynapseContentType }) => void) => {
          contentChangedListeners.push(listener)
          return () => {}
        }),
      },
    },
    settings: {
      repository: {
        getStates: vi.fn(async () => [repositoryState]),
      getPendingPushes: vi.fn(async () => ({ count: 0, items: [] })),
      getSyncSnapshots: vi.fn(async () => []),
      onProgress: vi.fn(() => () => {}),
      onUpdated: vi.fn(() => () => {}),
      onPendingPushesUpdated: vi.fn(() => () => {}),
      onSyncSnapshotUpdated: vi.fn(() => () => {}),
        sync: vi.fn(async () => {
        synced = true
        return {
          operation: "sync",
          repository: repositoryState,
          completedAt: "2026-04-27T00:01:00.000Z",
        }
        }),
      },
    },
    emitContentChanged(contentType: SynapseContentType) {
      synced = true
      for (const listener of contentChangedListeners) {
        listener({ contentType, contentId: "skill-4", operation: "create" } as never)
      }
    },
  } as unknown as SynapseBridge

  return bridge
}

describe("RepositoryManager", () => {
  it("refreshes active content after repository sync", async () => {
    const bridge = createBridge()
    installBridge(bridge)
    const manager = new RepositoryManager()

    await manager.initialize()
    await manager.refreshContentList("skill")
    expect(manager.getContentList("skill")).toHaveLength(3)

    await manager.syncRepository(repository.uuid)

    expect(manager.getContentList("skill")).toHaveLength(4)
  })

  it("refreshes the matching content list after a content changed event", async () => {
    const bridge = createBridge() as SynapseBridge & {
      emitContentChanged(contentType: SynapseContentType): void
    }
    installBridge(bridge)
    const manager = new RepositoryManager()

    await manager.initialize()
    await manager.refreshContentList("skill")
    expect(manager.getContentList("skill")).toHaveLength(3)

    bridge.emitContentChanged("skill")

    await vi.waitFor(() => {
      expect(manager.getContentList("skill")).toHaveLength(4)
    })
  })

  it("ignores stale content refresh results after the active repository changes", async () => {
    let currentConfig: SynapseConfig = {
      ...config,
      repositories: [repository, addedRepository],
    }
    const skillListResolvers: Array<(items: SynapseContentMeta<"skill">[]) => void> = []
    const bridge = createBridge()
    bridge.config.get = vi.fn(async () => currentConfig)
    bridge.config.update = vi.fn(async (patch) => {
      currentConfig = { ...currentConfig, ...patch }
      return currentConfig
    })
    bridge.resourceRepository.item.list = vi.fn(({ contentType }: { contentType: SynapseContentType }) => {
      if (contentType !== "skill") return Promise.resolve([])
      return new Promise<SynapseContentMeta<"skill">[]>((resolve) => {
        skillListResolvers.push(resolve)
      })
    }) as typeof bridge.resourceRepository.item.list
    installBridge(bridge)
    const manager = new RepositoryManager()

    await manager.initialize()
    const staleRefresh = manager.refreshContentList("skill")
    await manager.updateConfig({ activeRepoUuid: addedRepository.uuid })
    const currentRefresh = manager.refreshContentList("skill")

    skillListResolvers[1]([createSkill("repo-2-skill")])
    await currentRefresh
    expect(manager.getContentList("skill").map((item) => item.id)).toEqual(["repo-2-skill"])

    skillListResolvers[0]([createSkill("repo-1-skill")])
    await staleRefresh
    expect(manager.getContentList("skill").map((item) => item.id)).toEqual(["repo-2-skill"])
  })

  it("continues active repository switching when pending push refresh fails", async () => {
    let currentConfig: SynapseConfig = {
      ...config,
      repositories: [repository, addedRepository],
    }
    const bridge = createBridge()
    bridge.config.get = vi.fn(async () => currentConfig)
    bridge.config.update = vi.fn(async (patch) => {
      currentConfig = { ...currentConfig, ...patch }
      return currentConfig
    })
    installBridge(bridge)
    const manager = new RepositoryManager()

    await manager.initialize()
    await manager.refreshContentList("skill")
    expect(manager.getContentList("skill")).toHaveLength(3)

    bridge.settings.repository.getPendingPushes = vi.fn(async () => {
      throw new Error("pending push database unavailable")
    })
    bridge.resourceRepository.item.list = vi.fn(({ contentType }: { contentType: SynapseContentType }) => {
      if (contentType !== "skill") return Promise.resolve([])
      return Promise.resolve([createSkill("repo-2-skill")])
    }) as typeof bridge.resourceRepository.item.list

    await expect(manager.switchActiveRepository(addedRepository.uuid)).resolves.toBeUndefined()

    expect(manager.getActiveRepositoryUuid()).toBe(addedRepository.uuid)
    expect(manager.getContentList("skill").map((item) => item.id)).toEqual(["repo-2-skill"])
  })

  it("logs subscriber failures without stopping repository notifications", async () => {
    logger.warn.mockClear()
    const bridge = createBridge()
    installBridge(bridge)
    const manager = new RepositoryManager()
    await manager.initialize()

    manager.subscribeToRepositoryChanges(() => {
      throw new Error("repository subscriber failed")
    })
    manager.subscribeToContentChanges("skill", () => {
      throw new Error("content subscriber failed")
    })
    manager.subscribeToOperationChanges(repository.uuid, () => {
      throw new Error("operation subscriber failed")
    })

    await manager.updateConfig({ activeRepoUuid: repository.uuid })
    await manager.refreshContentList("skill")
    await manager.syncRepository(repository.uuid)

    expect(logger.warn).toHaveBeenCalledWith("repository.subscriber-failed", {
      error: "Error: repository subscriber failed",
    })
    expect(logger.warn).toHaveBeenCalledWith("repository.content-subscriber-failed", {
      contentType: "skill",
      error: "Error: content subscriber failed",
    })
    expect(logger.warn).toHaveBeenCalledWith("repository.operation-subscriber-failed", {
      error: "Error: operation subscriber failed",
      uuid: repository.uuid,
    })
  })

  it("stores sync snapshot updates and mirrors pending pushes", async () => {
    const snapshotListeners: Array<(event: SynapseRepositorySyncSnapshotUpdatedEvent) => void> = []
    const bridge = createBridge()
    bridge.settings.repository.onSyncSnapshotUpdated = vi.fn((listener) => {
      snapshotListeners.push(listener)
      return () => {}
    })
    installBridge(bridge)
    const manager = new RepositoryManager()
    await manager.initialize()

    expect(snapshotListeners).toHaveLength(1)
    snapshotListeners[0]({
      repositoryUuid: repository.uuid,
      snapshot: pendingSnapshot,
    })

    expect(manager.getSyncSnapshot(repository.uuid)?.status).toBe("pending")
    expect(manager.getPendingPushes(repository.uuid)).toEqual({ count: 1, items: [] })
  })

  it("hydrates sync snapshots and mirrors pending pushes during initialize", async () => {
    const bridge = createBridge()
    bridge.settings.repository.getSyncSnapshots = vi.fn(async () => [pendingSnapshot])
    installBridge(bridge)
    const manager = new RepositoryManager()

    await manager.initialize()

    expect(manager.getSyncSnapshot(repository.uuid)?.status).toBe("pending")
    expect(manager.getPendingPushes(repository.uuid)).toEqual({ count: 1, items: [] })
  })

  it("keeps initialization alive when sync snapshot refresh fails", async () => {
    const bridge = createBridge()
    bridge.settings.repository.getSyncSnapshots = vi.fn(async () => {
      throw new Error("snapshot refresh failed")
    })
    installBridge(bridge)
    const manager = new RepositoryManager()

    await expect(manager.initialize()).resolves.toBeUndefined()

    expect(manager.getConfig()).toEqual(config)
    expect(manager.isReady()).toBe(true)
  })

  it("refreshes sync snapshots after replacing repositories", async () => {
    let snapshots: SynapseRepositorySyncSnapshot[] = []
    const bridge = createBridge()
    bridge.settings.repository.getSyncSnapshots = vi.fn(async () => snapshots)
    installBridge(bridge)
    const manager = new RepositoryManager()
    await manager.initialize()

    snapshots = [addedPendingSnapshot]
    await manager.replaceRepositories([repository, addedRepository], repository.uuid)

    expect(manager.getSyncSnapshot(addedRepository.uuid)?.status).toBe("pending")
    expect(manager.getPendingPushes(addedRepository.uuid)).toEqual({ count: 1, items: [] })
  })
})
