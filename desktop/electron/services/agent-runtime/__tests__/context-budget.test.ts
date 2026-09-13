import { describe, expect, it } from "vitest"

import { AgentContextBudget } from "../context-budget"

describe("AgentContextBudget", () => {
  it("does not rotate merely because a long task exceeds 96 KiB of cumulative output", () => {
    const budget = new AgentContextBudget({ maxToolResultBytes: 8192, maxToolBatchBytes: 24576 })
    for (let batch = 0; batch < 20; batch += 1) {
      expect(budget.availableToolOutputBytes()).toBe(8192)
      budget.recordToolOutput(8192)
      budget.finishToolBatch()
    }
    expect(budget.snapshot().turnToolOutputBytes).toBe(163840)
  })

  it("releases a measured retained tail after compact without retaining an obsolete high-water mark", () => {
    const budget = new AgentContextBudget({ maxToolResultBytes: 8192 })
    budget.recordToolOutput(100000)
    budget.completeCompaction(10000, 1000, 2000)
    expect(budget.snapshot().retainedToolOutputBytes).toBe(8000)
  })
  it("does not release measured payload bytes when compact omits its retained-tail breakdown", () => {
    const budget = new AgentContextBudget({ maxToolResultBytes: 8192 })
    budget.recordToolOutput(6000)
    budget.completeCompaction(1000, 100)
    expect(budget.snapshot().retainedToolOutputBytes).toBe(6000)
    expect(budget.snapshot().retainedRequestBytes).toBe(6100)
  })

  it("keeps the SDK compact trigger separate from the actual input limit", () => {
    const budget = new AgentContextBudget({ maxToolResultBytes: 8192, maxContextTokens: 200_000 })
    budget.updateRequestTokenLimit(200_000)
    budget.observeContextTokens(199_192)
    expect(budget.availableToolOutputBytes()).toBe(808)
    budget.recordToolOutput(800)
    expect(budget.availableToolOutputBytes()).toBe(8)
    budget.completeCompaction(80_000, 1000, 20_000)
    expect(budget.snapshot().retainedToolOutputBytes).toBe(80_000)
    expect(budget.availableToolOutputBytes()).toBe(8192)
    budget.completeCompaction(40_000, 1000, 0)
    expect(budget.snapshot().turnToolOutputBytes).toBe(800)
  })

  it("enforces per-result and per-batch budgets across a long turn", () => {
    const budget = new AgentContextBudget({
      maxToolResultBytes: 8,
      maxToolBatchBytes: 16,
    })

    budget.beginTurn(0)
    expect(budget.availableToolOutputBytes()).toBe(8)
    budget.recordToolOutput(8)
    expect(budget.availableToolOutputBytes()).toBe(8)
    budget.recordToolOutput(8)
    expect(budget.availableToolOutputBytes()).toBe(0)

    budget.finishToolBatch()
    expect(budget.availableToolOutputBytes()).toBe(8)
    budget.recordToolOutput(8)
    expect(budget.availableToolOutputBytes()).toBe(8)
  })

  it("uses the SDK context snapshot plus pending UTF-8 bytes for token and request budgets", () => {
    const budget = new AgentContextBudget({
      maxToolResultBytes: 8_192,
      maxToolBatchBytes: 24_576,
      maxContextTokens: 200_000,
      maxRequestBodyBytes: 6 * 1024 * 1024,
      requestBodyBudgetBytes: 5 * 1024 * 1024,
    })

    budget.observeContextTokens(199_000)
    budget.recordModelVisibleBytes(200)

    expect(budget.availableToolOutputBytes()).toBe(800)
    expect(budget.snapshot()).toEqual(expect.objectContaining({
      observedContextTokens: 199_000,
      estimatedRequestTokens: 199_200,
      estimatedRequestBytes: 796_200,
      retainedRequestBytes: 200,
      maxRequestBodyBytes: 6 * 1024 * 1024,
      requestBodyBudgetBytes: 5 * 1024 * 1024,
    }))
    expect(budget.availableModelVisibleBytes()).toBe(800)
  })

  it("keeps measured request bytes across SDK token snapshots and resets them only after compaction", () => {
    const budget = new AgentContextBudget({
      maxToolResultBytes: 1_024,
      initialRequestBytes: 100,
    })

    budget.beginTurn(400)
    budget.recordToolOutput(300)
    expect(budget.snapshot().pendingModelVisibleBytes).toBe(800)

    budget.observeContextTokens(12_000)
    expect(budget.snapshot().pendingModelVisibleBytes).toBe(0)
    expect(budget.snapshot().retainedRequestBytes).toBe(800)

    budget.recordToolOutput(200)
    expect(budget.completeCompaction(3_000, 250, 0)).toEqual(expect.objectContaining({
      observedContextTokens: 3_000,
      pendingModelVisibleBytes: 0,
      retainedRequestBytes: 350,
      turnToolOutputBytes: 500,
    }))
  })

  it("uses measured retained bytes when token conversion would underestimate the request", () => {
    const budget = new AgentContextBudget({
      maxToolResultBytes: 8_192,
      requestBodyBudgetBytes: 10_000,
      initialRequestBytes: 8_000,
    })

    budget.observeContextTokens(100)

    expect(budget.snapshot().estimatedRequestBytes).toBe(8_000)
    expect(budget.availableToolOutputBytes()).toBe(2_000)
  })

  it("releases the proportional tracked byte budget after SDK-native tool-result eviction", () => {
    const budget = new AgentContextBudget({
      maxToolResultBytes: 1_000,
      initialRequestBytes: 100,
    })
    budget.recordToolOutput(900)

    expect(budget.applyNativeToolResultEviction(300, 100)).toBe(600)
    expect(budget.snapshot()).toEqual(expect.objectContaining({
      retainedRequestBytes: 400,
      retainedToolOutputBytes: 300,
    }))

    expect(budget.applyNativeToolResultEviction(100, 0)).toBe(300)
    expect(budget.snapshot()).toEqual(expect.objectContaining({
      retainedRequestBytes: 100,
      retainedToolOutputBytes: 0,
    }))
  })
})
