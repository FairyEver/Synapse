import { afterEach, describe, expect, it } from "vitest"

import { computeNextRunAt } from "../schedule-calculator"

describe("automation schedule calculator", () => {
  it.each(["created_at", "last_completed_at"] as const)("returns no plan when the %s interval exceeds the date range", (anchor) => {
    for (const conditions of [undefined, { operator: "and" as const, items: [{ type: "daily-time-range" as const, start: "00:00", end: "24:00" }] }]) {
      expect(computeNextRunAt({
        trigger: { type: "builtin.interval", config: { everyMinutes: Number.MAX_SAFE_INTEGER, anchor } },
        conditions,
        from: new Date("2026-11-06T00:00:00Z"),
        createdAt: "2026-11-06T00:00:00Z",
      })).toBeNull()
    }
  })

  it("computes the next cron run with active days", () => {
    const next = computeNextRunAt({
      trigger: {
        type: "builtin.cron",
        config: { expr: "0 9 * * *" },
      },
      conditions: { operator: "and", items: [{ type: "weekdays", days: [1] }] },
      from: new Date("2026-06-02T10:00:00.000Z"),
      createdAt: "2026-06-01T00:00:00.000Z",
    })

    expect(next?.getDay()).toBe(1)
    expect(next?.getTime()).toBeGreaterThan(new Date("2026-06-02T10:00:00.000Z").getTime())
  })

  it("computes created_at interval runs", () => {
    const next = computeNextRunAt({
      trigger: {
        type: "builtin.interval",
        config: { everyMinutes: 30, anchor: "created_at" },
      },
      from: new Date("2026-06-03T00:40:00.000Z"),
      createdAt: "2026-06-03T00:00:00.000Z",
    })

    expect(next?.toISOString()).toBe("2026-06-03T01:00:00.000Z")
  })

  it("computes last_completed_at interval runs", () => {
    const next = computeNextRunAt({
      trigger: {
        type: "builtin.interval",
        config: { everyMinutes: 30, anchor: "last_completed_at" },
      },
      from: new Date("2026-06-03T00:40:00.000Z"),
      createdAt: "2026-06-03T00:00:00.000Z",
    })

    expect(next?.toISOString()).toBe("2026-06-03T01:10:00.000Z")
  })

  it("uses the earliest run allowed by or conditions", () => {
    const next = computeNextRunAt({
      trigger: { type: "builtin.cron", config: { expr: "0 9,10 * * *", timezone: "UTC" } },
      conditions: { operator: "or", items: [
        { type: "weekdays", days: [1] },
        { type: "daily-time-range", start: "10:00", end: "11:00" },
      ] },
      from: new Date("2026-11-01T09:30:00Z"),
      createdAt: "2026-10-31T00:00:00Z",
    })

    expect(next?.toISOString()).toBe("2026-11-01T10:00:00.000Z")
  })
})

const originalTimezone = process.env.TZ
afterEach(() => {
  if (originalTimezone === undefined) delete process.env.TZ
  else process.env.TZ = originalTimezone
})

