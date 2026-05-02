import { z } from "zod"
import { describe, expect, it, vi } from "vitest"

import {
  MainActionRegistry,
  type ActionExecutionInput,
  type MainActionDefinition,
} from "../../../action-runtime/action-registry"
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
  createdAt: "2026-05-02T00:00:00.000Z",
  updatedAt: "2026-05-02T00:00:00.000Z",
  nextRunAt: "2026-05-02T00:30:00.000Z",
  runCount: 0,
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
    listTasks: vi.fn(async () => [baseTask, { ...baseTask, id: "task:2", enabled: false }]),
    getTask: vi.fn(async (id: string) => (id === "task:1" ? baseTask : null)),
    createTask: vi.fn(async (input) => ({ ...baseTask, ...input, id: "task:new" })),
    updateTask: vi.fn(async (_id, patch) => ({
      ...baseTask,
      ...patch,
      updatedAt: "2026-05-02T00:20:00.000Z",
    })),
    setTaskEnabled: vi.fn(async (_id: string, enabled: boolean) => ({ ...baseTask, enabled })),
    listRuns: vi.fn(async () => [baseRun]),
    inspect: vi.fn(() => ({ timers: ["task:1"], runningTaskIds: ["task:2"] })),
  } as unknown as TaskSchedulerService
}

function actionRegistry(): MainActionRegistry {
  const registry = new MainActionRegistry()
  registry.register(testAction())
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
    }),
    execute: async (_input: ActionExecutionInput<TestActionConfig>) => ({ status: "success" }),
  }
}

describe("task scheduler external api", () => {
  it("keeps list/get/create/enable/disable behavior", async () => {
    const service = serviceMock()
    const actions = actionRegistry()

    await expect(dispatchSchedulerAction(service, actions, "schedulerTaskList", { enabled: true }))
      .resolves.toEqual({ ok: true, data: [toPublicTaskSummary(baseTask)], total: 1 })
    await expect(dispatchSchedulerAction(service, actions, "schedulerTaskGet", { taskId: "task:1" }))
      .resolves.toEqual({ ok: true, data: baseTask })
    await dispatchSchedulerAction(service, actions, "schedulerTaskEnable", { taskId: "task:1" })
    await dispatchSchedulerAction(service, actions, "schedulerTaskDisable", { taskId: "task:1" })
    expect(service.setTaskEnabled).toHaveBeenNthCalledWith(1, "task:1", true)
    expect(service.setTaskEnabled).toHaveBeenNthCalledWith(2, "task:1", false)
  })

  it("lists run summaries without log payloads", async () => {
    const service = serviceMock()
    const result = await dispatchSchedulerAction(service, actionRegistry(), "schedulerTaskRunsList", {
      taskId: "task:1",
    })

    expect(service.listRuns).toHaveBeenCalledWith("task:1", { limit: 20 })
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
    const all = await dispatchSchedulerAction(service, actionRegistry(), "schedulerTaskRuntimeStatus", {})
    expect(all).toEqual(expect.objectContaining({
      ok: true,
      data: expect.objectContaining({
        runningTaskIds: ["task:2"],
        scheduledTaskIds: ["task:1"],
      }),
    }))

    const one = await dispatchSchedulerAction(service, actionRegistry(), "schedulerTaskRuntimeStatus", {
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
    const result = await dispatchSchedulerAction(serviceMock(), actionRegistry(), "schedulerActionTypesList", {})
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
    await dispatchSchedulerAction(service, actionRegistry(), "schedulerTaskUpdate", {
      taskId: "task:1",
      name: "Updated",
      schedule: { type: "cron", expr: "0 9 * * *", timezone: "Asia/Shanghai" },
      missedRunPolicy: "run_once",
    })

    expect(service.updateTask).toHaveBeenCalledWith("task:1", {
      name: "Updated",
      description: undefined,
      cwd: undefined,
      trigger: { type: "builtin.cron", config: { expr: "0 9 * * *", timezone: "Asia/Shanghai" } },
      missedRunPolicy: "run_once",
    })
  })

  it("rejects empty and forbidden update patches", async () => {
    const service = serviceMock()
    const actions = actionRegistry()
    await expect(dispatchSchedulerAction(service, actions, "schedulerTaskUpdate", { taskId: "task:1" }))
      .rejects.toThrow(/at least one field/)
    await expect(dispatchSchedulerAction(service, actions, "schedulerTaskUpdate", {
      taskId: "task:1",
      action: { type: "builtin.command", config: { command: "rm -rf /tmp/x" } },
    }))
      .rejects.toThrow(/Forbidden scheduler update field: action/)
  })

  it("rejects hidden external actions", async () => {
    await expect(dispatchSchedulerAction(serviceMock(), actionRegistry(), "schedulerTaskDelete", { taskId: "task:1" }))
      .rejects.toThrow(/Unknown scheduler action/)
  })
})
