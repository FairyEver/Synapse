import { describe, expect, it, vi } from "vitest"

import { RepositoryManager } from "../repository-manager"
import type { SynapseBridge } from "@/types/bridge"
import type { SynapseConfig, SynapseRepositoryConfig } from "@/types/config"
import type { SynapseContentMeta, SynapseContentType } from "@/types/content"
import type {
  SynapseRepositoryLocalState,
  SynapseRepositorySyncSnapshotUpdatedEvent,
} from "@/types/repository"

const repository: SynapseRepositoryConfig = {
  uuid: "repo-1",
  name: "Main",
  localPath: "/repo",
  contentDirs: {},
}

const repositoryState: SynapseRepositoryLocalState = {
  repositoryUuid: repository.uuid,
  localPath: repository.localPath,
  status: "ready",
  isGitRepository: true,
  gitRootPath: repository.localPath,
}

const config: SynapseConfig = {
  activeRepoUuid: repository.uuid,
  repositories: [repository],
  global: {
    themeMode: "system",
    projects: [],
    favorites: { rule: [], skill: [], prompt: [] },
    recentlyViewed: { rule: [], skill: [], prompt: [] },
    contentSortOrder: "modified-desc",
  },
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
    content: {
      list: vi.fn(async ({ contentType }: { contentType: SynapseContentType }) => {
        if (contentType !== "skill") {
          return []
        }

        const ids = synced
          ? ["skill-1", "skill-2", "skill-3", "skill-4"]
          : ["skill-1", "skill-2", "skill-3"]
        return ids.map(createSkill)
      }),
    },
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

  it("stores sync snapshot updates and mirrors pending pushes", async () => {
    const snapshotListeners: Array<(event: SynapseRepositorySyncSnapshotUpdatedEvent) => void> = []
    const bridge = createBridge()
    bridge.repository.onSyncSnapshotUpdated = vi.fn((listener) => {
      snapshotListeners.push(listener)
      return () => {}
    })
    installBridge(bridge)
    const manager = new RepositoryManager()
    await manager.initialize()

    expect(snapshotListeners).toHaveLength(1)
    snapshotListeners[0]({
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
    expect(manager.getPendingPushes(repository.uuid)).toEqual({ count: 1, items: [] })
  })
})
