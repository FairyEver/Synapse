import { describe, expect, it } from "vitest"

import type { DataNamespace } from "../../../runtime/data-repo"
import {
  KnowledgeBaseIngestTurnStore,
  type KnowledgeBaseIngestTurnStoreEntry,
} from "../ingest-turn-store"

describe("KnowledgeBaseIngestTurnStore", () => {
  it("stores and consumes turn state once", async () => {
    const store = new KnowledgeBaseIngestTurnStore()
    await store.set("turn-1", {
      projectPath: "/tmp/kb",
      generatedAt: "2026-05-24T00:00:00.000Z",
      force: false,
      changedSources: [{ relativePath: ".raw/a.md", hash: "hash-a", state: "new" }],
      skippedSources: [],
      wikiBefore: { files: {} },
    })

    const record = await store.consume("turn-1")

    expect(record?.kind).toBe("preflight")
    if (record?.kind !== "preflight") {
      throw new Error("Expected ingest turn preflight state.")
    }
    expect(record.state.changedSources).toHaveLength(1)
    expect(await store.consume("turn-1")).toBeNull()
  })

  it("persists turn state across store instances", async () => {
    const namespace = new MemoryNamespace<KnowledgeBaseIngestTurnStoreEntry>("knowledge-base.ingest-turns")
    const first = new KnowledgeBaseIngestTurnStore({ namespace })
    await first.set("turn-1", {
      projectPath: "/tmp/kb",
      generatedAt: "2026-05-24T00:00:00.000Z",
      force: false,
      changedSources: [{ relativePath: ".raw/a.md", hash: "hash-a", state: "new" }],
      skippedSources: [],
      wikiBefore: { files: {} },
    })

    const second = new KnowledgeBaseIngestTurnStore({ namespace })
    const record = await second.consume("turn-1")

    expect(record?.kind).toBe("preflight")
    expect(await second.consume("turn-1")).toBeNull()
  })

  it("persists pending recoveries across store instances", async () => {
    const namespace = new MemoryNamespace<KnowledgeBaseIngestTurnStoreEntry>("knowledge-base.ingest-turns")
    const first = new KnowledgeBaseIngestTurnStore({ namespace })
    await first.setPendingRecovery({
      projectPath: "/tmp/kb",
      conversationId: "conv-1",
      turnId: "turn-1",
      failedAt: "2026-05-24T00:01:00.000Z",
      warningCodes: ["report-missing"],
      assistantText: "done",
      preflight: {
        projectPath: "/tmp/kb",
        generatedAt: "2026-05-24T00:00:00.000Z",
        force: false,
        changedSources: [{ relativePath: ".raw/a.md", hash: "hash-a", state: "new" }],
        skippedSources: [],
        wikiBefore: { files: {} },
      },
    })

    const second = new KnowledgeBaseIngestTurnStore({ namespace })

    expect(await second.getPendingRecovery("turn-1")).toMatchObject({
      turnId: "turn-1",
      warningCodes: ["report-missing"],
    })
  })
})

class MemoryNamespace<T extends { id: string }> implements DataNamespace<T> {
  readonly schemaVersion = 1
  readonly backend = "json" as const
  private singleton: T | null = null
  private readonly items = new Map<string, T>()

  constructor(readonly name: string) {}

  async getSingleton(): Promise<T | null> {
    return this.singleton
  }

  async setSingleton(value: T): Promise<void> {
    this.singleton = value
  }

  async list(): Promise<T[]> {
    return [...this.items.values()]
  }

  async get(id: string): Promise<T | null> {
    return this.items.get(id) ?? null
  }

  async upsert(item: T & { id: string }): Promise<void> {
    this.items.set(item.id, item)
  }

  async remove(id: string): Promise<void> {
    this.items.delete(id)
  }

  onChange(): () => void {
    return () => undefined
  }
}
