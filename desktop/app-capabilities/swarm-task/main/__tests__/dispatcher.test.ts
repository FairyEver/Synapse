import { describe, expect, it, vi } from "vitest"

import {
  SWARM_TASK_RUN_CANCEL_CAPABILITY_ID,
  SWARM_TASK_RUN_GET_CAPABILITY_ID,
  SWARM_TASK_RUN_LIST_CAPABILITY_ID,
  SWARM_TASK_RUN_START_CAPABILITY_ID,
  SWARM_TASK_RUN_STOP_REFILL_CAPABILITY_ID,
  SWARM_TASK_TASK_CREATE_CAPABILITY_ID,
  SWARM_TASK_TASK_DELETE_CAPABILITY_ID,
  SWARM_TASK_TASK_GET_CAPABILITY_ID,
  SWARM_TASK_TASK_LIST_CAPABILITY_ID,
  SWARM_TASK_TASK_UPDATE_CAPABILITY_ID,
} from "../../shared/capability"
import type { SwarmRun, SwarmTask } from "../../shared/schema"
import { createSwarmTaskCapabilityDispatcher } from "../dispatcher"

const baseConfig = {
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
      mode: "append-only" as const,
      lock: { enabled: true },
    },
    customAppendix: "",
  },
  runMode: "batch" as const,
  concurrency: 2,
  maxRounds: 2,
  agent: {},
}

const task: SwarmTask = {
  id: "task-1",
  schemaVersion: 1,
  name: "Task",
  currentConfig: baseConfig,
  createdAt: "2026-07-07T00:00:00.000Z",
  updatedAt: "2026-07-07T00:00:00.000Z",
}

const run: SwarmRun = {
  id: "run-1",
  schemaVersion: 1,
  taskId: "task-1",
  status: "running",
  configSnapshot: baseConfig,
  startedAt: "2026-07-07T00:00:00.000Z",
  totals: { started: 0, success: 0, failed: 0, cancelled: 0, timeout: 0 },
  stopRequested: false,
}

function createService(overrides: Record<string, unknown> = {}) {
  return {
    listTasks: vi.fn(async () => [task]),
    createTask: vi.fn(async () => task),
    updateTask: vi.fn(async () => task),
    deleteTask: vi.fn(async () => undefined),
    startRun: vi.fn(async () => run),
    stopRefill: vi.fn(async () => run),
    cancelRun: vi.fn(async () => run),
    listRuns: vi.fn(async () => [run]),
    getRun: vi.fn(async () => run),
    listWorkerRuns: vi.fn(async () => []),
    ...overrides,
  }
}

