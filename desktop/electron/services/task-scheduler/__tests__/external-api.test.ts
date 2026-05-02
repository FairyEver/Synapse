import { describe, expect, it, vi } from "vitest"

import { dispatchSchedulerAction, toPublicTaskSummary } from "../external-api"
import type { TaskSchedulerService } from "../task-scheduler-service"
import type { ScheduledTaskEntry } from "../types"

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

function serviceMock(): TaskSchedulerService {
  return {
    listTasks: vi.fn(async () => [baseTask, { ...baseTask, id: "task:2", enabled: false }]),
    getTask: vi.fn(async (id: string) => (id === "task:1" ? baseTask : null)),
    createTask: vi.fn(async (input) => ({ ...baseTask, ...input, id: "task:new" })),
    setTaskEnabled: vi.fn(async (_id: string, enabled: boolean) => ({ ...baseTask, enabled })),
  } as unknown as TaskSchedulerService
}

describe("task scheduler external api", () => {
  it("maps list results to public summaries and applies enabled filter", async () => {
    const service = serviceMock()
    const result = await dispatchSchedulerAction(service, "schedulerTaskList", { enabled: true })
    expect(result).toEqual({
      ok: true,
      data: [toPublicTaskSummary(baseTask)],
      total: 1,
    })
  })

  it("gets task detail by taskId only", async () => {
    const service = serviceMock()
    const result = await dispatchSchedulerAction(service, "schedulerTaskGet", { taskId: "task:1" })
    expect(result).toEqual({ ok: true, data: baseTask })
    expect(service.getTask).toHaveBeenCalledWith("task:1")
  })

  it("maps cron schedule to builtin cron trigger on create", async () => {
    const service = serviceMock()
    await dispatchSchedulerAction(service, "schedulerTaskCreate", {
      name: "Daily",
      scope: { type: "global" },
      schedule: { type: "cron", expr: "0 9 * * *", timezone: "Asia/Shanghai" },
      action: { type: "builtin.command", config: { command: "date" } },
    })
    expect(service.createTask).toHaveBeenCalledWith({
      name: "Daily",
      description: undefined,
      scope: { type: "global" },
      cwd: undefined,
      trigger: { type: "builtin.cron", config: { expr: "0 9 * * *", timezone: "Asia/Shanghai" } },
      action: { type: "builtin.command", config: { command: "date" } },
      enabled: undefined,
      missedRunPolicy: undefined,
    })
  })

  it("maps interval schedule to builtin interval trigger on create", async () => {
    const service = serviceMock()
    await dispatchSchedulerAction(service, "schedulerTaskCreate", {
      name: "Every 30",
      scope: { type: "global" },
      schedule: { type: "interval", everyMinutes: 30 },
      action: { type: "builtin.command", config: { command: "date" } },
      enabled: false,
      missedRunPolicy: "run_once",
    })
    expect(service.createTask).toHaveBeenCalledWith(expect.objectContaining({
      trigger: { type: "builtin.interval", config: { everyMinutes: 30, anchor: undefined } },
      enabled: false,
      missedRunPolicy: "run_once",
    }))
  })

  it("enables and disables tasks by id", async () => {
    const service = serviceMock()
    await dispatchSchedulerAction(service, "schedulerTaskEnable", { taskId: "task:1" })
    await dispatchSchedulerAction(service, "schedulerTaskDisable", { taskId: "task:1" })
    expect(service.setTaskEnabled).toHaveBeenNthCalledWith(1, "task:1", true)
    expect(service.setTaskEnabled).toHaveBeenNthCalledWith(2, "task:1", false)
  })

  it("rejects unknown scheduler actions and invalid task ids", async () => {
    const service = serviceMock()
    await expect(dispatchSchedulerAction(service, "schedulerTaskGet", {})).rejects.toThrow(/taskId/)
    await expect(dispatchSchedulerAction(service, "missingSchedulerAction", { taskId: "task:1" })).rejects.toThrow(/Unknown scheduler action/)
  })
})
