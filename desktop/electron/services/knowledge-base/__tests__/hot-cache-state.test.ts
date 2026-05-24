import { describe, expect, it } from "vitest"

import { KnowledgeBaseHotCacheStateStore } from "../hot-cache-state"

describe("KnowledgeBaseHotCacheStateStore", () => {
  it("requires injection when there is no prior state", async () => {
    const store = new KnowledgeBaseHotCacheStateStore()
    await expect(store.shouldInject({
      conversationId: "conv-1",
      hotHash: "hash-a",
      nowMs: 1_000,
      staleAfterMs: 4 * 60 * 60 * 1000,
    })).resolves.toBe(true)
  })

  it("does not require injection when hash is unchanged and state is fresh", async () => {
    const store = new KnowledgeBaseHotCacheStateStore()
    await store.markInjected({ conversationId: "conv-1", hotHash: "hash-a", injectedAtMs: 1_000 })
    await expect(store.shouldInject({
      conversationId: "conv-1",
      hotHash: "hash-a",
      nowMs: 2_000,
      staleAfterMs: 4 * 60 * 60 * 1000,
    })).resolves.toBe(false)
  })

  it("requires injection when hot cache changed", async () => {
    const store = new KnowledgeBaseHotCacheStateStore()
    await store.markInjected({ conversationId: "conv-1", hotHash: "hash-a", injectedAtMs: 1_000 })
    await expect(store.shouldInject({
      conversationId: "conv-1",
      hotHash: "hash-b",
      nowMs: 2_000,
      staleAfterMs: 4 * 60 * 60 * 1000,
    })).resolves.toBe(true)
  })

  it("requires injection when prior state is stale", async () => {
    const store = new KnowledgeBaseHotCacheStateStore()
    await store.markInjected({ conversationId: "conv-1", hotHash: "hash-a", injectedAtMs: 1_000 })
    await expect(store.shouldInject({
      conversationId: "conv-1",
      hotHash: "hash-a",
      nowMs: 1_000 + 5 * 60 * 60 * 1000,
      staleAfterMs: 4 * 60 * 60 * 1000,
    })).resolves.toBe(true)
  })
})
