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

  it("computes interval next runs from last_completed_at anchor", () => {
    expect(computeNextRunAt({
      trigger: { type: "builtin.interval", config: { everyMinutes: 60, anchor: "last_completed_at" } },
      from: new Date("2026-04-29T10:05:00"),
      createdAt: "2026-04-29T09:00:00",
    }).toISOString()).toBe(new Date("2026-04-29T11:05:00").toISOString())
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

  it("computes cron next run with timezone", () => {
    // "0 12 * * *" in America/New_York (UTC-4 in May 2026)
    // from = 2026-05-08T15:00:00Z = 11:00 EDT
    // next = 12:00 EDT = 2026-05-08T16:00:00Z
    expect(computeNextRunAt({
      trigger: { type: "builtin.cron", config: { expr: "0 12 * * *", timezone: "America/New_York" } },
      from: new Date("2026-05-08T15:00:00Z"),
      createdAt: "2026-05-08T00:00:00Z",
    }).toISOString()).toBe(new Date("2026-05-08T16:00:00Z").toISOString())
  })

  it("computes cron next run in Asia/Shanghai timezone", () => {
    // "0 9 * * *" in Asia/Shanghai (UTC+8)
    // from = 2026-05-08T00:30:00Z = 08:30 CST
    // next = 09:00 CST = 2026-05-08T01:00:00Z
    expect(computeNextRunAt({
      trigger: { type: "builtin.cron", config: { expr: "0 9 * * *", timezone: "Asia/Shanghai" } },
      from: new Date("2026-05-08T00:30:00Z"),
      createdAt: "2026-05-08T00:00:00Z",
    }).toISOString()).toBe(new Date("2026-05-08T01:00:00Z").toISOString())
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
