import { DatabaseSync } from "node:sqlite"
import { describe, expect, it, vi } from "vitest"
import { SqliteNamespace } from "../../electron/runtime/data-repo/backends/sqlite"
import type { ConversationEntryV1 } from "../../electron/runtime/data-repo"
import { AgentSessionRepository } from "../../electron/services/agent-runtime/session-repository"

/** Synthetic capacity baseline. Passing correctness assertions is NOT a bounded-storage acceptance. */
describe("Agent long-running storage baseline", () => {
  it.each([1_000, 10_000, 100_000])("measures one append with %i records in an isolated database", async (historyCount) => {
    const database = new DatabaseSync(":memory:")
    try {
      const namespace = new SqliteNamespace<ConversationEntryV1>({
        name: "conversations", schemaVersion: 1, backend: "sqlite", database,
      })
      const repository = new AgentSessionRepository({ projectId: "synthetic", conversations: namespace })
      const session = await repository.createSession({ id: "synthetic", sessionKey: "synthetic" })
      await namespace.upsert({ ...session, history: Array.from({ length: historyCount }, (_, index) => ({
        role: index === 0 ? "user" as const : "assistant" as const,
        content: "x".repeat(64), timestamp: "2026-09-13T00:00:00.000Z",
      })) })
      const metrics = { historyCount, readCalls: 0, materializedRecords: 0, readJsonBytes: 0, writtenJsonBytes: 0 }
      const get = namespace.get.bind(namespace)
      const upsert = namespace.upsert.bind(namespace)
      vi.spyOn(namespace, "get").mockImplementation(async (id) => {
        const value = await get(id)
        metrics.readCalls += 1
        metrics.materializedRecords += value?.history.length ?? 0
        metrics.readJsonBytes += value ? Buffer.byteLength(JSON.stringify(value)) : 0
        return value
      })
      vi.spyOn(namespace, "upsert").mockImplementation(async (value) => {
        metrics.writtenJsonBytes += Buffer.byteLength(JSON.stringify(value))
        return upsert(value)
      })
      const result = await repository.appendHistory(session.id, "assistant", "tail")
      expect(result.history).toHaveLength(historyCount + 1)
      expect(result.history.at(-1)?.content).toBe("tail")
      // Counters intentionally report the remaining O(H) path instead of
      // blessing it with a performance threshold or a flaky time assertion.
      console.info("AGENT_STORAGE_BASELINE", JSON.stringify(metrics))
    } finally {
      database.close()
    }
  })
})
