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

  it("does not run missed tasks when persisted nextRunAt is invalid", () => {
    expect(resolveStartupSchedule({
      enabled: true,
      nextRunAt: "not-a-date",
      missedRunPolicy: "run_once",
      trigger: { type: "builtin.interval", config: { everyMinutes: 60 } },
      createdAt: "2026-04-29T00:00:00.000Z",
      now: new Date("2026-04-29T09:00:00.000Z"),
    })).toEqual({ action: "schedule_next" })
  })
})

describe("activeDays filtering", () => {
  it("returns candidate unchanged when activeDays includes the weekday", () => {
    // 2026-05-11 is Monday (day 1) in UTC
    // cron "0 9 * * *" in UTC, from 08:00 UTC -> next = 09:00 UTC same day (Monday)
    const result = computeNextRunAt({
      trigger: { type: "builtin.cron", config: { expr: "0 9 * * *", timezone: "UTC" } },
      from: new Date("2026-05-11T08:00:00Z"),
      createdAt: "2026-05-01T00:00:00Z",
      activeDays: [1, 2, 3, 4, 5],
    })
    expect(result.toISOString()).toBe("2026-05-11T09:00:00.000Z")
  })

  it("skips to next valid day for cron when candidate falls on excluded day", () => {
    // 2026-05-08 is Friday (5). From 2026-05-08T10:00:00Z,
    // next cron "0 9 * * *" UTC = 2026-05-09 09:00 UTC (Saturday, day 6)
    // Saturday excluded, activeDays = Mon-Fri [1,2,3,4,5]
    // Should skip to Monday 2026-05-11 09:00 UTC
    const result = computeNextRunAt({
      trigger: { type: "builtin.cron", config: { expr: "0 9 * * *", timezone: "UTC" } },
      from: new Date("2026-05-08T10:00:00Z"),
      createdAt: "2026-05-01T00:00:00Z",
      activeDays: [1, 2, 3, 4, 5],
    })
    expect(result.toISOString()).toBe("2026-05-11T09:00:00.000Z")
  })

  it("skips to next valid day for interval when candidate falls on excluded day", () => {
    const previousTimezone = process.env.TZ
    process.env.TZ = "UTC"
    try {
      // 2026-05-09 is Saturday (day 6), interval every 60 min from created_at
      // activeDays = [1] (Monday only)
      // Raw candidate: anchor=Sat 08:00, from=Sat 08:30, elapsed=30min, steps=floor(30/60)+1=1
      //   next = Sat 08:00 + 60min = Sat 09:00 (day 6, excluded)
      // Advance to Monday 2026-05-11: from = 2026-05-10T23:59:00Z
      // Recompute: from=Sun 23:59, anchor=Sat 08:00
      //   elapsed = 2399min, steps=floor(2399/60)+1=40
      //   next = Sat 08:00 + 40*60min = Sat 08:00 + 2400min = Mon 00:00 = 2026-05-11T00:00:00Z
      const result = computeNextRunAt({
        trigger: { type: "builtin.interval", config: { everyMinutes: 60, anchor: "created_at" } },
        from: new Date("2026-05-09T08:30:00Z"),
        createdAt: "2026-05-09T08:00:00Z",
        activeDays: [1],
      })
      expect(result.toISOString()).toBe("2026-05-11T00:00:00.000Z")
    } finally {
      if (previousTimezone === undefined) {
        delete process.env.TZ
      } else {
        process.env.TZ = previousTimezone
      }
    }
  })

  it("uses local weekdays for interval activeDays", () => {
    const previousTimezone = process.env.TZ
    process.env.TZ = "Asia/Shanghai"
    try {
      // Candidate is 2026-05-11 01:00 in Asia/Shanghai (Monday),
      // but still 2026-05-10 17:00 UTC (Sunday).
      const result = computeNextRunAt({
        trigger: { type: "builtin.interval", config: { everyMinutes: 60, anchor: "created_at" } },
        from: new Date("2026-05-10T16:30:00.000Z"),
        createdAt: "2026-05-10T15:00:00.000Z",
        activeDays: [1],
      })

      expect(result.toISOString()).toBe("2026-05-10T17:00:00.000Z")
    } finally {
      if (previousTimezone === undefined) {
        delete process.env.TZ
      } else {
        process.env.TZ = previousTimezone
      }
    }
  })

  it("treats all-days activeDays same as no constraint", () => {
    const withAll = computeNextRunAt({
      trigger: { type: "builtin.cron", config: { expr: "0 9 * * *", timezone: "UTC" } },
      from: new Date("2026-05-10T08:00:00Z"),
      createdAt: "2026-05-01T00:00:00Z",
      activeDays: [0, 1, 2, 3, 4, 5, 6],
    })
    const without = computeNextRunAt({
      trigger: { type: "builtin.cron", config: { expr: "0 9 * * *", timezone: "UTC" } },
      from: new Date("2026-05-10T08:00:00Z"),
      createdAt: "2026-05-01T00:00:00Z",
    })
    expect(withAll.toISOString()).toBe(without.toISOString())
  })

  it("handles timezone-aware weekday check for cron", () => {
    // 2026-05-11 00:30 UTC = 2026-05-11 08:30 Asia/Shanghai (Monday, day 1)
    // activeDays = [1] (Monday only)
    // cron "0 9 * * *" in Asia/Shanghai -> 09:00 Shanghai = 01:00 UTC on Monday
    const result = computeNextRunAt({
      trigger: { type: "builtin.cron", config: { expr: "0 9 * * *", timezone: "Asia/Shanghai" } },
      from: new Date("2026-05-11T00:30:00Z"),
      createdAt: "2026-05-01T00:00:00Z",
      activeDays: [1],
    })
    expect(result.toISOString()).toBe("2026-05-11T01:00:00.000Z")
  })

  it("skips weekend for timezone-aware cron", () => {
    // 2026-05-08 is Friday (5) in Shanghai
    // From 2026-05-08T14:00:00Z = 2026-05-08 22:00 Shanghai (Friday)
    // Next cron "0 9 * * *" Shanghai = 2026-05-09 09:00 Shanghai = 2026-05-09T01:00:00Z (Saturday, day 6)
    // Saturday excluded, activeDays = [1,2,3,4,5]
    // Sunday (0) also excluded
    // Should skip to Monday 2026-05-11 09:00 Shanghai = 2026-05-11T01:00:00Z
    const result = computeNextRunAt({
      trigger: { type: "builtin.cron", config: { expr: "0 9 * * *", timezone: "Asia/Shanghai" } },
      from: new Date("2026-05-08T14:00:00Z"),
      createdAt: "2026-05-01T00:00:00Z",
      activeDays: [1, 2, 3, 4, 5],
    })
    expect(result.toISOString()).toBe("2026-05-11T01:00:00.000Z")
  })
})
