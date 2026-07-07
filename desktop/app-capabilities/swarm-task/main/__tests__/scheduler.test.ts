import { describe, expect, it, vi } from "vitest"
import { createSwarmScheduler, type SwarmWorkerRunner } from "../scheduler"
import type { SwarmTaskConfig } from "../../shared/schema"

const config: SwarmTaskConfig = {
  projectId: "project-1",
  workspacePath: "/repo",
  prompt: "Run.",
  presetId: "general",
  injectOptions: {
    workerIdentity: true,
    roundContext: true,
    runContext: true,
    outputProtocol: true,
    parallelContext: true,
    gitContext: false,
    customAppendix: "",
  },
  runMode: "batch",
  concurrency: 3,
  maxRounds: 3,
  output: { mode: "managed-directory", targetFilePolicy: "append-only" },
  summary: { enabled: true, injectRecent: false, recentLimit: 3 },
  handoff: { enabled: false },
  agent: {},
}

describe("createSwarmScheduler", () => {
  it("runs fixed batch workers once", async () => {
    const calls: Array<{ workerIndex: number; roundIndex: number }> = []
    const runner: SwarmWorkerRunner = vi.fn(async (input) => {
      calls.push({ workerIndex: input.workerIndex, roundIndex: input.roundIndex })
      return { status: "success", resultText: `done ${input.workerIndex}` }
    })
    const scheduler = createSwarmScheduler({ runner })

    const result = await scheduler.start({
      taskId: "task-1",
      runId: "run-1",
      config,
    })

    expect(result.status).toBe("success")
    expect(calls).toEqual([
      { workerIndex: 1, roundIndex: 1 },
      { workerIndex: 2, roundIndex: 2 },
      { workerIndex: 3, roundIndex: 3 },
    ])
  })

  it("refills continuous workers until maxRounds", async () => {
    const calls: number[] = []
    const runner: SwarmWorkerRunner = vi.fn(async (input) => {
      calls.push(input.roundIndex)
      return { status: "success", resultText: `round ${input.roundIndex}` }
    })
    const scheduler = createSwarmScheduler({ runner })

    const result = await scheduler.start({
      taskId: "task-1",
      runId: "run-1",
      config: { ...config, runMode: "continuous", concurrency: 2, maxRounds: 5 },
    })

    expect(result.status).toBe("success")
    expect(calls.sort((a, b) => a - b)).toEqual([1, 2, 3, 4, 5])
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
      if (input.roundIndex === 1) {
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
      config: { ...config, runMode: "batch", concurrency: 2, maxRounds: 2 },
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
      if (input.roundIndex === 1) {
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
      config: { ...config, runMode: "batch", concurrency: 2, maxRounds: 2 },
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
      if (input.roundIndex === 1) {
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
      config: { ...config, runMode: "batch", concurrency: 2, maxRounds: 2 },
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
