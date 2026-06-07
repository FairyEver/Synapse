import { describe, expect, it } from "vitest"
import {
  WEBHOOK_DELIVERY_STATUS,
  WEBHOOK_PUBLIC_PATH_PREFIX,
  isWebhookDeliveryReceivedPayload,
} from "./webhook.js"

describe("shared webhook protocol", () => {
  it("defines the public path prefix and delivery statuses once", () => {
    expect(WEBHOOK_PUBLIC_PATH_PREFIX).toBe("/webhooks")
    expect(WEBHOOK_DELIVERY_STATUS.accepted).toBe("accepted")
    expect(WEBHOOK_DELIVERY_STATUS.rejected).toBe("rejected")
    expect(WEBHOOK_DELIVERY_STATUS.received).toBe("received")
  })

  it("validates delivery payload shape", () => {
    expect(isWebhookDeliveryReceivedPayload({
      deliveryId: "delivery-1",
      webhook: { id: "webhook-1", publicId: "wh_abc", name: "A" },
      request: {
        method: "POST",
        url: "https://synapse.test/webhooks/wh_abc/***",
        query: {},
        headers: {},
        body: { ok: true },
        receivedAt: "2026-06-06T10:00:00.000Z",
      },
    })).toBe(true)
  })

  it("rejects delivery payloads without request body", () => {
    expect(isWebhookDeliveryReceivedPayload({
      deliveryId: "delivery-1",
      webhook: { id: "webhook-1", publicId: "wh_abc", name: "A" },
      request: {
        method: "POST",
        url: "https://synapse.test/webhooks/wh_abc/***",
        query: {},
        headers: {},
        receivedAt: "2026-06-06T10:00:00.000Z",
      },
    })).toBe(false)
  })

  it("rejects delivery payloads with invalid query values", () => {
    expect(isWebhookDeliveryReceivedPayload({
      deliveryId: "delivery-1",
      webhook: { id: "webhook-1", publicId: "wh_abc", name: "A" },
      request: {
        method: "POST",
        url: "https://synapse.test/webhooks/wh_abc/***",
        query: { retry: 1 },
        headers: {},
        body: { ok: true },
        receivedAt: "2026-06-06T10:00:00.000Z",
      },
    })).toBe(false)
  })
})
