import { describe, expect, it } from "vitest"
import {
  AutomationCronScheduler,
  AutomationCronStore,
  cronExprToHuman,
  cronJobExecutionTimeoutMs,
  cronJobUsesNewSessionPerRun,
  nextCronRunAfter,
  normalizeCronSessionMode,
} from "../../electron/services/automation-cron-service"

function job(overrides: Partial<Parameters<AutomationCronScheduler["addJob"]>[0]> = {}): Parameters<AutomationCronScheduler["addJob"]>[0] {
  return {
    id: "job-1",
    project: "synapse",
    sessionKey: "telegram:chat:thread",
    cronExpr: "0 6 * * *",
    prompt: "daily summary",
    exec: "",
    workDir: "",
    description: "Daily summary",
    enabled: true,
    sessionMode: "",
    mode: "",
    createdAt: new Date("2026-04-25T00:00:00.000Z"),
    ...overrides,
  }
}

describe("automation cron service", () => {
  it("matches CC Connect timeout and session mode semantics", () => {
    expect(normalizeCronSessionMode("reuse")).toBe("")
    expect(normalizeCronSessionMode("new-per-run")).toBe("new_per_run")
    expect(cronJobUsesNewSessionPerRun({ sessionMode: "new_per_run" })).toBe(true)
    expect(cronJobExecutionTimeoutMs({ timeoutMins: undefined })).toBe(30 * 60 * 1000)
    expect(cronJobExecutionTimeoutMs({ timeoutMins: 0 })).toBe(0)
    expect(cronJobExecutionTimeoutMs({ timeoutMins: 2 })).toBe(2 * 60 * 1000)
  })

  it("validates prompt/exec conflicts, cron expressions, mode, and negative timeout", () => {
    const scheduler = new AutomationCronScheduler()

    expect(() => scheduler.addJob(job({ prompt: "", exec: "" }))).toThrow("either prompt or exec is required")
    expect(() => scheduler.addJob(job({ prompt: "p", exec: "echo hi" }))).toThrow("prompt and exec are mutually exclusive")
    expect(() => scheduler.addJob(job({ cronExpr: "not cron" }))).toThrow("expected 5 fields")
    expect(() => scheduler.addJob(job({ sessionMode: "isolated" as never }))).toThrow("invalid session_mode")
    expect(() => scheduler.addJob(job({ mode: "unsafe" as never }))).toThrow("invalid mode")
    expect(() => scheduler.addJob(job({ timeoutMins: -1 }))).toThrow("timeout_mins")
  })

  it("stores, updates, filters, mutes, and marks runs like CC Connect CronStore", () => {
    const store = new AutomationCronStore()
    store.add(job())
    store.add(job({ id: "job-2", project: "other", sessionKey: "telegram:other", cronExpr: "30 14 * * 1" }))

    expect(store.listByProject("synapse")).toHaveLength(1)
    expect(store.listBySessionKey("telegram:other")).toHaveLength(1)
    expect(store.setEnabled("job-1", false)).toBe(true)
    expect(store.toggleMute("job-1")).toBe(true)

    const updated = store.update("job-1", "cron_expr", "*/15 * * * *")
    expect(updated).toMatchObject({ cronExpr: "*/15 * * * *", enabled: false, mute: true })
    expect(store.update("job-1", "id", "new-id")).toBeNull()

    const runAt = new Date("2026-04-25T12:00:00.000Z")
    expect(store.markRun("job-1", new Error("failed"), runAt)).toBe(true)
    expect(store.get("job-1")).toMatchObject({
      lastRun: runAt,
      lastError: "failed",
    })
  })

  it("computes human-readable descriptions and next runs for common CC cron shapes", () => {
    expect(cronExprToHuman("0 6 * * *", "en")).toBe("Daily at 06:00")
    expect(cronExprToHuman("0 6 * * *", "zh")).toBe("每天 06:00")
    expect(cronExprToHuman("30 14 * * 1", "en")).toBe("Every Monday at 14:30")
    expect(cronExprToHuman("*/5 * * * *", "en")).toBe("Every 5 min")
    expect(cronExprToHuman("*/15 * * * *", "ja")).toBe("15分ごと")
    expect(cronExprToHuman("0 */2 * * *", "en")).toBe("Every 2 h (:00)")
    expect(cronExprToHuman("0 0 1 * *", "en")).toBe("Monthly, day 1, 00:00")

    const nextQuarter = nextCronRunAfter("*/15 * * * *", new Date(2026, 3, 25, 10, 7, 30))
    expect([nextQuarter.getHours(), nextQuarter.getMinutes()]).toEqual([10, 15])

    const nextWeekday = nextCronRunAfter("0 9 * * 1-5", new Date(2026, 3, 25, 10, 0, 0))
    expect([nextWeekday.getDay(), nextWeekday.getHours(), nextWeekday.getMinutes()]).toEqual([1, 9, 0])
  })

  it("creates permission-gated exec plans without executing shell commands", () => {
    const scheduler = new AutomationCronScheduler()
    scheduler.setDefaultSessionMode("new_per_run")
    scheduler.addJob(job({
      exec: "df -h",
      prompt: "",
      workDir: "/repo",
      timeoutMins: 0,
      silent: true,
      mute: true,
      mode: "acceptEdits",
    }))

    const nextRun = scheduler.nextRun("job-1", new Date(2026, 3, 25, 5, 59, 0))
    expect(nextRun ? [nextRun.getHours(), nextRun.getMinutes()] : null).toEqual([6, 0])
    expect(scheduler.createExecutionPlan("job-1")).toEqual({
      jobId: "job-1",
      action: "exec",
      project: "synapse",
      sessionKey: "telegram:chat:thread",
      content: "df -h",
      workDir: "/repo",
      mode: "acceptEdits",
      timeoutMs: 0,
      silent: true,
      mute: true,
      newSessionPerRun: true,
      requiresPermission: true,
    })
  })
})
