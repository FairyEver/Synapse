import { describe, expect, it, vi } from "vitest"

const sharedLoads = vi.hoisted(() => ({ count: 0 }))

vi.mock("@synapse/shared", async (importOriginal) => {
  sharedLoads.count += 1
  return importOriginal<typeof import("@synapse/shared")>()
})

describe("built-in trigger import lifecycle", () => {
  it("registers webhook triggers without starting a shared protocol import", async () => {
    const { createBuiltinAutomationTriggerRegistry } = await import("../builtin-triggers")
    const registry = createBuiltinAutomationTriggerRegistry()

    registry.parseConfig("builtin.webhook", { webhookPublicId: "wh_public" })
    await vi.dynamicImportSettled()

    expect(sharedLoads.count).toBe(0)

    const webhook = registry.get("builtin.webhook")
    await expect(webhook.runtime.shouldAcceptEvent?.({
      config: { webhookPublicId: "wh_public" },
      event: { source: "test", type: "unmatched", receivedAt: "2026-06-06T10:00:00.000Z", payload: {} },
    })).resolves.toBe(false)
    expect(sharedLoads.count).toBe(1)

    const { LIVE_MESSAGE_TYPES } = await import("@synapse/shared")
    const event = {
      source: "webhook",
      type: LIVE_MESSAGE_TYPES.webhookDeliveryReceived,
      receivedAt: "2026-06-06T10:00:00.000Z",
      payload: { webhook: { publicId: "wh_public" } },
    }

    await expect(webhook.runtime.shouldAcceptEvent?.({
      config: { webhookPublicId: "wh_public" },
      event,
    })).resolves.toBe(true)
    await expect(webhook.runtime.shouldAcceptEvent?.({
      config: { webhookPublicId: "wh_other" },
      event,
    })).resolves.toBe(false)
    await expect(webhook.runtime.shouldAcceptEvent?.({
      config: { webhookPublicId: "wh_public" },
      event: { ...event, source: "test" },
    })).resolves.toBe(false)
  })
})
