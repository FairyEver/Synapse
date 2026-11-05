import { describe, expect, it } from "vitest"

import { nextCronRun, parseCronExpression, validateCronExpression } from "../cron-expression"

describe("automation cron expression", () => {
  it.each(["0 9 30 2 *", "0 9 31 4 *", "0 9 31 2,4,6,9,11 *"])("rejects an impossible calendar date: %s", expr => {
    expect(() => validateCronExpression(expr)).toThrow("Cron 在 5 年内没有运行时间")
  })
  it.each(["0 9 29 2 *", "0 9 30 2 mon", "0 9 31 2,3 *"])("preserves a leap day or another matching calendar alternative: %s", expr => {
    expect(() => validateCronExpression(expr)).not.toThrow()
  })

  it.each([
    "*/2/3 * * * *",
    "1-2-3 * * * *",
    "0xA * * * *",
    "1e1 * * * *",
    "+1 * * * *",
    "1.0 * * * *",
    "*/0xA * * * *",
    "*/1e1 * * * *",
  ])("rejects malformed syntax instead of silently scheduling %s", (expr) => {
    expect(() => parseCronExpression(expr)).toThrow()
  })

  it("matches either day-of-month or weekday when both fields are restricted", () => {
    const next = nextCronRun(
      "0 9 1 * mon",
      new Date("2026-06-02T00:00:00.000Z"),
      "UTC",
    )

    expect(next.toISOString()).toBe("2026-06-08T09:00:00.000Z")
  })
})
