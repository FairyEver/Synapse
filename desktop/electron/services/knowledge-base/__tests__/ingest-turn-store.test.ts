import { describe, expect, it } from "vitest"

import { KnowledgeBaseIngestTurnStore } from "../ingest-turn-store"

describe("KnowledgeBaseIngestTurnStore", () => {
  it("stores and consumes turn state once", () => {
    const store = new KnowledgeBaseIngestTurnStore()
    store.set("turn-1", {
      projectPath: "/tmp/kb",
      generatedAt: "2026-05-24T00:00:00.000Z",
      force: false,
      changedSources: [{ relativePath: ".raw/a.md", hash: "hash-a", state: "new" }],
      skippedSources: [],
      wikiBefore: { files: {} },
    })

    expect(store.consume("turn-1")?.changedSources).toHaveLength(1)
    expect(store.consume("turn-1")).toBeNull()
  })
})
