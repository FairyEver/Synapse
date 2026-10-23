import { describe, expect, it } from "vitest"
import { z } from "zod"
import { LIVE_MESSAGE_TYPES } from "@synapse/shared"

import { cronTriggerDefinition } from "../../../../automation-trigger-packages/builtin/cron/index.main"
import { intervalTriggerDefinition } from "../../../../automation-trigger-packages/builtin/interval/index.main"
import { webhookTriggerDefinition } from "../../../../automation-trigger-packages/builtin/webhook/index.main"
import { AutomationTriggerRegistry } from "../trigger-registry"
import { createBuiltinAutomationTriggerRegistry } from "../builtin-triggers"

const testTrigger = {
  manifest: {
    id: "builtin.test",
    title: "Test",
    kind: "schedule" as const,
    defaultConfig: { value: "ok" },
    configSchema: z.object({ value: z.string().min(1) }),
  },
  summarize: (config: { value: string }) => config.value,
  runtime: {
    computeNextRunAt: () => new Date("2026-06-03T00:10:00.000Z"),
  },
}

describe("AutomationTriggerRegistry", () => {
  it("registers and parses trigger config", () => {
    const registry = new AutomationTriggerRegistry()
    registry.register(testTrigger)

    expect(registry.parseConfig("builtin.test", { value: "hello" })).toEqual({ value: "hello" })
    expect(registry.summarize("builtin.test", { value: "hello" })).toBe("hello")
  })

  it("exposes schedule runtime through the trigger definition", () => {
    const registry = new AutomationTriggerRegistry()
    registry.register(testTrigger)

    const trigger = registry.get("builtin.test")

    expect(trigger.manifest.kind).toBe("schedule")
    expect(trigger.runtime.computeNextRunAt?.({
      config: { value: "ok" },
      from: new Date("2026-06-03T00:00:00.000Z"),
      createdAt: "2026-06-03T00:00:00.000Z",
    })).toEqual(new Date("2026-06-03T00:10:00.000Z"))
  })

  it("uses custom stored config validation when provided", () => {
    const registry = new AutomationTriggerRegistry()
    registry.register({
      ...testTrigger,
      validateStoredConfig: () => ({
        status: "needs_update" as const,
        issues: [{ field: "trigger.config.value", message: "值已失效" }],
      }),
    })

    expect(registry.validateStoredConfig("builtin.test", { value: "ok" })).toEqual({
      status: "needs_update",
      issues: [{ field: "trigger.config.value", message: "值已失效" }],
    })
  })

  it("rejects duplicate trigger ids", () => {
    const registry = new AutomationTriggerRegistry()
    registry.register(testTrigger)

    expect(() => registry.register(testTrigger)).toThrow(/already registered/)
  })

  it("reports needs_update for unknown triggers", () => {
    const registry = new AutomationTriggerRegistry()

    expect(registry.validateStoredConfig("missing", {})).toEqual({
      status: "needs_update",
      issues: [{ field: "trigger.type", message: "选择触发器" }],
    })
  })

  it("exports built-in main trigger definitions from trigger packages", () => {
    expect(cronTriggerDefinition.manifest.id).toBe("builtin.cron")
    expect(cronTriggerDefinition.manifest.kind).toBe("schedule")
    expect(cronTriggerDefinition.runtime.computeNextRunAt).toBeTypeOf("function")

    expect(intervalTriggerDefinition.manifest.id).toBe("builtin.interval")
    expect(intervalTriggerDefinition.manifest.kind).toBe("schedule")
    expect(intervalTriggerDefinition.runtime.getReschedulePolicy?.({
      everyMinutes: 60,
      anchor: "last_completed_at",
      activeDays: [0, 1, 2, 3, 4, 5, 6],
    })).toEqual({ mode: "after_completion" })

    expect(webhookTriggerDefinition.manifest.id).toBe("builtin.webhook")
    expect(webhookTriggerDefinition.manifest.kind).toBe("event")
    expect(webhookTriggerDefinition.runtime.shouldAcceptEvent).toBeTypeOf("function")
  })

  it("computes builtin cron next run on the next active day", () => {
    const nextRunAt = cronTriggerDefinition.runtime.computeNextRunAt?.({
      config: {
        expr: "0 9 * * *",
        timezone: "UTC",
        activeDays: [1],
      },
      from: new Date("2026-06-02T10:00:00.000Z"),
      createdAt: "2026-06-01T00:00:00.000Z",
    })

    expect(nextRunAt?.toISOString()).toBe("2026-06-08T09:00:00.000Z")
  })

  it("computes builtin interval next run on the next active day", () => {
    const from = new Date("2026-06-03T12:40:00.000Z")
    const activeDay = (from.getDay() + 1) % 7
    const nextRunAt = intervalTriggerDefinition.runtime.computeNextRunAt?.({
      config: {
        everyMinutes: 30,
        anchor: "created_at",
        activeDays: [activeDay],
      },
      from,
      createdAt: "2026-06-03T12:00:00.000Z",
    })

    expect(nextRunAt?.getDay()).toBe(activeDay)
    expect(nextRunAt?.getTime()).toBeGreaterThan(from.getTime())
  })

  it("matches webhook events by selected public id", async () => {
    const event = {
      source: "webhook",
      type: LIVE_MESSAGE_TYPES.webhookDeliveryReceived,
      receivedAt: "2026-06-06T10:00:00.000Z",
      payload: {
        webhook: { publicId: "wh_public" },
      },
    }

    await expect(webhookTriggerDefinition.runtime.shouldAcceptEvent?.({
      config: { webhookPublicId: "wh_public" },
      event,
    })).resolves.toBe(true)
    await expect(webhookTriggerDefinition.runtime.shouldAcceptEvent?.({
      config: { webhookPublicId: "wh_other" },
      event,
    })).resolves.toBe(false)
    await expect(webhookTriggerDefinition.runtime.shouldAcceptEvent?.({
      config: { webhookPublicId: "wh_public" },
      event: { ...event, source: "test" },
    })).resolves.toBe(false)
  })

  it("exposes builtin trigger variables", () => {
    const registry = new AutomationTriggerRegistry()
    registry.register(cronTriggerDefinition)
    registry.register(intervalTriggerDefinition)
    registry.register(webhookTriggerDefinition)

    const cron = registry.get("builtin.cron")
    const interval = registry.get("builtin.interval")
    const webhook = registry.get("builtin.webhook")

    expect(cron.manifest.variables?.map((variable) => variable.key)).toEqual([
      "trigger.type",
      "trigger.triggeredBy",
      "trigger.triggeredAt",
      "trigger.scheduledAt",
      "trigger.automationId",
      "trigger.automationName",
      "trigger.cron",
      "trigger.timezone",
    ])
    expect(interval.manifest.variables?.map((variable) => variable.key)).toEqual([
      "trigger.type",
      "trigger.triggeredBy",
      "trigger.triggeredAt",
      "trigger.scheduledAt",
      "trigger.automationId",
      "trigger.automationName",
      "trigger.everyMinutes",
      "trigger.anchor",
    ])
    expect(webhook.manifest.variables?.map((variable) => variable.key)).toEqual(expect.arrayContaining([
      "trigger.deliveryId",
      "trigger.webhook.publicId",
      "trigger.request.method",
      "trigger.request.body",
      "trigger.request.query",
      "trigger.request.headers",
    ]))
  })
})

