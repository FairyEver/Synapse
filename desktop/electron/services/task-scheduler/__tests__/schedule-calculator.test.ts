import { describe, expect, it } from "vitest"

import { computeNextRunAt, resolveStartupSchedule } from "../schedule-calculator"

describe("task scheduler schedule calculator", () => {
  it("computes local cron next runs", () => {
    expect(computeNextRunAt({
      trigger: { type: "builtin.cron", config: { expr: "*/30 * * * *" } },
      from: new Date("2026-04-29T10:01:00"),
      createdAt: "2026-04-29T09:00:00",
    }).toISOString()).toBe(new Date("2026-04-29T10:30:00").toISOString())
  })

  it("computes interval next runs from creation anchor", () => {
    expect(computeNextRunAt({
      trigger: { type: "builtin.interval", config: { everyMinutes: 10, anchor: "created_at" } },
      from: new Date("2026-04-29T10:07:00"),
      createdAt: "2026-04-29T10:02:00",
    }).toISOString()).toBe(new Date("2026-04-29T10:12:00").toISOString())
  })

  it("skips missed runs by default", () => {
    expect(resolveStartupSchedule({
      enabled: true,
      nextRunAt: "2026-04-29T02:00:00.000Z",
      missedRunPolicy: "skip",
      trigger: { type: "builtin.interval", config: { everyMinutes: 60 } },
      createdAt: "2026-04-29T00:00:00.000Z",
      now: new Date("2026-04-29T09:00:00.000Z"),
    })).toEqual({ action: "schedule_next" })
  })

  it("runs once for missed run policy", () => {
    expect(resolveStartupSchedule({
      enabled: true,
      nextRunAt: "2026-04-29T02:00:00.000Z",
      missedRunPolicy: "run_once",
      trigger: { type: "builtin.interval", config: { everyMinutes: 60 } },
      createdAt: "2026-04-29T00:00:00.000Z",
      now: new Date("2026-04-29T09:00:00.000Z"),
    })).toEqual({ action: "run_missed_once" })
  })
})
