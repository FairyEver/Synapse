import { describe, expect, it } from "vitest"

import {
  buildTaskCreateInput,
  createTaskFormState,
  parseTaskEnv,
  stringifyTaskEnv,
} from "../utils"
import type { ScheduledTask } from "@/types/task-scheduler"

describe("task scheduler utils", () => {
  it("parses env text into key value pairs", () => {
    expect(parseTaskEnv("FOO=bar\nEMPTY=\n SPACED =kept")).toEqual({
      FOO: "bar",
      EMPTY: "",
      SPACED: "kept",
    })
  })

  it("rejects invalid env lines", () => {
    expect(() => parseTaskEnv("BROKEN")).toThrow(/KEY=value/)
  })

  it("builds a cron shell task payload", () => {
    const payload = buildTaskCreateInput({
      ...createTaskFormState(undefined, "project-1"),
      name: "Backup",
      scopeType: "project",
      actionContent: "echo ok",
      envText: "NODE_ENV=production",
      missedRunPolicy: "run_once",
    })

    expect(payload).toMatchObject({
      name: "Backup",
      scope: { type: "project", projectId: "project-1" },
      trigger: { type: "cron", expr: "0 9 * * *" },
      action: {
        type: "shell_command",
        mode: "command",
        shell: "posix",
        content: "echo ok",
        env: { NODE_ENV: "production" },
        timeoutMins: 30,
      },
      missedRunPolicy: "run_once",
    })
  })

  it("hydrates form state from an interval task", () => {
    const task: ScheduledTask = {
      id: "task-1",
      schemaVersion: 1,
      name: "Sync",
      scope: { type: "global" },
      trigger: { type: "interval", everyMinutes: 15, anchor: "last_completed_at" },
      action: {
        type: "shell_command",
        mode: "script",
        shell: "powershell",
        content: "echo sync",
        env: { A: "1" },
        timeoutMins: null,
      },
      enabled: false,
      missedRunPolicy: "skip",
      overlapPolicy: "skip",
      createdAt: "2026-04-29T00:00:00.000Z",
      updatedAt: "2026-04-29T00:00:00.000Z",
      runCount: 0,
    }

    expect(createTaskFormState(task)).toMatchObject({
      name: "Sync",
      triggerType: "interval",
      everyMinutes: "15",
      intervalAnchor: "last_completed_at",
      actionMode: "script",
      actionShell: "powershell",
      timeoutEnabled: false,
      envText: stringifyTaskEnv({ A: "1" }),
    })
  })

  it("defaults new Windows tasks to cmd", () => {
    expect(createTaskFormState(undefined, "", "win32").actionShell).toBe("cmd")
  })
})