describe("daily time range config and runtime", () => {
  const registry = createBuiltinAutomationTriggerRegistry()
  for (const [type, base] of [
    ["builtin.cron", { expr: "* * * * *", timezone: "UTC", activeDays: [1, 2, 3, 4, 5] }],
    ["builtin.interval", { everyMinutes: 60, anchor: "created_at", activeDays: [1, 2, 3, 4, 5] }],
  ] as const) {
    it(`${type} preserves a range and accepts old configs without one`, () => {
      expect(registry.parseConfig(type, base)).toEqual(base)
      const config = { ...base, timeRange: { start: "08:00", end: "24:00" } }
      expect(registry.parseConfig(type, config)).toEqual(config)
    })
    it.each([
      { start: "08:00", end: "" }, { start: "", end: "17:00" },
      { start: "8:00", end: "17:00" }, { start: "24:00", end: "24:00" },
      { start: "08:60", end: "17:00" }, { start: "17:00", end: "08:00" },
      { start: "08:00", end: "08:00" },
    ])(`${type} rejects invalid or incomplete ranges %j`, (timeRange) => {
      expect(() => registry.parseConfig(type, { ...base, timeRange })).toThrow()
    })
    it(`${type} blocks scheduled runs outside the daily window`, () => {
      const config = { ...base, timeRange: { start: "08:00", end: "17:00" } }
      const runtime = registry.get(type).runtime
      const date = new Date(2026, 9, 23, 7, 59)
      // Cron uses UTC; interval uses the host's local timezone.
      const at = (hour: number, minute = 0) => type === "builtin.cron"
        ? new Date(Date.UTC(2026, 9, 23, hour, minute))
        : new Date(date.getFullYear(), date.getMonth(), date.getDate(), hour, minute)
      expect(runtime.shouldRunNow?.({ config, now: at(7, 59) })).toBe(false)
      expect(runtime.shouldRunNow?.({ config, now: at(8) })).toBe(true)
      expect(runtime.shouldRunNow?.({ config, now: at(16, 59) })).toBe(true)
      expect(runtime.shouldRunNow?.({ config, now: at(17) })).toBe(false)
    })
  }
})
