import { describe, expect, it } from "vitest"

import { rendererAutomationTriggerRegistry } from "../builtin-triggers"

describe("rendererAutomationTriggerRegistry", () => {
  it("registers built-in triggers in product order", () => {
    expect(rendererAutomationTriggerRegistry.list().map((trigger) => trigger.manifest.id)).toEqual([
      "builtin.cron",
      "builtin.interval",
    ])
  })

  it("parses and summarizes cron config", () => {
    const parsed = rendererAutomationTriggerRegistry.parseConfig("builtin.cron", {
      expr: "0 9 * * *",
      timezone: "Asia/Shanghai",
      activeDays: [1, 2, 3, 4, 5],
    })

    expect(parsed).toEqual({
      expr: "0 9 * * *",
      timezone: "Asia/Shanghai",
      activeDays: [1, 2, 3, 4, 5],
    })
    expect(rendererAutomationTriggerRegistry.summarize("builtin.cron", parsed)).toBe("Cron · 0 9 * * *")
  })

  it("parses and summarizes interval config", () => {
    const parsed = rendererAutomationTriggerRegistry.parseConfig("builtin.interval", {
      everyMinutes: 60,
      anchor: "last_completed_at",
      activeDays: [0, 1, 2, 3, 4, 5, 6],
    })

    expect(parsed).toEqual({
      everyMinutes: 60,
      anchor: "last_completed_at",
      activeDays: [0, 1, 2, 3, 4, 5, 6],
    })
    expect(rendererAutomationTriggerRegistry.summarize("builtin.interval", parsed)).toBe("每 60 分钟 · 完成后")
  })

  it("rejects duplicate trigger ids", () => {
    const existing = rendererAutomationTriggerRegistry.get("builtin.cron")

    expect(() => rendererAutomationTriggerRegistry.register(existing)).toThrow(
      'Automation trigger "builtin.cron" is already registered',
    )
  })
})
