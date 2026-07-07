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
})
