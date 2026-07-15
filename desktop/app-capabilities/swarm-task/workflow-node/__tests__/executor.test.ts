import { describe, expect, it, vi } from "vitest"

vi.mock("../../../../electron/services/log-store", () => ({
  createMainLogger: () => ({
    info: vi.fn(),
    warn: vi.fn(),
    error: vi.fn(),
    debug: vi.fn(),
  }),
}))

import { SWARM_TASK_SERVICE_ID } from "../../shared/capability"
import type { SwarmRun } from "../../shared/schema"
import { swarmTaskNodeExecutor } from "../executor.main"
import type { SwarmTaskNodeConfig } from "../schema"
import type { NodeExecutionInput } from "../../../../workflow-nodes/types"

const baseRun: SwarmRun = {
  id: "run-1",
  schemaVersion: 1,
  taskId: "task-1",
  status: "running",
  configSnapshot: {
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
  },
  startedAt: "2026-07-07T00:00:00.000Z",
  totals: { started: 0, success: 0, failed: 0, cancelled: 0, timeout: 0 },
  outputDirectory: "/tmp/swarm-runs/run-1",
  stopRequested: false,
}

describe("swarmTaskNodeExecutor", () => {
  it("starts a run and returns immediately when wait is disabled", async () => {
    const service = {
      startRun: vi.fn().mockResolvedValue(baseRun),
      getRun: vi.fn(),
      cancelRun: vi.fn(),
    }

    const result = await swarmTaskNodeExecutor.execute(createInput({
      taskId: "task-1",
      promptOverride: "Override.",
      runModeOverride: "continuous",
      maxRoundsOverride: 5,
      concurrencyOverride: 2,
      waitForCompletion: false,
      variables: [],
    }, service))

    expect(result.status).toBe("success")
    expect(result.output).toBe("run-1")
    expect(result.outputs).toEqual({
      runId: "run-1",
      status: "running",
      totals: baseRun.totals,
      outputDirectory: "/tmp/swarm-runs/run-1",
    })
    expect(service.startRun).toHaveBeenCalledWith({
      taskId: "task-1",
      configOverride: {
        prompt: "Override.",
        runMode: "continuous",
        maxRounds: 5,
        concurrency: 2,
      },
    })
    expect(service.getRun).not.toHaveBeenCalled()
  })

  it("does not start a run when the workflow is already aborted", async () => {
    const abortController = new AbortController()
    abortController.abort()
    const service = {
      startRun: vi.fn().mockResolvedValue(baseRun),
      getRun: vi.fn(),
      cancelRun: vi.fn(),
    }

    const result = await swarmTaskNodeExecutor.execute(createInput({
      taskId: "task-1",
      waitForCompletion: false,
      variables: [],
    }, service, abortController))

    expect(result).toMatchObject({
      status: "cancelled",
      error: "工作流已取消",
    })
    expect(service.startRun).not.toHaveBeenCalled()
    expect(service.cancelRun).not.toHaveBeenCalled()
  })

  it("cancels a newly started run when the workflow aborts during startup", async () => {
    const abortController = new AbortController()
    const service = {
      startRun: vi.fn(async () => {
        abortController.abort()
        return baseRun
      }),
      getRun: vi.fn(),
      cancelRun: vi.fn().mockResolvedValue(baseRun),
    }

    const result = await swarmTaskNodeExecutor.execute(createInput({
      taskId: "task-1",
      waitForCompletion: false,
      variables: [],
    }, service, abortController))

    expect(result).toMatchObject({
      status: "cancelled",
      error: "工作流已取消",
    })
    expect(service.startRun).toHaveBeenCalledTimes(1)
    expect(service.cancelRun).toHaveBeenCalledWith("run-1")
    expect(service.getRun).not.toHaveBeenCalled()
  })

  it("polls until a terminal run succeeds when wait is enabled", async () => {
    const terminalRun: SwarmRun = {
      ...baseRun,
      status: "success",
      totals: { started: 2, success: 2, failed: 0, cancelled: 0, timeout: 0 },
    }
    const service = {
      startRun: vi.fn().mockResolvedValue(baseRun),
      getRun: vi.fn()
        .mockResolvedValueOnce({ ...baseRun, totals: { ...baseRun.totals, started: 1 } })
        .mockResolvedValueOnce(terminalRun),
      cancelRun: vi.fn(),
    }

    const result = await swarmTaskNodeExecutor.execute(createInput({
      taskId: "task-1",
      waitForCompletion: true,
      variables: [],
    }, service))

    expect(result.status).toBe("success")
    expect(result.output).toBe("run-1")
    expect(result.outputs).toEqual({
      runId: "run-1",
      status: "success",
      totals: terminalRun.totals,
      outputDirectory: "/tmp/swarm-runs/run-1",
    })
    expect(service.getRun).toHaveBeenCalledTimes(2)
    expect(service.getRun).toHaveBeenCalledWith("run-1")
  })

  it("maps terminal failed and cancelled runs to node status", async () => {
    const failedService = {
      startRun: vi.fn().mockResolvedValue(baseRun),
      getRun: vi.fn().mockResolvedValue({ ...baseRun, status: "failed" }),
      cancelRun: vi.fn(),
    }
    const cancelledService = {
      startRun: vi.fn().mockResolvedValue(baseRun),
      getRun: vi.fn().mockResolvedValue({ ...baseRun, status: "cancelled" }),
      cancelRun: vi.fn(),
    }

    await expect(swarmTaskNodeExecutor.execute(createInput({
      taskId: "task-1",
      waitForCompletion: true,
      variables: [],
    }, failedService))).resolves.toMatchObject({
      status: "failed",
      error: "蜂群任务执行失败",
    })

    await expect(swarmTaskNodeExecutor.execute(createInput({
      taskId: "task-1",
      waitForCompletion: true,
      variables: [],
    }, cancelledService))).resolves.toMatchObject({
      status: "cancelled",
      error: "蜂群任务已取消",
    })
  })

  it("maps a partial terminal run to a failed workflow node", async () => {
    const partialRun: SwarmRun = {
      ...baseRun,
      status: "partial",
      totals: { started: 4, success: 1, failed: 1, cancelled: 1, timeout: 1 },
    }
    const service = {
      startRun: vi.fn().mockResolvedValue(baseRun),
      getRun: vi.fn().mockResolvedValue(partialRun),
      cancelRun: vi.fn(),
    }

    const result = await swarmTaskNodeExecutor.execute(createInput({
      taskId: "task-1",
      waitForCompletion: true,
      variables: [],
    }, service))

    expect(result).toMatchObject({
      status: "failed",
      error: "蜂群任务部分完成：1 个成功，1 个失败，1 个取消，1 个超时",
      outputs: {
        status: "partial",
        totals: partialRun.totals,
      },
    })
  })

  it("cancels the swarm run when the workflow aborts while waiting", async () => {
    const abortController = new AbortController()
    let resolveCancel: ((run: SwarmRun) => void) | null = null
    const service = {
      startRun: vi.fn().mockResolvedValue(baseRun),
      getRun: vi.fn(async () => {
        abortController.abort()
        return baseRun
      }),
      cancelRun: vi.fn(async () => await new Promise<SwarmRun>((resolve) => {
        resolveCancel = resolve
      })),
    }

    const resultPromise = swarmTaskNodeExecutor.execute(createInput({
      taskId: "task-1",
      waitForCompletion: true,
      variables: [],
    }, service, abortController))

    await Promise.resolve()
    expect(service.cancelRun).toHaveBeenCalledWith("run-1")

    let settled = false
    void resultPromise.finally(() => {
      settled = true
    })
    await Promise.resolve()
    expect(settled).toBe(false)

    resolveCancel?.(baseRun)
    const result = await resultPromise

    expect(result.status).toBe("cancelled")
  })

  it("handles rejected swarm cancellation after workflow abort", async () => {
    const abortController = new AbortController()
    const unhandled = vi.fn()
    process.once("unhandledRejection", unhandled)
    const service = {
      startRun: vi.fn().mockResolvedValue(baseRun),
      getRun: vi.fn(async () => {
        abortController.abort()
        return baseRun
      }),
      cancelRun: vi.fn().mockRejectedValue(new Error("cancel failed")),
    }

    const result = await swarmTaskNodeExecutor.execute(createInput({
      taskId: "task-1",
      waitForCompletion: true,
      variables: [],
    }, service, abortController))

    await Promise.resolve()
    process.removeListener("unhandledRejection", unhandled)
    expect(result.status).toBe("cancelled")
    expect(service.cancelRun).toHaveBeenCalledWith("run-1")
    expect(unhandled).not.toHaveBeenCalled()
  })
})

function createInput(
  config: SwarmTaskNodeConfig,
  service: {
    readonly startRun: ReturnType<typeof vi.fn>
    readonly getRun: ReturnType<typeof vi.fn>
    readonly cancelRun: ReturnType<typeof vi.fn>
  },
  abortController = new AbortController(),
): NodeExecutionInput<SwarmTaskNodeConfig> {
  return {
    config,
    resolvedVariables: {},
    context: {
      runId: "workflow-run-1",
      abortSignal: abortController.signal,
    },
    agentDeps: {
      sendToAgent: vi.fn(),
    },
    runtimeDeps: {
      resolveService: vi.fn((serviceId: string) => {
        if (serviceId === SWARM_TASK_SERVICE_ID) return service
        throw new Error(`Unknown service: ${serviceId}`)
      }),
    } as never,
  }
}
