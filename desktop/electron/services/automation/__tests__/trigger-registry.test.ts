import { describe, expect, it } from "vitest"
import { z } from "zod"
import { LIVE_MESSAGE_TYPES } from "@synapse/shared"

import { cronTriggerDefinition } from "../../../../automation-trigger-packages/builtin/cron/index.main"
import { intervalTriggerDefinition } from "../../../../automation-trigger-packages/builtin/interval/index.main"
import { webhookTriggerDefinition } from "../../../../automation-trigger-packages/builtin/webhook/index.main"
import { AutomationTriggerRegistry } from "../trigger-registry"

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
