import { describe, expect, it } from "vitest"

import { computeNextRunAt } from "../schedule-calculator"

describe("automation schedule calculator", () => {
  it("computes the next cron run with active days", () => {
    const next = computeNextRunAt({
      trigger: {
        type: "builtin.cron",
        config: { expr: "0 9 * * *", activeDays: [1] },
      },
      from: new Date("2026-06-02T10:00:00.000Z"),
      createdAt: "2026-06-01T00:00:00.000Z",
    })

    expect(next.getDay()).toBe(1)
    expect(next.getTime()).toBeGreaterThan(new Date("2026-06-02T10:00:00.000Z").getTime())
  })

  it("computes created_at interval runs", () => {
    const next = computeNextRunAt({
      trigger: {
        type: "builtin.interval",
        config: { everyMinutes: 30, anchor: "created_at", activeDays: [0, 1, 2, 3, 4, 5, 6] },
      },
      from: new Date("2026-06-03T00:40:00.000Z"),
      createdAt: "2026-06-03T00:00:00.000Z",
    })

    expect(next.toISOString()).toBe("2026-06-03T01:00:00.000Z")
  })

  it("computes last_completed_at interval runs", () => {
    const next = computeNextRunAt({
      trigger: {
        type: "builtin.interval",
        config: { everyMinutes: 30, anchor: "last_completed_at", activeDays: [0, 1, 2, 3, 4, 5, 6] },
      },
      from: new Date("2026-06-03T00:40:00.000Z"),
      createdAt: "2026-06-03T00:00:00.000Z",
    })

    expect(next.toISOString()).toBe("2026-06-03T01:10:00.000Z")
  })
})
