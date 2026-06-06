import { describe, expect, it, vi } from "vitest"
import { LiveWebhookDeliveryHandler, createWebhookAutomationEvent } from "../live-webhook-delivery-handler"

vi.mock("../log-store", () => ({
  createMainLogger: () => ({
    info: vi.fn(),
    warn: vi.fn(),
  }),
}))

const payload = {
  deliveryId: "delivery-1",
  webhook: { id: "webhook-1", publicId: "wh_public", name: "GitHub" },
  request: {
    method: "POST",
    url: "https://synapse.test/webhooks/wh_public/***",
    query: { event: "push" },
    headers: { "x-github-event": "push" },
    body: { repository: { full_name: "FairyEver/Synapse" } },
    bodyText: "{\"repository\":{\"full_name\":\"FairyEver/Synapse\"}}",
    contentType: "application/json",
    receivedAt: "2026-06-06T10:00:00.000Z",
    remoteAddress: "203.0.113.10",
  },
} as const

describe("LiveWebhookDeliveryHandler", () => {
  it("maps shared webhook payloads to automation trigger events", () => {
    expect(createWebhookAutomationEvent(payload)).toEqual({
      source: "webhook",
      type: "webhook.delivery.received",
      receivedAt: "2026-06-06T10:00:00.000Z",
      payload: {
        deliveryId: "delivery-1",
        webhook: { id: "webhook-1", publicId: "wh_public", name: "GitHub" },
        request: {
          method: "POST",
          query: { event: "push" },
          headers: { "x-github-event": "push" },
          body: { repository: { full_name: "FairyEver/Synapse" } },
          bodyText: "{\"repository\":{\"full_name\":\"FairyEver/Synapse\"}}",
          contentType: "application/json",
          remoteAddress: "203.0.113.10",
        },
      },
    })
  })

  it("calls automation without logging raw request payloads", async () => {
    const logger = {
      info: vi.fn(),
      warn: vi.fn(),
    }
    const automation = {
      acceptEvent: vi.fn().mockResolvedValue([{ id: "run-1" }]),
    }
    const handler = new LiveWebhookDeliveryHandler({ automation, logger })

    await handler.handle(payload)

    expect(automation.acceptEvent).toHaveBeenCalledWith(createWebhookAutomationEvent(payload))
    expect(logger.info).toHaveBeenCalledWith("Live webhook delivery accepted.", {
      source: "live-webhook",
      deliveryId: "delivery-1",
      webhookPublicId: "wh_public",
      receivedAt: "2026-06-06T10:00:00.000Z",
      acceptedCount: 1,
      boundary: "live-webhook-delivery",
    })
    expect(JSON.stringify(logger.info.mock.calls)).not.toContain("FairyEver/Synapse")
    expect(JSON.stringify(logger.info.mock.calls)).not.toContain("x-github-event")
  })

  it("logs automation failures without throwing or recording payload contents", async () => {
    const logger = {
      info: vi.fn(),
      warn: vi.fn(),
    }
    const automation = {
      acceptEvent: vi.fn().mockRejectedValue(new Error("executor failed with body payload")),
    }
    const handler = new LiveWebhookDeliveryHandler({ automation, logger })

    await expect(handler.handle(payload)).resolves.toBeUndefined()

    expect(logger.warn).toHaveBeenCalledWith("Live webhook delivery failed.", {
      source: "live-webhook",
      deliveryId: "delivery-1",
      webhookPublicId: "wh_public",
      receivedAt: "2026-06-06T10:00:00.000Z",
      boundary: "live-webhook-delivery",
      errorName: "Error",
      errorLength: expect.any(Number),
    })
    expect(JSON.stringify(logger.warn.mock.calls)).not.toContain("FairyEver/Synapse")
    expect(JSON.stringify(logger.warn.mock.calls)).not.toContain("body payload")
  })
})

