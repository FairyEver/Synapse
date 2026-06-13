import { z } from "zod"
import { describe, expect, it, vi } from "vitest"

import {
  MainActionRegistry,
  type ActionExecutionInput,
  type MainActionDefinition,
} from "../../../action-runtime/action-registry"
import type { AuditSink, PermissionGuard } from "../../../runtime/security"
import { dispatchSchedulerAction, toPublicTaskSummary } from "../external-api"
import type { TaskSchedulerService } from "../task-scheduler-service"
import type { ScheduledTaskEntry, ScheduledTaskRunEntry } from "../types"

const baseTask: ScheduledTaskEntry = {
  id: "task:1",
  schemaVersion: 2,
  name: "Daily summary",
  description: "Send summary",
  scope: { type: "global" },
  trigger: { type: "builtin.interval", config: { everyMinutes: 30, anchor: "created_at" } },
  action: { type: "builtin.command", config: { command: "echo ok" } },
  enabled: true,
  missedRunPolicy: "skip",
  overlapPolicy: "skip",
  activeDays: [0, 1, 2, 3, 4, 5, 6],
  createdAt: "2026-05-02T00:00:00.000Z",
  updatedAt: "2026-05-02T00:00:00.000Z",
  nextRunAt: "2026-05-02T00:30:00.000Z",
  runCount: 0,
  configVersion: 0,
}

const baseRun: ScheduledTaskRunEntry = {
  id: "run:1",
  schemaVersion: 2,
  taskId: "task:1",
  startedAt: "2026-05-02T00:10:00.000Z",
  finishedAt: "2026-05-02T00:10:02.000Z",
  status: "success",
  triggeredBy: "schedule",
  result: {
    status: "success",
    summary: "ok",
    logs: [{ label: "stdout", value: "large output" }],
    metrics: { durationMs: 2000, exitCode: 0 },
  },
}

function serviceMock(): TaskSchedulerService {
  return {
    schedulerTaskList: vi.fn(async () => [baseTask, { ...baseTask, id: "task:2", enabled: false }]),
    schedulerTaskGet: vi.fn(async (id: string) => (id === "task:1" ? baseTask : null)),
    schedulerTaskCreate: vi.fn(async (input) => ({ ...baseTask, ...input, id: "task:new" })),
    schedulerTaskUpdate: vi.fn(async (_id, patch) => ({
      ...baseTask,
      ...patch,
      updatedAt: "2026-05-02T00:20:00.000Z",
    })),
    schedulerTaskEnable: vi.fn(async (_id: string) => ({ ...baseTask, enabled: true })),
    schedulerTaskDisable: vi.fn(async (_id: string) => ({ ...baseTask, enabled: false })),
    schedulerRunList: vi.fn(async () => [baseRun]),
    schedulerRuntimeInspect: vi.fn(() => ({ timers: ["task:1"], runningTaskIds: ["task:2"] })),
  } as unknown as TaskSchedulerService
}

function actionRegistry(options: { includeAgent?: boolean } = {}): MainActionRegistry {
  const registry = new MainActionRegistry()
  registry.register(testAction())
  if (options.includeAgent) {
    registry.register(testAgentAction())
  }
  return registry
}

const testActionSchema = z.object({ command: z.string().min(1) })
type TestActionConfig = z.infer<typeof testActionSchema>

function testAction(): MainActionDefinition<TestActionConfig> {
  return {
    manifest: {
      id: "builtin.command",
      title: "命令",
      permissions: ["shell.exec"],
      defaultConfig: { command: "date" },
      configFields: [
        { name: "command", kind: "string", required: true, defaultValue: "" },
      ],
      configSchema: testActionSchema,
    },
    buildPermissionRequest: ({ config, context }) => ({
      action: "shell.exec",
      actor: context.actor,
      resource: config.command,
      context: { taskId: context.taskId, runId: context.runId },
    }),
    execute: async (_input: ActionExecutionInput<TestActionConfig>) => ({ status: "success" }),
  }
}

const testAgentActionSchema = z.object({
  projectId: z.string().min(1),
  agentType: z.string().min(1),
  mode: z.string().min(1),
  prompt: z.string().min(1),
})
type TestAgentActionConfig = z.infer<typeof testAgentActionSchema>

