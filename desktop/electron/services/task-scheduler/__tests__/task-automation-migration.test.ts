import { describe, expect, it, vi } from "vitest"

import {
  buildAutomationCreateInputFromTask,
  migrateTaskToAutomation,
} from "../task-automation-migration"
import type { ScheduledTaskEntry } from "../types"

describe("task automation migration mapping", () => {
  it("maps an enabled cron task to an enabled automation with active days in trigger config", () => {
    const input = buildAutomationCreateInputFromTask(createTask({
      enabled: true,
      validation: { status: "valid", issues: [] },
      trigger: { type: "builtin.cron", config: { expr: "0 9 * * *", timezone: "Asia/Shanghai" } },
      activeDays: [1, 2, 3, 4, 5],
    }))

    expect(input).toEqual({
      name: "Daily build",
      description: "Build project",
      enabled: true,
      scope: { type: "project", projectId: "project-1" },
      cwd: "/Users/test/project",
      trigger: {
        type: "builtin.cron",
        config: {
          expr: "0 9 * * *",
          timezone: "Asia/Shanghai",
          activeDays: [1, 2, 3, 4, 5],
        },
      },
      executor: { type: "builtin.command", config: { command: "echo ok", shell: "posix" } },
      policy: { missedRunPolicy: "skip", overlapPolicy: "skip" },
    })
  })

  it("maps interval tasks and disables automations when source task needs update", () => {
    const input = buildAutomationCreateInputFromTask(createTask({
      enabled: true,
      validation: {
        status: "needs_update",
        issues: [{ field: "action.config.command", message: "命令不能为空" }],
      },
      trigger: { type: "builtin.interval", config: { everyMinutes: 30, anchor: "last_completed_at" } },
      activeDays: [0, 6],
      missedRunPolicy: "run_once",
    }))

    expect(input.enabled).toBe(false)
    expect(input.trigger).toEqual({
      type: "builtin.interval",
      config: {
        everyMinutes: 30,
        anchor: "last_completed_at",
        activeDays: [0, 6],
      },
    })
    expect(input.policy).toEqual({ missedRunPolicy: "run_once", overlapPolicy: "skip" })
  })

  it("keeps disabled source tasks disabled after migration", () => {
    const input = buildAutomationCreateInputFromTask(createTask({ enabled: false }))

    expect(input.enabled).toBe(false)
  })
})

describe("migrateTaskToAutomation", () => {
  it("creates automation then deletes the source task", async () => {
    const harness = createMigrationHarness()

    await expect(migrateTaskToAutomation({ taskId: "task:1", ...harness.deps }))
      .resolves.toEqual({ automationId: "automation:1", deletedTaskId: "task:1" })

    expect(harness.automation.automationCreate).toHaveBeenCalledWith(expect.objectContaining({
      name: "Daily build",
      executor: { type: "builtin.command", config: { command: "echo ok", shell: "posix" } },
    }))
    expect(harness.scheduler.deleteTask).toHaveBeenCalledWith("task:1")
  })

  it("stops a running task before migration", async () => {
    const harness = createMigrationHarness({
      task: createTask({ activeRun: { status: "running", id: "run:1" } }),
    })

    await migrateTaskToAutomation({ taskId: "task:1", ...harness.deps })

    expect(harness.scheduler.stopRun).toHaveBeenCalledWith("run:1")
    expect(harness.automation.automationCreate).toHaveBeenCalled()
    expect(harness.scheduler.deleteTask).toHaveBeenCalledWith("task:1")
  })

  it("does not create automation when stopping the active run fails", async () => {
    const harness = createMigrationHarness({
      task: createTask({ activeRun: { status: "running", id: "run:1" } }),
      stopResult: { stopped: false },
    })

    await expect(migrateTaskToAutomation({ taskId: "task:1", ...harness.deps }))
      .rejects.toThrow("停止运行失败")

    expect(harness.automation.automationCreate).not.toHaveBeenCalled()
    expect(harness.scheduler.deleteTask).not.toHaveBeenCalled()
  })

  it("keeps the source task when automation creation fails", async () => {
    const harness = createMigrationHarness({
      createError: new Error("create failed"),
    })

    await expect(migrateTaskToAutomation({ taskId: "task:1", ...harness.deps }))
      .rejects.toThrow("create failed")

    expect(harness.scheduler.deleteTask).not.toHaveBeenCalled()
  })

  it("rolls back automation when deleting the source task fails", async () => {
    const harness = createMigrationHarness({
      deleteError: new Error("delete failed"),
    })

    await expect(migrateTaskToAutomation({ taskId: "task:1", ...harness.deps }))
      .rejects.toThrow("delete failed")

    expect(harness.automation.automationDelete).toHaveBeenCalledWith("automation:1")
  })

  it("disables both records when rollback delete also fails", async () => {
    const harness = createMigrationHarness({
      deleteError: new Error("delete failed"),
      rollbackError: new Error("rollback failed"),
    })

    await expect(migrateTaskToAutomation({ taskId: "task:1", ...harness.deps }))
      .rejects.toThrow("delete failed")

    expect(harness.automation.automationDisable).toHaveBeenCalledWith("automation:1")
    expect(harness.scheduler.schedulerTaskDisable).toHaveBeenCalledWith("task:1")
  })
})

function createTask(overrides: Partial<ScheduledTaskEntry> = {}): ScheduledTaskEntry {
  return {
    id: "task:1",
    schemaVersion: 2,
    name: "Daily build",
    description: "Build project",
    scope: { type: "project", projectId: "project-1" },
    cwd: "/Users/test/project",
    trigger: { type: "builtin.interval", config: { everyMinutes: 10 } },
    action: { type: "builtin.command", config: { command: "echo ok", shell: "posix" } },
    enabled: true,
    activeDays: [0, 1, 2, 3, 4, 5, 6],
    missedRunPolicy: "skip",
    overlapPolicy: "skip",
    createdAt: "2026-06-09T00:00:00.000Z",
    updatedAt: "2026-06-09T00:00:00.000Z",
    runCount: 0,
    ...overrides,
  }
}

function createMigrationHarness(options: {
  task?: ScheduledTaskEntry | null
  stopResult?: { stopped: boolean }
  createError?: Error
  deleteError?: Error
  rollbackError?: Error
} = {}) {
  const task = options.task === undefined ? createTask() : options.task
  const scheduler = {
    schedulerTaskGet: vi.fn(async () => task),
    stopRun: vi.fn(async () => options.stopResult ?? { stopped: true }),
    deleteTask: vi.fn(async () => {
      if (options.deleteError) throw options.deleteError
      return { deleted: true }
    }),
    schedulerTaskDisable: vi.fn(async () => createTask({ enabled: false })),
  }
  const automation = {
    automationCreate: vi.fn(async () => {
      if (options.createError) throw options.createError
      return { id: "automation:1", enabled: true }
    }),
    automationDelete: vi.fn(async () => {
      if (options.rollbackError) throw options.rollbackError
      return { deleted: true }
    }),
    automationDisable: vi.fn(async () => ({ id: "automation:1", enabled: false })),
  }
  const logger = {
    info: vi.fn(),
    warn: vi.fn(),
  }
  return {
    scheduler,
    automation,
    deps: {
      scheduler: scheduler as never,
      automation: automation as never,
      logger,
    },
  }
}