describe("createSwarmTaskCapabilityDispatcher", () => {
  it("routes task actions through the swarm task service", async () => {
    const service = createService()
    const dispatcher = createSwarmTaskCapabilityDispatcher({ service: service as never })

    await expect(dispatcher.dispatch(SWARM_TASK_TASK_LIST_CAPABILITY_ID, {}, { source: "mcp-http" }))
      .resolves.toEqual({ ok: true, data: [task], affected: 0 })
    await expect(dispatcher.dispatch(SWARM_TASK_TASK_GET_CAPABILITY_ID, { taskId: "task-1" }, { source: "mcp-http" }))
      .resolves.toEqual({ ok: true, data: task, affected: 1 })
    await expect(dispatcher.dispatch(SWARM_TASK_TASK_CREATE_CAPABILITY_ID, {
      name: "Task",
      config: baseConfig,
    }, { source: "mcp-http" })).resolves.toEqual({ ok: true, data: task, affected: 1 })
    await expect(dispatcher.dispatch(SWARM_TASK_TASK_UPDATE_CAPABILITY_ID, {
      taskId: "task-1",
      patch: { name: "Updated" },
    }, { source: "mcp-http" })).resolves.toEqual({ ok: true, data: task, affected: 1 })
    await expect(dispatcher.dispatch(SWARM_TASK_TASK_DELETE_CAPABILITY_ID, {
      taskId: "task-1",
    }, { source: "mcp-http" })).resolves.toEqual({ ok: true, data: { ok: true }, affected: 1 })

    expect(service.createTask).toHaveBeenCalledWith({ name: "Task", config: baseConfig })
    expect(service.updateTask).toHaveBeenCalledWith({ taskId: "task-1", patch: { name: "Updated" } })
    expect(service.deleteTask).toHaveBeenCalledWith("task-1")
    expect(JSON.stringify(task)).not.toContain("workspacePath")
    expect(JSON.stringify(task)).not.toContain("gitContext")
    expect(JSON.stringify(task)).not.toContain("targetFilePolicy")
    expect(JSON.stringify(task)).not.toContain("injectOptions")
    expect(JSON.stringify(task)).not.toContain("summaryFile")
  })

  it("routes run actions through the swarm task service", async () => {
    const service = createService()
    const dispatcher = createSwarmTaskCapabilityDispatcher({ service: service as never })

    await expect(dispatcher.dispatch(SWARM_TASK_RUN_START_CAPABILITY_ID, {
      taskId: "task-1",
    }, { source: "mcp-http" })).resolves.toEqual({ ok: true, data: run, affected: 1 })
    await expect(dispatcher.dispatch(SWARM_TASK_RUN_STOP_REFILL_CAPABILITY_ID, {
      runId: "run-1",
    }, { source: "mcp-http" })).resolves.toEqual({ ok: true, data: run, affected: 1 })
    await expect(dispatcher.dispatch(SWARM_TASK_RUN_CANCEL_CAPABILITY_ID, {
      runId: "run-1",
    }, { source: "mcp-http" })).resolves.toEqual({ ok: true, data: run, affected: 1 })
    await expect(dispatcher.dispatch(SWARM_TASK_RUN_LIST_CAPABILITY_ID, {
      taskId: "task-1",
      limit: 5,
    }, { source: "mcp-http" })).resolves.toEqual({ ok: true, data: [run], affected: 0 })
    await expect(dispatcher.dispatch(SWARM_TASK_RUN_GET_CAPABILITY_ID, {
      runId: "run-1",
    }, { source: "mcp-http" })).resolves.toEqual({ ok: true, data: run, affected: 1 })

    expect(service.startRun).toHaveBeenCalledWith({ taskId: "task-1" })
    expect(service.stopRefill).toHaveBeenCalledWith("run-1")
    expect(service.cancelRun).toHaveBeenCalledWith("run-1")
    expect(service.listRuns).toHaveBeenCalledWith("task-1", 5)
    expect(service.getRun).toHaveBeenCalledWith("run-1")
  })

  it("fails missing run mutations while keeping nullable reads", async () => {
    const service = createService({
      listTasks: vi.fn(async () => []),
      stopRefill: vi.fn(async () => null),
      cancelRun: vi.fn(async () => null),
      getRun: vi.fn(async () => null),
    })
    const dispatcher = createSwarmTaskCapabilityDispatcher({ service: service as never })

    await expect(dispatcher.dispatch(SWARM_TASK_TASK_DELETE_CAPABILITY_ID, {
      taskId: "missing",
    }, { source: "mcp-http" })).resolves.toEqual({ ok: true, data: { ok: true }, affected: 0 })
    await expect(dispatcher.dispatch(SWARM_TASK_RUN_STOP_REFILL_CAPABILITY_ID, {
      runId: "missing",
    }, { source: "mcp-http" })).resolves.toEqual({ ok: false, error: "蜂群运行不存在：missing" })
    await expect(dispatcher.dispatch(SWARM_TASK_RUN_CANCEL_CAPABILITY_ID, {
      runId: "missing",
    }, { source: "mcp-http" })).resolves.toEqual({ ok: false, error: "蜂群运行不存在：missing" })
    await expect(dispatcher.dispatch(SWARM_TASK_RUN_GET_CAPABILITY_ID, {
      runId: "missing",
    }, { source: "mcp-http" })).resolves.toEqual({ ok: true, data: null, affected: 0 })

    expect(service.deleteTask).not.toHaveBeenCalled()
  })

  it("rejects unknown swarm task actions", async () => {
    const dispatcher = createSwarmTaskCapabilityDispatcher({ service: createService() as never })

    await expect(dispatcher.dispatch("app.swarm_task.unknown", {}, { source: "mcp-http" }))
      .rejects.toThrow("Unknown swarm task action")
  })
})
