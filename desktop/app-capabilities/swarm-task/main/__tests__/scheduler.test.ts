import { describe, expect, it, vi } from "vitest"
import { createSwarmScheduler, type SwarmWorkerRunner } from "../scheduler"
import type { SwarmTaskConfig } from "../../shared/schema"

const config: SwarmTaskConfig = {
  projectId: "project-1",
  prompt: "Run.",
  presetId: "general",
  promptInjection: {
    sequenceBatch: { enabled: false },
    previousHandoff: { enabled: false },
    summary: { enabled: false, injectRecent: false, recentLimit: 3 },
    fileWrite: {
      enabled: false,
      path: "",
      mode: "append-only",
      lock: { enabled: true },
    },
    customAppendix: "",
  },
  runMode: "batch",
  concurrency: 3,
  maxRounds: 3,
  agent: {},
}

describe("createSwarmScheduler", () => {
  it("runs fixed batch workers in full concurrency-sized batches", async () => {
    const calls: Array<{
      workerIndex: number
      roundIndex: number
      sequenceIndex: number
      slotIndex: number
      batchIndex: number
    }> = []
    const runner: SwarmWorkerRunner = vi.fn(async (input) => {
      calls.push({
        workerIndex: input.workerIndex,
        roundIndex: input.roundIndex,
        sequenceIndex: input.sequenceIndex,
        slotIndex: input.slotIndex,
        batchIndex: input.batchIndex,
      })
      return { status: "success", resultText: `done ${input.workerIndex}` }
    })
    const scheduler = createSwarmScheduler({ runner })

    const result = await scheduler.start({
      taskId: "task-1",
      runId: "run-1",
      config: { ...config, runMode: "batch", concurrency: 4, maxRounds: 2 },
    })

    expect(result.status).toBe("success")
    expect(calls).toEqual([
      { workerIndex: 1, roundIndex: 1, sequenceIndex: 1, slotIndex: 1, batchIndex: 1 },
      { workerIndex: 2, roundIndex: 1, sequenceIndex: 2, slotIndex: 2, batchIndex: 1 },
      { workerIndex: 3, roundIndex: 1, sequenceIndex: 3, slotIndex: 3, batchIndex: 1 },
      { workerIndex: 4, roundIndex: 1, sequenceIndex: 4, slotIndex: 4, batchIndex: 1 },
      { workerIndex: 1, roundIndex: 2, sequenceIndex: 5, slotIndex: 1, batchIndex: 2 },
      { workerIndex: 2, roundIndex: 2, sequenceIndex: 6, slotIndex: 2, batchIndex: 2 },
      { workerIndex: 3, roundIndex: 2, sequenceIndex: 7, slotIndex: 3, batchIndex: 2 },
      { workerIndex: 4, roundIndex: 2, sequenceIndex: 8, slotIndex: 4, batchIndex: 2 },
    ])
  })

  it("refills continuous workers until each slot reaches the round limit", async () => {
    const calls: Array<{
      sequenceIndex: number
      slotIndex: number
      roundIndex: number
      batchIndex: number
    }> = []
    const runner: SwarmWorkerRunner = vi.fn(async (input) => {
      calls.push({
        sequenceIndex: input.sequenceIndex,
        slotIndex: input.slotIndex,
        roundIndex: input.roundIndex,
        batchIndex: input.batchIndex,
      })
      return { status: "success", resultText: `round ${input.sequenceIndex}` }
    })
    const scheduler = createSwarmScheduler({ runner })

    const result = await scheduler.start({
      taskId: "task-1",
      runId: "run-1",
      config: { ...config, runMode: "continuous", concurrency: 4, maxRounds: 2 },
    })

    expect(result.status).toBe("success")
    expect(calls.sort((a, b) => a.sequenceIndex - b.sequenceIndex)).toEqual([
      { sequenceIndex: 1, slotIndex: 1, roundIndex: 1, batchIndex: 1 },
      { sequenceIndex: 2, slotIndex: 2, roundIndex: 1, batchIndex: 1 },
      { sequenceIndex: 3, slotIndex: 3, roundIndex: 1, batchIndex: 1 },
      { sequenceIndex: 4, slotIndex: 4, roundIndex: 1, batchIndex: 1 },
      { sequenceIndex: 5, slotIndex: 1, roundIndex: 2, batchIndex: 2 },
      { sequenceIndex: 6, slotIndex: 2, roundIndex: 2, batchIndex: 2 },
      { sequenceIndex: 7, slotIndex: 3, roundIndex: 2, batchIndex: 2 },
      { sequenceIndex: 8, slotIndex: 4, roundIndex: 2, batchIndex: 2 },
    ])
  })

  it("stopRefill prevents a later batch from starting after active batch workers finish", async () => {
    let releaseFirstBatch: (() => void) | undefined
    const firstBatch = new Promise<void>((resolve) => {
      releaseFirstBatch = resolve
    })
    const started: number[] = []
    const runner: SwarmWorkerRunner = vi.fn(async (input) => {
      started.push(input.sequenceIndex)
      if (input.roundIndex === 1) {
        await firstBatch
      }
      return { status: "success", resultText: `round ${input.sequenceIndex}` }
    })
    const scheduler = createSwarmScheduler({ runner })
    const promise = scheduler.start({
      taskId: "task-1",
      runId: "run-1",
      config: { ...config, runMode: "batch", concurrency: 2, maxRounds: 3 },
    })

    await vi.waitFor(() => expect(runner).toHaveBeenCalledTimes(2))
    scheduler.stopRefill("run-1")
    releaseFirstBatch?.()
    const result = await promise

    expect(result.status).toBe("success")
    expect(started).toEqual([1, 2])
  })

  it("stopRefill drains active continuous workers", async () => {
    let releaseFirst: (() => void) | undefined
    const runner: SwarmWorkerRunner = vi.fn(async (input) => {
      if (input.roundIndex === 1) {
        await new Promise<void>((resolve) => {
          releaseFirst = resolve
        })
      }
      return { status: "success", resultText: `round ${input.roundIndex}` }
    })
    const scheduler = createSwarmScheduler({ runner })
    const promise = scheduler.start({
      taskId: "task-1",
      runId: "run-1",
      config: { ...config, runMode: "continuous", concurrency: 1, maxRounds: 5 },
    })

    await vi.waitFor(() => expect(runner).toHaveBeenCalledTimes(1))
    scheduler.stopRefill("run-1")
    releaseFirst?.()
    const result = await promise

    expect(result.status).toBe("success")
    expect(runner).toHaveBeenCalledTimes(1)
  })

  it("cancel waits for active runners to drain and delivers abort signal", async () => {
    let releaseSecond: (() => void) | undefined
    let abortSeen = false
    const runner: SwarmWorkerRunner = vi.fn(async (input) => {
      if (input.slotIndex === 1) {
        return { status: "success", resultText: "round 1" }
      }

      input.abortSignal?.addEventListener(
        "abort",
        () => {
          abortSeen = true
        },
        { once: true },
      )

      await new Promise<void>((resolve) => {
        releaseSecond = resolve
      })

      return { status: "cancelled", resultText: "round 2" }
    })
    const scheduler = createSwarmScheduler({ runner })
    const promise = scheduler.start({
      taskId: "task-1",
      runId: "run-1",
      config: { ...config, runMode: "batch", concurrency: 2, maxRounds: 1 },
    })

    let settled = false
    promise.then(() => {
      settled = true
    })

    await vi.waitFor(() => expect(runner).toHaveBeenCalledTimes(2))
    await scheduler.cancel("run-1")
    await Promise.resolve()

    expect(abortSeen).toBe(true)
    expect(settled).toBe(false)

    releaseSecond?.()
    const result = await promise

    expect(result.status).toBe("partial")
    expect(runner).toHaveBeenCalledTimes(2)
  })

  it("mixed success and cancelled returns partial", async () => {
    let releaseSecond: (() => void) | undefined
    const runner: SwarmWorkerRunner = vi.fn(async (input) => {
      if (input.slotIndex === 1) {
        return { status: "success", resultText: "round 1" }
      }

      await new Promise<void>((resolve) => {
        releaseSecond = resolve
      })

      return { status: "cancelled", resultText: "round 2" }
    })
    const scheduler = createSwarmScheduler({ runner })
    const promise = scheduler.start({
      taskId: "task-1",
      runId: "run-1",
      config: { ...config, runMode: "batch", concurrency: 2, maxRounds: 1 },
    })

    await vi.waitFor(() => expect(runner).toHaveBeenCalledTimes(2))
    await scheduler.cancel("run-1")
    releaseSecond?.()

    const result = await promise

    expect(result.status).toBe("partial")
    expect(result.totals).toMatchObject({
      started: 2,
      success: 1,
      cancelled: 1,
      failed: 0,
      timeout: 0,
    })
  })

  it("cancel with a failure after abort still returns failed", async () => {
    let releaseFirst: (() => void) | undefined
    let releaseSecond: (() => void) | undefined
    const runner: SwarmWorkerRunner = vi.fn(async (input) => {
      if (input.slotIndex === 1) {
        await new Promise<void>((resolve) => {
          releaseFirst = resolve
        })

        throw new Error("worker failed after abort")
      }

      await new Promise<void>((resolve) => {
        releaseSecond = resolve
      })

      return { status: "cancelled", resultText: "round 2" }
    })
    const scheduler = createSwarmScheduler({ runner })
    const promise = scheduler.start({
      taskId: "task-1",
      runId: "run-1",
      config: { ...config, runMode: "batch", concurrency: 2, maxRounds: 1 },
    })

    await vi.waitFor(() => expect(runner).toHaveBeenCalledTimes(2))
    await scheduler.cancel("run-1")
    releaseFirst?.()
    releaseSecond?.()

    const result = await promise

    expect(result.status).toBe("failed")
    expect(result.totals).toMatchObject({
      started: 2,
      success: 0,
      failed: 1,
      cancelled: 1,
      timeout: 0,
    })
  })

  it("treats abort-triggered signal rejections as cancelled", async () => {
    let releaseWorker: (() => void) | undefined
    const runner: SwarmWorkerRunner = vi.fn(async (input) => {
      await new Promise<void>((resolve, reject) => {
        releaseWorker = resolve
        input.abortSignal?.addEventListener(
          "abort",
          () => {
            const abortError = new Error("aborted")
            abortError.name = "AbortError"
            reject(abortError)
          },
          { once: true },
        )
      })

      return { status: "success", resultText: "round 1" }
    })
    const scheduler = createSwarmScheduler({ runner })
    const promise = scheduler.start({
      taskId: "task-1",
      runId: "run-1",
      config: { ...config, runMode: "batch", concurrency: 1, maxRounds: 1 },
    })

    await vi.waitFor(() => expect(runner).toHaveBeenCalledTimes(1))
    await scheduler.cancel("run-1")
    releaseWorker?.()

    const result = await promise

    expect(result.status).toBe("cancelled")
    expect(result.totals).toMatchObject({
      started: 1,
      success: 0,
      failed: 0,
      cancelled: 1,
      timeout: 0,
    })
  })
})
