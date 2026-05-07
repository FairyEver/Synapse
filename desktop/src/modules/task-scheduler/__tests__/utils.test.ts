import { describe, expect, it } from "vitest"

import {
  buildTaskCreateInput,
  createTaskFormState,
  DEFAULT_TASK_FORM_STATE,
} from "../utils"
import type { ScheduledTask } from "@/types/task-scheduler"

describe("task scheduler utils", () => {
  it("builds a cron command task payload", () => {
    const payload = buildTaskCreateInput({
      ...DEFAULT_TASK_FORM_STATE,
      name: "Backup",
      actionType: "builtin.command",
      actionConfig: {
        command: "echo ok",
        shell: "posix",
        timeoutMins: 30,
      },
      missedRunPolicy: "run_once",
    })

    expect(payload).toMatchObject({
      name: "Backup",
      scope: { type: "global" },
      trigger: { type: "builtin.cron", config: { expr: "0 9 * * *" } },
      action: {
        type: "builtin.command",
        config: {
          command: "echo ok",
          shell: "posix",
          timeoutMins: 30,
        },
      },
      missedRunPolicy: "run_once",
    })
  })

  it("builds an HTTP request action payload", () => {
    expect(buildTaskCreateInput({
      ...DEFAULT_TASK_FORM_STATE,
      name: "Ping API",
      actionType: "builtin.http-request",
      actionConfig: {
        method: "POST",
        url: "https://example.com/api",
        bodyType: "json",
        body: "{\"ok\":true}",
        timeoutMins: 5,
      },
    }).action).toEqual({
      type: "builtin.http-request",
      config: {
        method: "POST",
        url: "https://example.com/api",
        bodyType: "json",
        body: "{\"ok\":true}",
        timeoutMins: 5,
      },
    })
  })

  it("hydrates form state from an interval task", () => {
    const task: ScheduledTask = {
      id: "task-1",
      schemaVersion: 2,
      name: "Sync",
      scope: { type: "global" },
      trigger: {
        type: "builtin.interval",
        config: { everyMinutes: 15, anchor: "last_completed_at" },
      },
      action: {
        type: "builtin.script",
        config: {
          script: "echo sync",
          shell: "powershell",
          env: { A: "1" },
          timeoutMins: null,
        },
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
      actionType: "builtin.script",
      actionConfig: {
        script: "echo sync",
        shell: "powershell",
        env: { A: "1" },
        timeoutMins: null,
      },
    })
  })

  it("defaults new tasks to command actions", () => {
    expect(createTaskFormState().actionType).toBe("builtin.command")
  })

  it("derives project scope from agent action config", () => {
    const payload = buildTaskCreateInput({
      ...DEFAULT_TASK_FORM_STATE,
      name: "Agent Task",
      actionType: "builtin.agent",
      actionConfig: {
        projectId: "project-1",
        agentType: "claude-code",
        mode: "auto",
        prompt: "hello",
        sessionPolicy: "fresh",
      },
    })

    expect(payload.scope).toEqual({ type: "project", projectId: "project-1" })
  })
})
