import { describe, expect, it } from "vitest"

import { buildAutomationCreateInputFromTask } from "../task-automation-migration"
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
