import { describe, expect, it, vi } from "vitest"
import { nextCronRun } from "../../../automation-trigger-packages/cron-expression"
import { computeNextRunAt } from "../../../automation-trigger-packages/schedule-calculator"

describe("shared preview clock boundaries", () => {
  it("keeps the repeated hour when the Cron uses the default local timezone", () => {
    vi.stubEnv("TZ", "America/New_York")
    try { expect(nextCronRun("* * * * *", new Date("2026-11-01T05:59:00Z")).toISOString()).toBe("2026-11-01T06:00:00.000Z") }
    finally { vi.unstubAllEnvs() }
  })
  it.each([
    ["30 3 * * *", "2026-03-08T05:00:00Z", "2026-03-08T07:30:00.000Z"],
    ["* * * * *", "2026-11-01T05:59:00Z", "2026-11-01T06:00:00.000Z"],
    ["30 1 * * *", "2026-11-01T05:45:00Z", "2026-11-01T06:30:00.000Z"],
  ])("resolves real future instants through daylight clock changes %s", (expr, from, expected) => {
    expect(nextCronRun(expr, new Date(from), "America/New_York").toISOString()).toBe(expected)
  })
  it("returns no match when the cron weekday contradicts its condition", () => {
    expect(computeNextRunAt({ trigger: { type: "builtin.cron", config: { expr: "0 9 * * 1", timezone: "UTC" } }, conditions: { operator: "and", items: [{ type: "weekdays", days: [2] }] }, from: new Date("2026-11-01T00:00:00Z"), createdAt: "2026-11-01T00:00:00Z" })).toBeNull()
  })
})
