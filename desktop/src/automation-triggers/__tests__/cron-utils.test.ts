import { describe, expect, it } from "vitest"

import {
  buildCronExpression,
  getCronEditorInitialTab,
  inferCronTemplate,
  listNextCronRuns,
  parseCronExpression,
  validateCronExpression,
  type CronTemplateDraft,
} from "../cron-utils"

describe("cron-utils", () => {
  it("builds expressions from common templates", () => {
    const cases: Array<[CronTemplateDraft, string]> = [
      [{ kind: "every_minutes", everyMinutes: 15, minute: 0, hour: 9, dayOfMonth: 1, weekday: 1 }, "*/15 * * * *"],
      [{ kind: "hourly", everyMinutes: 15, minute: 5, hour: 9, dayOfMonth: 1, weekday: 1 }, "5 * * * *"],
      [{ kind: "daily", everyMinutes: 15, minute: 30, hour: 9, dayOfMonth: 1, weekday: 1 }, "30 9 * * *"],
      [{ kind: "weekly", everyMinutes: 15, minute: 0, hour: 10, dayOfMonth: 1, weekday: 2 }, "0 10 * * 2"],
      [{ kind: "monthly", everyMinutes: 15, minute: 45, hour: 8, dayOfMonth: 12, weekday: 1 }, "45 8 12 * *"],
      [{ kind: "weekdays", everyMinutes: 15, minute: 15, hour: 18, dayOfMonth: 1, weekday: 1 }, "15 18 * * 1-5"],
    ]

    for (const [draft, expected] of cases) {
      expect(buildCronExpression(draft)).toBe(expected)
    }
  })

  it("parses supported five-field cron syntax", () => {
    const parsed = parseCronExpression("*/20 9-17 * jan,mar mon-fri")

    expect([...parsed.minute]).toEqual([0, 20, 40])
    expect([...parsed.hour]).toEqual([9, 10, 11, 12, 13, 14, 15, 16, 17])
    expect([...parsed.month]).toEqual([1, 3])
    expect([...parsed.weekday]).toEqual([1, 2, 3, 4, 5])
  })

  it("normalizes weekday 7 to Sunday", () => {
    expect([...parseCronExpression("0 9 * * 7").weekday]).toEqual([0])
  })

  it("rejects unsupported or invalid expressions", () => {
    expect(() => parseCronExpression("0 9 * *")).toThrow(/5 段/)
    expect(() => parseCronExpression("0 24 * * *")).toThrow(/小时/)
    expect(() => parseCronExpression("0 9 20-10 * *")).toThrow(/日期/)
    expect(validateCronExpression("bad")).toEqual({
      ok: false,
      message: "Cron 必须包含 5 段",
    })
  })

  it("rejects syntactically valid expressions with no future run", () => {
    expect(validateCronExpression("0 9 31 2 *")).toEqual({
      ok: false,
      message: "Cron 在 5 年内没有运行时间",
    })
  })

  it("lists five ascending future runs", () => {
    const runs = listNextCronRuns("*/30 * * * *", new Date("2026-04-29T10:01:00"), 5)

    expect(runs.map((run) => run.toISOString())).toEqual([
      new Date("2026-04-29T10:30:00").toISOString(),
      new Date("2026-04-29T11:00:00").toISOString(),
      new Date("2026-04-29T11:30:00").toISOString(),
      new Date("2026-04-29T12:00:00").toISOString(),
      new Date("2026-04-29T12:30:00").toISOString(),
    ])
  })

  it("matches either day-of-month or weekday when both fields are restricted", () => {
    const runs = listNextCronRuns("0 9 1 * mon", new Date("2026-06-02T00:00:00.000Z"), 2)

    expect(runs.map((run) => run.toISOString())).toEqual([
      new Date("2026-06-08T09:00:00").toISOString(),
      new Date("2026-06-15T09:00:00").toISOString(),
    ])
  })

  it("infers templates and initial tab from existing values", () => {
    expect(inferCronTemplate("0 9 * * 1-5")).toMatchObject({
      kind: "weekdays",
      hour: 9,
      minute: 0,
    })
    expect(getCronEditorInitialTab("0 9 * * 1-5")).toBe("common")
    expect(getCronEditorInitialTab("0 9 1,15 * *")).toBe("advanced")
    expect(getCronEditorInitialTab("bad")).toBe("advanced")
  })
})
