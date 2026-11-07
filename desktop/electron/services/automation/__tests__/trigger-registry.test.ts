import { describe, expect, it } from "vitest"
import { z } from "zod"
import { LIVE_MESSAGE_TYPES } from "@synapse/shared"

import { cronTriggerDefinition } from "../../../../automation-trigger-packages/builtin/cron/index.main"
import { intervalTriggerDefinition } from "../../../../automation-trigger-packages/builtin/interval/index.main"
import { webhookTriggerDefinition } from "../../../../automation-trigger-packages/builtin/webhook/index.main"
import { manualTriggerDefinition } from "../../../../automation-trigger-packages/builtin/manual/index.main"
import { manualTriggerConfigSchema } from "../../../../automation-trigger-packages/builtin/manual/index.shared"
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

  it("accepts only an empty manual trigger config", () => {
    expect(manualTriggerConfigSchema.parse({})).toEqual({})
    expect(() => manualTriggerConfigSchema.parse({ unexpected: true })).toThrow()
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
    })).toEqual({ mode: "after_completion" })

    expect(webhookTriggerDefinition.manifest.id).toBe("builtin.webhook")
    expect(webhookTriggerDefinition.manifest.kind).toBe("event")
    expect(webhookTriggerDefinition.runtime.shouldAcceptEvent).toBeTypeOf("function")

    expect(manualTriggerDefinition.manifest.id).toBe("builtin.manual")
    expect(manualTriggerDefinition.manifest.title).toBe("手动触发")
    expect(manualTriggerDefinition.manifest.kind).toBe("manual")
    expect(manualTriggerDefinition.manifest.defaultConfig).toEqual({})
    const manual = createBuiltinAutomationTriggerRegistry().get("builtin.manual")
    expect(manual.runtime.computeNextRunAt).toBeUndefined()
    expect(manual.runtime.shouldAcceptEvent).toBeUndefined()
    expect(manual.activationRequired).toBeUndefined()
  })

  it("computes builtin cron next run on the next active day", () => {
    const nextRunAt = cronTriggerDefinition.runtime.computeNextRunAt?.({
      config: {
        expr: "0 9 * * *",
        timezone: "UTC",
      },
      conditions: { operator: "and", items: [{ type: "weekdays", days: [1] }] },
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
      },
      conditions: { operator: "and", items: [{ type: "weekdays", days: [activeDay] }] },
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

    expect(cron.manifest.variables?.map((variable) => variable.key)).toEqual(expect.arrayContaining([
      "trigger.type",
      "trigger.triggeredBy",
      "trigger.triggeredAt",
      "trigger.scheduledAt",
      "trigger.automationId",
      "trigger.automationName",
      "trigger.cron",
      "trigger.timezone",
      "trigger.date", "trigger.executedAt", "trigger.runId",
    ]))
    expect(interval.manifest.variables?.map((variable) => variable.key)).toEqual(expect.arrayContaining([
      "trigger.type",
      "trigger.triggeredBy",
      "trigger.triggeredAt",
      "trigger.scheduledAt",
      "trigger.automationId",
      "trigger.automationName",
      "trigger.everyMinutes",
      "trigger.anchor",
      "trigger.date", "trigger.executedAt", "trigger.runId",
    ]))
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

describe("automation trigger config ownership", () => {
  const registry = createBuiltinAutomationTriggerRegistry()
  for (const [type, config] of [
    ["builtin.cron", { expr: "* * * * *", timezone: "UTC" }],
    ["builtin.interval", { everyMinutes: 60, anchor: "created_at" }],
  ] as const) {
    it(`${type} rejects obsolete nested conditions rather than discarding them`, () => {
      expect(() => registry.parseConfig(type, {
        ...config,
        activeDays: [1, 2, 3, 4, 5],
        timeRange: { start: "08:00", end: "17:00" },
      })).toThrow("配置需要更新")
    })
  }
})
