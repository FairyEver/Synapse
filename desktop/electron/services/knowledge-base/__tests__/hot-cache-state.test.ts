import { describe, expect, it } from "vitest"

import { KnowledgeBaseHotCacheStateStore } from "../hot-cache-state"

describe("KnowledgeBaseHotCacheStateStore", () => {
  it("requires injection when there is no prior state", () => {
    const store = new KnowledgeBaseHotCacheStateStore()
    expect(store.shouldInject({
      conversationId: "conv-1",
      hotHash: "hash-a",
      nowMs: 1_000,
      staleAfterMs: 4 * 60 * 60 * 1000,
    })).toBe(true)
  })

  it("does not require injection when hash is unchanged and state is fresh", () => {
    const store = new KnowledgeBaseHotCacheStateStore()
    store.markInjected({ conversationId: "conv-1", hotHash: "hash-a", injectedAtMs: 1_000 })
    expect(store.shouldInject({
      conversationId: "conv-1",
      hotHash: "hash-a",
      nowMs: 2_000,
      staleAfterMs: 4 * 60 * 60 * 1000,
    })).toBe(false)
  })

  it("requires injection when hot cache changed", () => {
    const store = new KnowledgeBaseHotCacheStateStore()
    store.markInjected({ conversationId: "conv-1", hotHash: "hash-a", injectedAtMs: 1_000 })
    expect(store.shouldInject({
      conversationId: "conv-1",
      hotHash: "hash-b",
      nowMs: 2_000,
      staleAfterMs: 4 * 60 * 60 * 1000,
    })).toBe(true)
  })

  it("requires injection when prior state is stale", () => {
    const store = new KnowledgeBaseHotCacheStateStore()
    store.markInjected({ conversationId: "conv-1", hotHash: "hash-a", injectedAtMs: 1_000 })
    expect(store.shouldInject({
      conversationId: "conv-1",
      hotHash: "hash-a",
      nowMs: 1_000 + 5 * 60 * 60 * 1000,
      staleAfterMs: 4 * 60 * 60 * 1000,
    })).toBe(true)
    expect(store.size).toBe(0)
  })

  it("evicts oldest states after reaching capacity", () => {
    const store = new KnowledgeBaseHotCacheStateStore({ maxStates: 2 })

    store.markInjected({ conversationId: "conv-1", hotHash: "hash-a", injectedAtMs: 1_000 })
    store.markInjected({ conversationId: "conv-2", hotHash: "hash-a", injectedAtMs: 2_000 })
    store.markInjected({ conversationId: "conv-3", hotHash: "hash-a", injectedAtMs: 3_000 })

    expect(store.size).toBe(2)
    expect(store.shouldInject({
      conversationId: "conv-1",
      hotHash: "hash-a",
      nowMs: 4_000,
      staleAfterMs: 24 * 60 * 60 * 1000,
    })).toBe(true)
    expect(store.shouldInject({
      conversationId: "conv-2",
      hotHash: "hash-a",
      nowMs: 4_000,
      staleAfterMs: 24 * 60 * 60 * 1000,
    })).toBe(false)
  })

  it("clears stale states while checking injection", () => {
    const store = new KnowledgeBaseHotCacheStateStore({ maxStates: 4 })

    store.markInjected({ conversationId: "old", hotHash: "hash-a", injectedAtMs: 1_000 })
    store.markInjected({ conversationId: "fresh", hotHash: "hash-a", injectedAtMs: 10_000 })

    expect(store.shouldInject({
      conversationId: "fresh",
      hotHash: "hash-a",
      nowMs: 11_000,
      staleAfterMs: 5_000,
    })).toBe(false)
    expect(store.size).toBe(1)
  })
})
