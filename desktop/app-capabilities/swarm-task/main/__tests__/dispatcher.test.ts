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
import type { SwarmRun, SwarmTask, SwarmWorkerRun } from "../../shared/schema"
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

const worker: SwarmWorkerRun = {
  id: "worker-1",
  schemaVersion: 1,
  taskId: "task-1",
  runId: "run-1",
  workerIndex: 1,
  roundIndex: 1,
  status: "success",
  conversationId: "conversation-1",
  sessionKey: "internal-session-key",
  lastPhase: "completed",
  summary: "Summary",
  handoff: "Handoff",
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
    listWorkerRuns: vi.fn(async () => [worker]),
    ...overrides,
  }
}

function createSecurity() {
  return {
    permissionGuard: {
      check: vi.fn(async () => ({ allowed: true as const })),
    },
    auditSink: {
      record: vi.fn(),
    },
  }
}

describe("createSwarmTaskCapabilityDispatcher", () => {
  it("routes task actions through the swarm task service", async () => {
    const service = createService()
    const security = createSecurity()
    const dispatcher = createSwarmTaskCapabilityDispatcher({ service: service as never, ...security })

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
    expect(security.permissionGuard.check.mock.calls.map(([request]) => request.action)).toEqual([
      "automation.read",
      "automation.read",
      "automation.mutate",
      "automation.mutate",
      "automation.mutate",
    ])
    expect(security.auditSink.record).toHaveBeenCalledTimes(5)
    expect(security.auditSink.record.mock.calls.every(([event]) => event.outcome === "allowed")).toBe(true)
    expect(JSON.stringify(security.auditSink.record.mock.calls)).not.toContain(baseConfig.prompt)
  })

  it("routes run actions through the swarm task service", async () => {
    const service = createService()
    const security = createSecurity()
    const dispatcher = createSwarmTaskCapabilityDispatcher({ service: service as never, ...security })

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
    const runGetResult = await dispatcher.dispatch(SWARM_TASK_RUN_GET_CAPABILITY_ID, {
      runId: "run-1",
    }, { source: "mcp-http" })
    expect(runGetResult).toEqual({
      ok: true,
      data: {
        ...run,
        workers: [expect.objectContaining({
          id: "worker-1",
          conversationId: "conversation-1",
          lastPhase: "completed",
          summary: "Summary",
          handoff: "Handoff",
        })],
      },
      affected: 1,
    })
    expect(JSON.stringify(runGetResult)).not.toContain("internal-session-key")

    expect(service.startRun).toHaveBeenCalledWith({ taskId: "task-1" })
    expect(service.stopRefill).toHaveBeenCalledWith("run-1")
    expect(service.cancelRun).toHaveBeenCalledWith("run-1")
    expect(service.listRuns).toHaveBeenCalledWith("task-1", 5)
    expect(service.getRun).toHaveBeenCalledWith("run-1")
    expect(service.listWorkerRuns).toHaveBeenCalledWith("run-1")
    expect(security.permissionGuard.check.mock.calls.map(([request]) => request.action)).toEqual([
      "agent.spawn",
      "automation.mutate",
      "automation.mutate",
      "automation.read",
      "automation.read",
    ])
    expect(security.auditSink.record).toHaveBeenCalledTimes(5)
    expect(security.auditSink.record.mock.calls.every(([event]) => event.outcome === "allowed")).toBe(true)
    expect(security.permissionGuard.check).toHaveBeenCalledWith(expect.objectContaining({
      action: "automation.read",
      resource: "swarm-task:task:task-1",
      context: expect.objectContaining({
        capabilityAction: SWARM_TASK_RUN_LIST_CAPABILITY_ID,
        taskId: "task-1",
      }),
    }))
  })

  it("rejects an unscoped run list before permission checks or service reads", async () => {
    const service = createService()
    const security = createSecurity()
    const dispatcher = createSwarmTaskCapabilityDispatcher({ service: service as never, ...security })

    await expect(dispatcher.dispatch(SWARM_TASK_RUN_LIST_CAPABILITY_ID, {
      limit: 5,
    }, { source: "mcp-http" })).rejects.toThrow()

    expect(security.permissionGuard.check).not.toHaveBeenCalled()
    expect(service.listRuns).not.toHaveBeenCalled()
  })

  it("fails missing run mutations while keeping nullable reads", async () => {
    const service = createService({
      listTasks: vi.fn(async () => []),
      stopRefill: vi.fn(async () => null),
      cancelRun: vi.fn(async () => null),
      getRun: vi.fn(async () => null),
    })
    const security = createSecurity()
    const dispatcher = createSwarmTaskCapabilityDispatcher({ service: service as never, ...security })

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
    expect(service.listWorkerRuns).not.toHaveBeenCalled()
    expect(security.auditSink.record.mock.calls.filter(([event]) => event.outcome === "failed")).toHaveLength(2)
  })

  it("blocks a denied run start before mutating the service", async () => {
    const service = createService()
    const security = createSecurity()
    security.permissionGuard.check.mockResolvedValueOnce({ allowed: false, reason: "denied" })
    const dispatcher = createSwarmTaskCapabilityDispatcher({ service: service as never, ...security })

    await expect(dispatcher.dispatch(SWARM_TASK_RUN_START_CAPABILITY_ID, {
      taskId: "task-1",
    }, {
      source: "mcp-http",
      actor: { kind: "agent", id: "agent-1" },
    })).rejects.toThrow("denied")

    expect(service.startRun).not.toHaveBeenCalled()
    expect(security.permissionGuard.check).toHaveBeenCalledWith(expect.objectContaining({
      action: "agent.spawn",
      actor: { kind: "agent", id: "agent-1" },
      resource: "swarm-task:task:task-1",
    }))
    expect(security.auditSink.record).toHaveBeenCalledWith(expect.objectContaining({
      action: "agent.spawn",
      outcome: "denied",
    }))
  })

  it("audits service failures without prompt or error text", async () => {
    const service = createService({
      startRun: vi.fn(async () => {
        throw new Error("sensitive prompt and worker output")
      }),
    })
    const security = createSecurity()
    const dispatcher = createSwarmTaskCapabilityDispatcher({ service: service as never, ...security })

    await expect(dispatcher.dispatch(SWARM_TASK_RUN_START_CAPABILITY_ID, {
      taskId: "task-1",
      configOverride: { prompt: "private prompt" },
    }, { source: "mcp-http" })).rejects.toThrow("sensitive prompt and worker output")

    expect(security.auditSink.record).toHaveBeenCalledWith(expect.objectContaining({
      action: "agent.spawn",
      outcome: "failed",
      metadata: expect.objectContaining({
        taskId: "task-1",
        errorName: "Error",
      }),
    }))
    const auditJson = JSON.stringify(security.auditSink.record.mock.calls)
    expect(auditJson).not.toContain("private prompt")
    expect(auditJson).not.toContain("sensitive prompt and worker output")
  })

  it("rejects unknown swarm task actions", async () => {
    const dispatcher = createSwarmTaskCapabilityDispatcher({ service: createService() as never })

    await expect(dispatcher.dispatch("app.swarm_task.unknown", {}, { source: "mcp-http" }))
      .rejects.toThrow("Unknown swarm task action")
  })
})
