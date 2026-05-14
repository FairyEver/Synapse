import { describe, expect, it } from "vitest"

import type {
  ConversationEntryV1,
  DataNamespace,
  DataRepository,
} from "../../runtime/data-repo"
import { createNoopLogger } from "../../runtime/lib/test-helpers"
import { migrateRepositoryScopedConnectorData } from "../project-scope-migration"

describe("migrateRepositoryScopedConnectorData", () => {
  it("moves repository-scoped agent conversations to the matching configured project id on Windows case-only path differences", async () => {
    const platformDescriptor = Object.getOwnPropertyDescriptor(process, "platform")
    Object.defineProperty(process, "platform", {
      configurable: true,
      value: "win32",
    })
    const dataRepository = new MemoryDataRepository()
    const conversations = dataRepository.namespace<ConversationEntryV1>("conversations")
    await conversations.upsert({
      id: "conv-1",
      schemaVersion: 1,
      projectId: "repo-1",
      sessionKey: "local:renderer",
      platform: "local-renderer",
      history: [],
      active: true,
      createdAt: "2026-04-27T00:00:00.000Z",
      updatedAt: "2026-04-27T00:00:00.000Z",
    })

    try {
      await migrateRepositoryScopedConnectorData(dataRepository, {
        activeRepoUuid: "repo-1",
        repositories: [{
          uuid: "repo-1",
          name: "Desktop",
          localPath: "C:\\Users\\liyang\\Desktop",
          contentDirs: {},
        }],
        global: {
          themeMode: "system",
          projects: [{
            id: "project-1",
            name: "Desktop",
            path: "c:\\users\\LIYANG\\Desktop\\",
          }],
          favorites: { rule: [], skill: [], prompt: [] },
          recentlyViewed: { rule: [], skill: [], prompt: [] },
          contentSortOrder: "modified-desc",
        },
        agent: {
          defaultPermissionMode: "default",
        },
      }, createNoopLogger())
    } finally {
      if (platformDescriptor) {
        Object.defineProperty(process, "platform", platformDescriptor)
      }
    }

    await expect(conversations.get("conv-1")).resolves.toEqual(expect.objectContaining({
      projectId: "project-1",
      sessionKey: "local:renderer",
    }))
  })
})

class MemoryDataRepository implements DataRepository {
  private readonly namespaces = new Map<string, MemoryNamespace<Record<string, unknown> & { id: string }>>()

  namespace<T>(name: string): DataNamespace<T> {
    let namespace = this.namespaces.get(name)
    if (!namespace) {
      namespace = new MemoryNamespace(name)
      this.namespaces.set(name, namespace)
    }
    return namespace as unknown as DataNamespace<T>
  }

  async exportAll() {
    return { format: "synapse-backup-v1" as const, exportedAt: "", namespaces: [] }
  }

  async importAll(): Promise<void> {}

  inspect() {
    return []
  }
}

class MemoryNamespace<T extends { id: string }> implements DataNamespace<T> {
  readonly schemaVersion = 1
  readonly backend = "json" as const
  private readonly items = new Map<string, T>()

  constructor(readonly name: string) {}

  async getSingleton(): Promise<T | null> {
    return null
  }

  async setSingleton(_value: T): Promise<void> {}

  async list(filter?: Partial<T>): Promise<T[]> {
    const values = [...this.items.values()]
    if (!filter) return values
    return values.filter((item) =>
      Object.entries(filter).every(([key, value]) => item[key as keyof T] === value),
    )
  }

  async get(id: string): Promise<T | null> {
    return this.items.get(id) ?? null
  }

  async upsert(item: T): Promise<void> {
    this.items.set(item.id, item)
  }

  async remove(id: string): Promise<void> {
    this.items.delete(id)
  }

  onChange(): () => void {
    return () => {}
  }
}
