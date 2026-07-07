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
    output: {
      mode: "managed-directory",
      targetFilePolicy: "append-only",
    },
    summary: {
      enabled: true,
      injectRecent: false,
      recentLimit: 3,
    },
    handoff: {
      enabled: false,
    },
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
    }

    const result = await swarmTaskNodeExecutor.execute(createInput({
      taskId: "task-1",
      promptOverride: "Override.",
      runModeOverride: "continuous",
      maxRoundsOverride: 5,
      concurrencyOverride: 2,
      waitForCompletion: false,
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
    }

    const result = await swarmTaskNodeExecutor.execute(createInput({
      taskId: "task-1",
      waitForCompletion: true,
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
    }
    const cancelledService = {
      startRun: vi.fn().mockResolvedValue(baseRun),
      getRun: vi.fn().mockResolvedValue({ ...baseRun, status: "cancelled" }),
    }

    await expect(swarmTaskNodeExecutor.execute(createInput({
      taskId: "task-1",
      waitForCompletion: true,
    }, failedService))).resolves.toMatchObject({
      status: "failed",
      error: "蜂群任务执行失败",
    })

    await expect(swarmTaskNodeExecutor.execute(createInput({
      taskId: "task-1",
      waitForCompletion: true,
    }, cancelledService))).resolves.toMatchObject({
      status: "cancelled",
      error: "蜂群任务已取消",
    })
  })
})

function createInput(
  config: SwarmTaskNodeConfig,
  service: {
    readonly startRun: ReturnType<typeof vi.fn>
    readonly getRun: ReturnType<typeof vi.fn>
  },
): NodeExecutionInput<SwarmTaskNodeConfig> {
  return {
    config,
    resolvedVariables: {},
    context: {
      runId: "workflow-run-1",
      abortSignal: new AbortController().signal,
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
