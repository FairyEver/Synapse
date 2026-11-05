import { describe, expect, it } from "vitest"
import { listNextCronRuns } from "../cron-utils"

describe("Cron schedule preview", () => {
  it("uses the configured timezone", () => {
    const runs = listNextCronRuns("0 9 * * *", new Date("2026-11-05T12:00:00Z"), 2, { timezone: "Asia/Shanghai" })
    expect(runs.map(run => run.toISOString())).toEqual(["2026-11-06T01:00:00.000Z", "2026-11-07T01:00:00.000Z"])
  })
  it("applies the same conditions as the scheduler and handles no matching run", () => {
    const options = { timezone: "UTC", conditions: { operator: "and" as const, items: [{ type: "weekdays" as const, days: [1] }] } }
    expect(listNextCronRuns("0 9 * * *", new Date("2026-11-05T12:00:00Z"), 1, options)[0]?.toISOString()).toBe("2026-11-09T09:00:00.000Z")
    expect(listNextCronRuns("0 9 * * *", new Date("2026-11-05T12:00:00Z"), 1, { timezone: "UTC", conditions: { operator: "and", items: [{ type: "daily-time-range", start: "10:00", end: "11:00" }] } })).toEqual([])
  })
})