function testAgentAction(): MainActionDefinition<TestAgentActionConfig> {
  return {
    manifest: {
      id: "builtin.agent",
      title: "Agent",
      permissions: ["agent.spawn"],
      defaultConfig: { projectId: "", agentType: "claude-code", mode: "plan", prompt: "" },
      configFields: [],
      configSchema: testAgentActionSchema,
    },
    buildPermissionRequest: ({ config, context }) => ({
      action: "agent.spawn",
      actor: context.actor,
      resource: config.projectId,
      context: { taskId: context.taskId, runId: context.runId },
    }),
    execute: async (_input: ActionExecutionInput<TestAgentActionConfig>) => ({ status: "success" }),
  }
}

describe("task scheduler external api", () => {
  it("keeps list/get/create/enable/disable behavior", async () => {
    const service = serviceMock()
    const actions = actionRegistry()

    await expect(dispatchSchedulerAction(service, actions, "scheduler.task.list", { enabled: true }))
      .resolves.toEqual({ ok: true, data: [toPublicTaskSummary(baseTask)], total: 1 })
    await expect(dispatchSchedulerAction(service, actions, "scheduler.task.get", { taskId: "task:1" }))
      .resolves.toEqual({ ok: true, data: toPublicTaskSummary(baseTask) })
    await dispatchSchedulerAction(service, actions, "scheduler.task.enable", { taskId: "task:1" })
    await dispatchSchedulerAction(service, actions, "scheduler.task.disable", { taskId: "task:1" })
    expect(service.schedulerTaskEnable).toHaveBeenCalledWith("task:1")
    expect(service.schedulerTaskDisable).toHaveBeenCalledWith("task:1")
  })

  it("does not expose scheduled agent prompt config from task get", async () => {
    const service = serviceMock()
    const agentTask: ScheduledTaskEntry = {
      ...baseTask,
      action: {
        type: "builtin.agent",
        config: {
          projectId: "project:1",
          agentType: "claude-code",
          mode: "plan",
          prompt: "summarize private repository context",
        },
      },
    }
    vi.mocked(service.schedulerTaskGet).mockResolvedValueOnce(agentTask)

    const result = await dispatchSchedulerAction(service, actionRegistry(), "scheduler.task.get", {
      taskId: "task:1",
    })

    expect(result).toEqual({ ok: true, data: toPublicTaskSummary(agentTask) })
    expect(JSON.stringify(result)).not.toContain("summarize private repository context")
  })

  it("includes compact validation issues in public task summaries", () => {
    const summary = toPublicTaskSummary({
      ...baseTask,
      action: {
        type: "builtin.agent",
        config: {
          projectId: "",
          prompt: "private prompt text",
        },
      },
      enabled: false,
      validation: {
        status: "needs_update",
        issues: [
          { field: "action.config.projectId", message: "请选择项目。" },
          { field: "action.config.prompt", message: "请输入提示词。" },
        ],
      },
    })

    expect(summary.validation).toEqual({
      status: "needs_update",
      issues: [
        { field: "action.config.projectId", message: "请选择项目。" },
        { field: "action.config.prompt", message: "请输入提示词。" },
      ],
    })
    expect(JSON.stringify(summary)).not.toContain("private prompt text")
  })

  it("does not expose scheduled agent prompt config from task mutations", async () => {
    const service = serviceMock()
    const action = {
      type: "builtin.agent",
      config: {
        projectId: "project:1",
        agentType: "claude-code",
        mode: "plan",
        prompt: "summarize private repository context",
      },
    }
    const agentTask: ScheduledTaskEntry = { ...baseTask, action }
    vi.mocked(service.schedulerTaskUpdate).mockResolvedValueOnce(agentTask)
    vi.mocked(service.schedulerTaskEnable).mockResolvedValueOnce(agentTask)
    vi.mocked(service.schedulerTaskDisable).mockResolvedValueOnce(agentTask)

    const registry = actionRegistry({ includeAgent: true })
    const createResult = await dispatchSchedulerAction(service, registry, "scheduler.task.create", {
      name: "Agent task",
      description: "Send summary",
      scope: { type: "global" },
      schedule: { type: "interval", everyMinutes: 30, anchor: "created_at" },
      action,
      enabled: true,
    })
    const enableResult = await dispatchSchedulerAction(service, actionRegistry(), "scheduler.task.enable", {
      taskId: "task:1",
    })
    const disableResult = await dispatchSchedulerAction(service, actionRegistry(), "scheduler.task.disable", {
      taskId: "task:1",
    })
    const updateResult = await dispatchSchedulerAction(service, actionRegistry(), "scheduler.task.update", {
      taskId: "task:1",
      name: "Updated Agent task",
    })

    expect(createResult).toEqual({
      ok: true,
      data: toPublicTaskSummary({ ...baseTask, name: "Agent task", action, id: "task:new" }),
    })
    expect(enableResult).toEqual({ ok: true, data: toPublicTaskSummary(agentTask) })
    expect(disableResult).toEqual({ ok: true, data: toPublicTaskSummary(agentTask) })
    expect(updateResult).toEqual({ ok: true, data: toPublicTaskSummary(agentTask) })
    expect(JSON.stringify([createResult, enableResult, disableResult, updateResult]))
      .not.toContain("summarize private repository context")
  })

  it("persists external scheduler source on create and update requests", async () => {
    const service = serviceMock()

    await dispatchSchedulerAction(service, actionRegistry(), "scheduler.task.create", {
      name: "External command",
      scope: { type: "global" },
      schedule: { type: "interval", everyMinutes: 30 },
      action: { type: "builtin.command", config: { command: "echo ok" } },
    }, { source: "mcp-stdio" })
    await dispatchSchedulerAction(service, actionRegistry(), "scheduler.task.update", {
      taskId: "task:1",
      name: "External update",
    }, { source: "mcp-http" })

    expect(service.schedulerTaskCreate).toHaveBeenCalledWith(expect.objectContaining({
      provenance: { source: "mcp-stdio" },
    }))
    expect(service.schedulerTaskUpdate).toHaveBeenCalledWith("task:1", expect.objectContaining({
      name: "External update",
      provenance: { source: "mcp-http" },
    }))
  })

  it("lists run summaries without log payloads", async () => {
    const service = serviceMock()
    const result = await dispatchSchedulerAction(service, actionRegistry(), "scheduler.run.list", {
      taskId: "task:1",
    })

    expect(service.schedulerRunList).toHaveBeenCalledWith("task:1", { limit: 20 })
    expect(result).toEqual({
      ok: true,
      data: [{
        id: "run:1",
        taskId: "task:1",
        status: "success",
        triggeredBy: "schedule",
        startedAt: "2026-05-02T00:10:00.000Z",
        finishedAt: "2026-05-02T00:10:02.000Z",
        summary: "ok",
        metrics: { durationMs: 2000, exitCode: 0 },
      }],
      total: 1,
    })
    expect(JSON.stringify(result)).not.toContain("large output")
  })

  it("returns runtime status for all tasks and one task", async () => {
    const service = serviceMock()
    const all = await dispatchSchedulerAction(service, actionRegistry(), "scheduler.runtime.inspect", {})
    expect(all).toEqual(expect.objectContaining({
      ok: true,
      data: expect.objectContaining({
        runningTaskIds: ["task:2"],
        scheduledTaskIds: ["task:1"],
      }),
    }))

    const one = await dispatchSchedulerAction(service, actionRegistry(), "scheduler.runtime.inspect", {
      taskId: "task:1",
    })
    expect(one).toEqual(expect.objectContaining({
      ok: true,
      data: expect.objectContaining({
        tasks: [expect.objectContaining({ id: "task:1", scheduled: true, running: false })],
      }),
    }))
  })

  it("lists public action type descriptors from the shared registry", async () => {
    const result = await dispatchSchedulerAction(serviceMock(), actionRegistry(), "scheduler.action_type.list", {})
    expect(result).toEqual({
      ok: true,
      data: [{
        type: "builtin.command",
        title: "命令",
        permissions: ["shell.exec"],
        defaultConfig: { command: "date" },
        configFields: [{ name: "command", kind: "string", required: true, defaultValue: "" }],
      }],
      total: 1,
    })
  })

  it("updates only conservative public fields", async () => {
    const service = serviceMock()
    await dispatchSchedulerAction(service, actionRegistry(), "scheduler.task.update", {
      taskId: "task:1",
      name: "Updated",
      schedule: { type: "cron", expr: "0 9 * * *", timezone: "Asia/Shanghai" },
      missedRunPolicy: "run_once",
    })

    expect(service.schedulerTaskUpdate).toHaveBeenCalledWith("task:1", {
      name: "Updated",
      description: undefined,
      cwd: undefined,
      trigger: { type: "builtin.cron", config: { expr: "0 9 * * *", timezone: "Asia/Shanghai" } },
      missedRunPolicy: "run_once",
      provenance: { source: "api" },
    })
  })

  it("rejects empty and forbidden update patches", async () => {
    const service = serviceMock()
    const actions = actionRegistry()
    await expect(dispatchSchedulerAction(service, actions, "scheduler.task.update", { taskId: "task:1" }))
      .rejects.toThrow(/at least one field/)
    await expect(dispatchSchedulerAction(service, actions, "scheduler.task.update", {
      taskId: "task:1",
      action: { type: "builtin.command", config: { command: "rm -rf /tmp/x" } },
    }))
      .rejects.toThrow(/Forbidden scheduler update field: action/)
  })

  it("rejects hidden external actions", async () => {
    await expect(dispatchSchedulerAction(serviceMock(), actionRegistry(), "scheduler.task.delete", { taskId: "task:1" }))
      .rejects.toThrow(/Unknown scheduler action/)
  })

  it("scheduler.task.create accepts activeDays and passes to service", async () => {
    const service = serviceMock()
    const result = await dispatchSchedulerAction(service, actionRegistry(), "scheduler.task.create", {
      name: "Weekday task",
      scope: { type: "global" },
      schedule: { type: "cron", expr: "0 9 * * *" },
      action: { type: "builtin.command", config: { command: "echo hi" } },
      activeDays: [1, 2, 3, 4, 5],
    })
    expect(result.ok).toBe(true)
    expect((result.data as { activeDays: number[] }).activeDays).toEqual([1, 2, 3, 4, 5])
  })

  it("scheduler.task.create defaults activeDays to all days when omitted", async () => {
    const service = serviceMock()
    const result = await dispatchSchedulerAction(service, actionRegistry(), "scheduler.task.create", {
      name: "All days task",
      scope: { type: "global" },
      schedule: { type: "cron", expr: "0 9 * * *" },
      action: { type: "builtin.command", config: { command: "echo hi" } },
    })
    expect(result.ok).toBe(true)
    expect((result.data as { activeDays: number[] }).activeDays).toEqual([0, 1, 2, 3, 4, 5, 6])
  })

  it("scheduler.task.create rejects unknown action types before persistence", async () => {
    const service = serviceMock()
    await expect(dispatchSchedulerAction(service, actionRegistry(), "scheduler.task.create", {
      name: "Unknown action",
      scope: { type: "global" },
      schedule: { type: "cron", expr: "0 9 * * *" },
      action: { type: "builtin.missing", config: {} },
    })).rejects.toThrow('Task action "builtin.missing" is not registered')

    expect(service.schedulerTaskCreate).not.toHaveBeenCalled()
  })

  it("scheduler.task.create rejects invalid action config before persistence", async () => {
    const service = serviceMock()
    await expect(dispatchSchedulerAction(service, actionRegistry(), "scheduler.task.create", {
      name: "Invalid config",
      scope: { type: "global" },
      schedule: { type: "cron", expr: "0 9 * * *" },
      action: { type: "builtin.command", config: { command: "" } },
    })).rejects.toThrow()

    expect(service.schedulerTaskCreate).not.toHaveBeenCalled()
  })

  it("scheduler.task.create rejects empty activeDays", async () => {
    const service = serviceMock()
    await expect(dispatchSchedulerAction(service, actionRegistry(), "scheduler.task.create", {
      name: "No days",
      scope: { type: "global" },
      schedule: { type: "cron", expr: "0 9 * * *" },
      action: { type: "builtin.command", config: { command: "echo hi" } },
      activeDays: [],
    })).rejects.toThrow(/activeDays/)
  })

  it("scheduler.task.update can change activeDays", async () => {
    const service = serviceMock()
    const result = await dispatchSchedulerAction(service, actionRegistry(), "scheduler.task.update", {
      taskId: "task:1",
      activeDays: [6, 0],
    })
    expect(result.ok).toBe(true)
    expect((result.data as { activeDays: number[] }).activeDays).toEqual([6, 0])
  })

  it("checks permission and audits allowed scheduler mutations", async () => {
    const service = serviceMock()
    const permissionGuard = permissionGuardMock({ allowed: true })
    const auditSink = auditSinkMock()

    await dispatchSchedulerAction(
      service,
      actionRegistry(),
      "scheduler.task.enable",
      { taskId: "task:1" },
      { source: "mcp-stdio" },
      { permissionGuard, auditSink },
    )

    expect(permissionGuard.check).toHaveBeenCalledWith({
      action: "scheduler.mutate",
      actor: { kind: "user", id: "scheduler-dispatch:mcp-stdio" },
      resource: "scheduler:task:1",
      context: {
        source: "mcp-stdio",
        schedulerAction: "scheduler.task.enable",
        taskId: "task:1",
      },
    })
    expect(service.schedulerTaskEnable).toHaveBeenCalledWith("task:1")
    expect(auditSink.record).toHaveBeenCalledWith(expect.objectContaining({
      action: "scheduler.mutate",
      actor: { kind: "user", id: "scheduler-dispatch:mcp-stdio" },
      resource: "scheduler:task:1",
      outcome: "allowed",
      metadata: expect.objectContaining({
        source: "mcp-stdio",
        schedulerAction: "scheduler.task.enable",
        taskId: "task:1",
      }),
    }))
  })

  it("denies scheduler mutations before persistence", async () => {
    const service = serviceMock()
    const permissionGuard = permissionGuardMock({
      allowed: false,
      reason: "denied by policy",
      policyId: "test-policy",
    })
    const auditSink = auditSinkMock()

    await expect(dispatchSchedulerAction(
      service,
      actionRegistry(),
      "scheduler.task.disable",
      { taskId: "task:1" },
      { source: "mcp-http" },
      { permissionGuard, auditSink },
    )).rejects.toThrow("denied by policy")

    expect(service.schedulerTaskDisable).not.toHaveBeenCalled()
    expect(auditSink.record).toHaveBeenCalledWith(expect.objectContaining({
      action: "scheduler.mutate",
      resource: "scheduler:task:1",
      outcome: "denied",
      metadata: expect.objectContaining({
        reason: "denied by policy",
        policyId: "test-policy",
      }),
    }))
  })

  it("audits failed scheduler mutations without raw error text", async () => {
    const service = serviceMock()
    vi.mocked(service.schedulerTaskEnable).mockRejectedValueOnce(new Error("failed with secret schedule details"))
    const auditSink = auditSinkMock()

    await expect(dispatchSchedulerAction(
      service,
      actionRegistry(),
      "scheduler.task.enable",
      { taskId: "task:1" },
      { source: "api" },
      { permissionGuard: permissionGuardMock({ allowed: true }), auditSink },
    )).rejects.toThrow("failed with secret schedule details")

    expect(auditSink.record).toHaveBeenCalledWith(expect.objectContaining({
      action: "scheduler.mutate",
      resource: "scheduler:task:1",
      outcome: "failed",
      metadata: expect.objectContaining({
        errorName: "Error",
        errorLength: "Error: failed with secret schedule details".length,
      }),
    }))
    expect(JSON.stringify(vi.mocked(auditSink.record).mock.calls)).not.toContain("secret schedule")
  })

  it("does not check permissions for read-only scheduler actions", async () => {
    const permissionGuard = permissionGuardMock({ allowed: true })
    const auditSink = auditSinkMock()

    await dispatchSchedulerAction(
      serviceMock(),
      actionRegistry(),
      "scheduler.task.list",
      {},
      { source: "mcp-stdio" },
      { permissionGuard, auditSink },
    )

    expect(permissionGuard.check).not.toHaveBeenCalled()
    expect(auditSink.record).not.toHaveBeenCalled()
  })
})

function permissionGuardMock(
  result: Awaited<ReturnType<PermissionGuard["check"]>>,
): PermissionGuard {
  return {
    registerPolicy: vi.fn(() => () => {}),
    check: vi.fn(async () => result),
  }
}

function auditSinkMock(): AuditSink {
  return {
    record: vi.fn(),
    list: vi.fn(() => []),
    clearForTests: vi.fn(),
  }
}
