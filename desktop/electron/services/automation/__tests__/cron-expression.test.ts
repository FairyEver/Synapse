import { describe, expect, it } from "vitest"

import { nextCronRun } from "../cron-expression"

describe("automation cron expression", () => {
  it("matches either day-of-month or weekday when both fields are restricted", () => {
    const next = nextCronRun(
      "0 9 1 * mon",
      new Date("2026-06-02T00:00:00.000Z"),
      "UTC",
    )

    expect(next.toISOString()).toBe("2026-06-08T09:00:00.000Z")
  })
})
