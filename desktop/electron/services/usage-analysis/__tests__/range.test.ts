import { describe, expect, it } from "vitest"
import { createUsageRangeFilter, localDateKey, localHourKey } from "../range"

describe("usage analysis range helpers", () => {
  it("creates no bounds for all time", () => {
    expect(createUsageRangeFilter({ preset: "all" }, new Date("2026-05-19T12:00:00+08:00"))).toEqual({})
  })

  it("creates an inclusive date window for 7 days", () => {
    expect(createUsageRangeFilter({ preset: "7d" }, new Date("2026-05-19T12:00:00+08:00"))).toEqual({
      sinceDate: "2026-05-13",
      untilDate: "2026-05-19",
    })
  })

  it("creates a local date window for today", () => {
    expect(createUsageRangeFilter({ preset: "today" }, new Date("2026-05-20T15:30:00+08:00"))).toEqual({
      sinceDate: "2026-05-20",
      untilDate: "2026-05-20",
      sinceHour: "2026-05-20 00",
      untilHour: "2026-05-20 15",
      sinceTimestampMs: new Date("2026-05-20T00:00:00+08:00").getTime(),
      untilTimestampMs: new Date("2026-05-20T15:30:00+08:00").getTime(),
    })
  })

  it("formats local date and hour keys", () => {
    const ts = new Date("2026-05-19T09:08:07+08:00").getTime()
    expect(localDateKey(ts)).toMatch(/^\d{4}-\d{2}-\d{2}$/)
    expect(localHourKey(ts)).toMatch(/^\d{4}-\d{2}-\d{2} \d{2}$/)
  })
})
