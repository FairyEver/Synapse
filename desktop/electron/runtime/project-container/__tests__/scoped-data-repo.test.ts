import { describe, expect, it } from "vitest"

import type {
  BackupPayload,
  DataChangeEvent,
  DataChangeListener,
  DataNamespace,
  DataRepository,
  DataRepositoryInspectEntry,
  ExportOptions,
  ImportOptions,
} from "../../data-repo"
import { ProjectScopedDataRepoImpl } from "../scoped-data-repo"

type Item = Record<string, unknown> & { id: string }

describe("ProjectScopedDataRepoImpl (Phase 0.7)", () => {
  it("adds projectId on writes and filters list/get/remove for project-scoped namespaces", async () => {
    const repo = new MemoryRepo()
    const p1 = new ProjectScopedDataRepoImpl("p1", repo)
    const p2 = new ProjectScopedDataRepoImpl("p2", repo)

    await p1.namespace<Item>("conversations").upsert({ id: "c1", sessionKey: "s1" })
    await p2.namespace<Item>("conversations").upsert({ id: "c2", sessionKey: "s2" })

    await expect(p1.namespace<Item>("conversations").list()).resolves.toEqual([
      expect.objectContaining({ id: "c1", projectId: "p1" }),
    ])
    await expect(p1.namespace<Item>("conversations").get("c2")).resolves.toBeNull()

    await p1.namespace<Item>("conversations").remove("c2")
    await expect(p2.namespace<Item>("conversations").get("c2")).resolves.toEqual(
      expect.objectContaining({ id: "c2", projectId: "p2" }),
    )

    await p1.namespace<Item>("conversations").remove("c1")
    await expect(p1.namespace<Item>("conversations").list()).resolves.toEqual([])
    await expect(p2.namespace<Item>("conversations").list()).resolves.toHaveLength(1)
  })

  it("rejects writes that try to cross projectId", async () => {
    const repo = new MemoryRepo()
    const p1 = new ProjectScopedDataRepoImpl("p1", repo)

    await expect(
      p1.namespace<Item>("conversations").upsert({
        id: "conn-1",
        projectId: "p2",
      }),
    ).rejects.toThrow(/cannot write projectId "p2"/)
  })

  it("scopes knowledge-base ingest turns by project", async () => {
    const repo = new MemoryRepo()
    const p1 = new ProjectScopedDataRepoImpl("p1", repo)
    const p2 = new ProjectScopedDataRepoImpl("p2", repo)

    await p1.namespace<Item>("knowledge-base.ingest-turns").upsert({ id: "turn:p1-turn", turnId: "p1-turn" })
    await p2.namespace<Item>("knowledge-base.ingest-turns").upsert({ id: "turn:p2-turn", turnId: "p2-turn" })

    await expect(p1.namespace<Item>("knowledge-base.ingest-turns").list()).resolves.toEqual([
      expect.objectContaining({ id: "turn:p1-turn", projectId: "p1" }),
    ])
    await expect(p1.namespace<Item>("knowledge-base.ingest-turns").get("turn:p2-turn")).resolves.toBeNull()
  })

  it("passes global namespaces through unchanged", async () => {
    const repo = new MemoryRepo()
    const p1 = new ProjectScopedDataRepoImpl("p1", repo)
    const p2 = new ProjectScopedDataRepoImpl("p2", repo)

    await p1.namespace<Item>("projects").upsert({
      id: "project-record",
      projectId: "not-scoped",
    })

    await expect(p2.namespace<Item>("projects").get("project-record")).resolves.toEqual({
      id: "project-record",
      projectId: "not-scoped",
    })
  })

  it("only forwards change events for the scoped project", async () => {
    const repo = new MemoryRepo()
    const p1 = new ProjectScopedDataRepoImpl("p1", repo)
    const p2 = new ProjectScopedDataRepoImpl("p2", repo)
    const seen: string[] = []

    p1.namespace<Item>("outbox").onChange((event) => {
      if (event.id) seen.push(event.id)
    })

    await p2.namespace<Item>("outbox").upsert({ id: "p2-job" })
    await p1.namespace<Item>("outbox").upsert({ id: "p1-job" })

    expect(seen).toEqual(["p1-job"])
  })
})

class MemoryRepo implements DataRepository {
  private readonly namespaces = new Map<string, MemoryNamespace<Item>>()

  namespace<T>(name: string): DataNamespace<T> {
    let namespace = this.namespaces.get(name)
    if (!namespace) {
      namespace = new MemoryNamespace<Item>(name)
      this.namespaces.set(name, namespace)
    }
    return namespace as unknown as DataNamespace<T>
  }

  async exportAll(_options?: ExportOptions): Promise<BackupPayload> {
    return {
      format: "synapse-backup-v1",
      exportedAt: new Date().toISOString(),
      namespaces: [],
    }
  }

  async importAll(_payload: BackupPayload, _options?: ImportOptions): Promise<void> {}

  inspect(): readonly DataRepositoryInspectEntry[] {
    return []
  }
}

class MemoryNamespace<T extends Record<string, unknown> & { id: string }>
implements DataNamespace<T> {
  readonly schemaVersion = 1
  readonly backend = "json" as const
  readonly name: string
  private singleton: T | null = null
  private readonly items = new Map<string, T>()
  private readonly listeners = new Set<DataChangeListener<T>>()

  constructor(name: string) {
    this.name = name
  }

  async getSingleton(): Promise<T | null> {
    return this.singleton
  }

  async setSingleton(value: T): Promise<void> {
    const previous = this.singleton
    this.singleton = value
    this.emit({ kind: "replace", value, previous: previous ?? undefined })
  }

  async list(filter?: Partial<T>): Promise<T[]> {
    return [...this.items.values()].filter((item) => matchesFilter(item, filter))
  }

  async get(id: string): Promise<T | null> {
    return this.items.get(id) ?? null
  }

  async upsert(item: T & { id: string }): Promise<void> {
    const previous = this.items.get(item.id)
    this.items.set(item.id, item)
    this.emit({
      kind: "upsert",
      id: item.id,
      value: item,
      previous,
    })
  }

  async remove(id: string): Promise<void> {
    const previous = this.items.get(id)
    if (!previous) return
    this.items.delete(id)
    this.emit({ kind: "remove", id, previous })
  }

  onChange(listener: DataChangeListener<T>): () => void {
    this.listeners.add(listener)
    return () => {
      this.listeners.delete(listener)
    }
  }

  private emit(event: Omit<DataChangeEvent<T>, "namespace" | "timestamp">): void {
    const change = {
      ...event,
      namespace: this.name,
      timestamp: new Date().toISOString(),
    }
    for (const listener of this.listeners) {
      listener(change)
    }
  }
}

function matchesFilter<T extends Record<string, unknown>>(
  item: T,
  filter: Partial<T> | undefined,
): boolean {
  if (!filter) return true
  return Object.entries(filter).every(([key, value]) => item[key] === value)
}