describe("automation daily time range", () => {
  it.each(["created_at", "last_completed_at"] as const)("preserves %s interval cadence before a window", (anchor) => {
    process.env.TZ = "UTC"
    const next = computeNextRunAt({
      trigger: { type: "builtin.interval", config: {
        everyMinutes: 60, anchor,
      } },
      conditions: { operator: "and", items: [
        { type: "weekdays", days: [1, 2, 3, 4, 5] },
        { type: "daily-time-range", start: "08:00", end: "17:00" },
      ] },
      from: new Date("2026-10-23T07:30:00Z"),
      createdAt: "2026-10-23T07:30:00Z",
    })
    expect(next?.toISOString()).toBe("2026-10-23T08:30:00.000Z")
  })

  it("keeps an interval candidate later in the current minute, including milliseconds", () => {
    process.env.TZ = "UTC"
    expect(computeNextRunAt({
      trigger: { type: "builtin.interval", config: {
        everyMinutes: 60, anchor: "created_at",
      } }, conditions: { operator: "and", items: [
        { type: "weekdays", days: [1, 2, 3, 4, 5] },
        { type: "daily-time-range", start: "08:30", end: "08:31" },
      ] }, from: new Date("2026-10-23T08:30:00Z"), createdAt: "2026-10-23T07:30:30.500Z",
    })?.toISOString()).toBe("2026-10-23T08:30:30.500Z")
  })

  it("bounds calendar work when a daily cadence misses a nearly full-day window", () => {
    process.env.TZ = "UTC"
    const getFullYear = Date.prototype.getFullYear
    let calendarReads = 0
    Date.prototype.getFullYear = function () {
      calendarReads += 1
      return getFullYear.call(this)
    }
    try {
      expect(computeNextRunAt({
        trigger: { type: "builtin.interval", config: {
          everyMinutes: 1440, anchor: "created_at",
        } }, conditions: { operator: "and", items: [
          { type: "daily-time-range", start: "00:01", end: "24:00" },
        ] }, from: new Date("2026-10-23T00:00:00Z"), createdAt: "2026-10-22T00:00:00Z",
      })).toBeNull()
      // Budget calendar work by days, avoiding a timing assertion that varies by machine.
      expect(calendarReads).toBeLessThan(50_000)
    } finally { Date.prototype.getFullYear = getFullYear }
  })

  it.each(["created_at", "last_completed_at"] as const)("skips the end and weekend without resetting %s cadence", (anchor) => {
    process.env.TZ = "UTC"
    const next = computeNextRunAt({
      trigger: { type: "builtin.interval", config: {
        everyMinutes: 60, anchor,
      } },
      conditions: { operator: "and", items: [
        { type: "weekdays", days: [1, 2, 3, 4, 5] },
        { type: "daily-time-range", start: "08:00", end: "17:00" },
      ] },
      from: new Date("2026-10-23T16:00:00Z"),
      createdAt: "2026-10-23T07:00:00Z",
    })
    expect(next?.toISOString()).toBe("2026-10-26T08:00:00.000Z")
  })

  it.each([
    ["2026-10-23T07:59:30Z", "2026-10-23T08:00:00.000Z"],
    ["2026-10-23T08:00:00Z", "2026-10-23T08:01:00.000Z"],
    ["2026-10-23T16:59:00Z", "2026-10-26T08:00:00.000Z"],
  ])("filters cron boundaries from %s", (from, expected) => {
    const next = computeNextRunAt({
      trigger: { type: "builtin.cron", config: {
        expr: "* * * * *", timezone: "UTC",
      } }, conditions: { operator: "and", items: [
        { type: "weekdays", days: [1, 2, 3, 4, 5] },
        { type: "daily-time-range", start: "08:00", end: "17:00" },
      ] }, from: new Date(from), createdAt: "2026-10-01T00:00:00Z",
    })
    expect(next?.toISOString()).toBe(expected)
  })

  it("uses the cron timezone for both the weekday and range", () => {
    const next = computeNextRunAt({
      trigger: { type: "builtin.cron", config: {
        expr: "0 * * * *", timezone: "Asia/Shanghai",
      } }, conditions: { operator: "and", items: [
        { type: "weekdays", days: [1] },
        { type: "daily-time-range", start: "08:00", end: "17:00" },
      ] }, from: new Date("2026-10-25T23:30:00Z"), createdAt: "2026-10-01T00:00:00Z",
    })
    expect(next?.toISOString()).toBe("2026-10-26T00:00:00.000Z")
  })

  it("allows midnight through an explicit 00:00–24:00 range", () => {
    const next = computeNextRunAt({
      trigger: { type: "builtin.cron", config: {
        expr: "0 0 * * *", timezone: "UTC",
      } }, conditions: { operator: "and", items: [
        { type: "daily-time-range", start: "00:00", end: "24:00" },
      ] }, from: new Date("2026-10-23T23:59:00Z"), createdAt: "2026-10-01T00:00:00Z",
    })
    expect(next?.toISOString()).toBe("2026-10-24T00:00:00.000Z")
  })

  it.each(["0 2 * * *", "0 9 * * sun"])("returns no run when cron %s and the window never overlap", (expr) => {
    const next = computeNextRunAt({
      trigger: { type: "builtin.cron", config: {
        expr, timezone: "UTC",
      } }, conditions: { operator: "and", items: [
        { type: "weekdays", days: [1, 2, 3, 4, 5] },
        { type: "daily-time-range", start: "08:00", end: "17:00" },
      ] }, from: new Date("2026-10-23T00:00:00Z"), createdAt: "2026-10-01T00:00:00Z",
    })
    expect(next).toBeNull()
  })

  it("returns no interval run when its cadence always falls outside the range", () => {
    process.env.TZ = "UTC"
    expect(computeNextRunAt({
      trigger: { type: "builtin.interval", config: {
        everyMinutes: 1440, anchor: "created_at",
      } }, conditions: { operator: "and", items: [
        { type: "daily-time-range", start: "08:00", end: "17:00" },
      ] }, from: new Date("2026-10-23T02:00:00Z"), createdAt: "2026-10-01T02:00:00Z",
    })).toBeNull()
  })

  it.each([
    ["2026-03-08T06:00:00Z", "30 2 * * *", "02:00", "03:00", "2026-03-09T06:30:00.000Z"],
    ["2026-11-01T05:45:00Z", "30 1 * * *", "01:00", "02:00", "2026-11-01T06:30:00.000Z"],
    ["2026-11-01T05:45:00Z", "* * * * *", "01:00", "02:00", "2026-11-01T05:46:00.000Z"],
  ])("handles daylight saving transitions from %s", (from, expr, start, end, expected) => {
    expect(computeNextRunAt({
      trigger: { type: "builtin.cron", config: {
        expr, timezone: "America/New_York",
      } }, conditions: { operator: "and", items: [
        { type: "daily-time-range", start, end },
      ] }, from: new Date(from), createdAt: "2026-01-01T00:00:00Z",
    })?.toISOString()).toBe(expected)
  })

  it.each([
    ["2026-03-06T07:00:00Z", "2026-03-05T07:00:00Z", 1440, "02:10", "04:00", "2026-03-08T07:00:00.000Z"],
    ["2026-11-01T05:40:00Z", "2026-11-01T04:00:00Z", 10, "00:30", "01:15", "2026-11-01T06:00:00.000Z"],
  ] as const)("uses clock transitions as interval window boundaries from %s", (from, createdAt, everyMinutes, start, end, expected) => {
    process.env.TZ = "America/New_York"
    expect(computeNextRunAt({
      trigger: { type: "builtin.interval", config: {
        everyMinutes, anchor: "created_at",
      } }, conditions: { operator: "and", items: [
        { type: "daily-time-range", start, end },
      ] }, from: new Date(from), createdAt,
    })?.toISOString()).toBe(expected)
  })

  it("finds the repeated local interval window after the clock falls back", () => {
    process.env.TZ = "America/New_York"
    expect(computeNextRunAt({
      trigger: { type: "builtin.interval", config: {
        everyMinutes: 10, anchor: "created_at",
      } }, conditions: { operator: "and", items: [
        { type: "weekdays", days: [0] },
        { type: "daily-time-range", start: "01:00", end: "01:15" },
      ] }, from: new Date("2026-11-01T05:40:00Z"), createdAt: "2026-11-01T04:00:00Z",
    })?.toISOString()).toBe("2026-11-01T06:00:00.000Z")
  })
})
