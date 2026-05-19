import { beforeEach, describe, expect, it, vi } from "vitest"

import type {
  ConversationEntryV1,
  ConnectorEntryV1,
  DataNamespace,
  DataRepository,
  SecretEntryV1,
} from "../../runtime/data-repo"
import { createNoopLogger } from "../../runtime/lib/test-helpers"

describe("migrateRepositoryScopedConnectorData", () => {
  beforeEach(() => {
    vi.resetModules()
  })

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
      await migrateRepositoryScopedConnectorData(dataRepository, createProjectConfig({
        projectPath: "c:\\users\\LIYANG\\Desktop\\",
        repositoryPath: "C:\\Users\\liyang\\Desktop",
      }), createNoopLogger())
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

  it("does not create a migrated Feishu connector when secret copy fails", async () => {
    const dataRepository = new MemoryDataRepository()
    const connectors = dataRepository.namespace<ConnectorEntryV1>("connectors")
    const secrets = dataRepository.namespace<SecretEntryV1>("secrets")
    await connectors.upsert(createFeishuConnector({
      id: "feishu:repo-1",
      projectId: "repo-1",
      secretRef: "feishu:repo-1:credentials",
    }))
    await secrets.upsert({
      id: "feishu:repo-1:credentials",
      schemaVersion: 1,
      kind: "generic",
      value: "{\"appId\":\"cli_x\",\"appSecret\":\"secret\"}",
    })
    const secretNamespace = secrets as MemoryNamespace<SecretEntryV1>
    secretNamespace.failGetsWith(new Error("secret backend unavailable"))

    await migrateRepositoryScopedConnectorData(dataRepository, createProjectConfig(), createNoopLogger())

    await expect(connectors.get("feishu:project-1")).resolves.toBeNull()
    await expect(connectors.get("feishu:repo-1")).resolves.toEqual(expect.objectContaining({
      projectId: "repo-1",
      secretRef: "feishu:repo-1:credentials",
    }))
  })
})

async function migrateRepositoryScopedConnectorData(
  ...args: Parameters<typeof import("../project-scope-migration").migrateRepositoryScopedConnectorData>
): ReturnType<typeof import("../project-scope-migration").migrateRepositoryScopedConnectorData> {
  const migration = await import("../project-scope-migration")

  return migration.migrateRepositoryScopedConnectorData(...args)
}

function createProjectConfig(input: {
  projectPath?: string
  repositoryPath?: string
} = {}) {
  return {
    activeRepoUuid: "repo-1",
    repositories: [{
      uuid: "repo-1",
      name: "Desktop",
      localPath: input.repositoryPath ?? "/Users/liyang/Desktop",
      contentDirs: {},
    }],
    global: {
      themeMode: "system" as const,
      projects: [{
        id: "project-1",
        name: "Desktop",
        path: input.projectPath ?? "/Users/liyang/Desktop",
      }],
      favorites: { rule: [], skill: [], prompt: [] },
      recentlyViewed: { rule: [], skill: [], prompt: [] },
      contentSortOrder: "modified-desc" as const,
    },
    agent: {
      defaultPermissionMode: "default" as const,
      defaultProviderModel: null,
    },
  }
}

function createFeishuConnector(input: {
  id: string
  projectId: string
  secretRef?: string
}): ConnectorEntryV1 {
  return {
    id: input.id,
    schemaVersion: 1,
    projectId: input.projectId,
    platform: "feishu",
    secretRef: input.secretRef,
    status: "disabled",
    allowlist: { mode: "all" },
    sessionKeyPolicy: { mode: "thread" },
  }
}

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
  private getFailure: Error | null = null

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
    if (this.getFailure) {
      throw this.getFailure
    }
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

  failGetsWith(error: Error): void {
    this.getFailure = error
  }
}
