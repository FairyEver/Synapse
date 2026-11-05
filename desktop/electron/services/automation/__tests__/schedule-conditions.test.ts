import { describe, expect, it } from "vitest"

import {
  automationConditionsSchema,
  isAutomationConditionsSatisfied,
  summarizeAutomationConditions,
} from "../../../../automation-trigger-packages/schedule-constraints"

describe("Automation run conditions", () => {
  it("normalizes weekdays and validates the condition set", () => {
    expect(automationConditionsSchema.parse({
      operator: "and",
      items: [{ type: "weekdays", days: [5, 1, 5] }],
    })).toEqual({
      operator: "and",
      items: [{ type: "weekdays", days: [1, 5] }],
    })
    expect(() => automationConditionsSchema.parse({
      operator: "or",
      items: [
        { type: "weekdays", days: [1] },
        { type: "weekdays", days: [2] },
      ],
    })).toThrow("同一类条件只能添加一次")
    expect(() => automationConditionsSchema.parse({
      operator: "and",
      items: [{ type: "daily-time-range", start: "18:00", end: "08:00" }],
    })).toThrow()
  })

  it("applies both conditions with and semantics", () => {
    const conditions = automationConditionsSchema.parse({
      operator: "and",
      items: [
        { type: "weekdays", days: [1] },
        { type: "daily-time-range", start: "08:00", end: "17:00" },
      ],
    })

    expect(isAutomationConditionsSatisfied(new Date("2026-11-02T08:00:00Z"), conditions)).toBe(true)
    expect(isAutomationConditionsSatisfied(new Date("2026-11-02T17:00:00Z"), conditions)).toBe(false)
    expect(isAutomationConditionsSatisfied(new Date("2026-11-03T09:00:00Z"), conditions)).toBe(false)
  })

  it("applies either condition with or semantics", () => {
    const conditions = automationConditionsSchema.parse({
      operator: "or",
      items: [
        { type: "weekdays", days: [1] },
        { type: "daily-time-range", start: "08:00", end: "17:00" },
      ],
    })

    expect(isAutomationConditionsSatisfied(new Date("2026-11-02T20:00:00Z"), conditions, "UTC")).toBe(true)
    expect(isAutomationConditionsSatisfied(new Date("2026-11-03T09:00:00Z"), conditions, "UTC")).toBe(true)
    expect(isAutomationConditionsSatisfied(new Date("2026-11-03T20:00:00Z"), conditions, "UTC")).toBe(false)
  })

  it("uses the supplied timezone and summarizes the condition set", () => {
    const conditions = automationConditionsSchema.parse({
      operator: "and",
      items: [
        { type: "weekdays", days: [1, 2, 3, 4, 5] },
        { type: "daily-time-range", start: "08:00", end: "17:00" },
      ],
    })

    expect(isAutomationConditionsSatisfied(new Date("2026-11-01T23:30:00Z"), conditions, "Asia/Shanghai")).toBe(false)
    expect(isAutomationConditionsSatisfied(new Date("2026-11-02T00:30:00Z"), conditions, "Asia/Shanghai")).toBe(true)
    expect(summarizeAutomationConditions(conditions)).toBe("周一至周五 并且 08:00–17:00")
  })
})
