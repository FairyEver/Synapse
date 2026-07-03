import { describe, expect, it } from "vitest"
import {
  WEBHOOK_DELIVERY_STATUS,
  WEBHOOK_PUBLIC_PATH_PREFIX,
  isWebhookDeliveryReceivedPayload,
} from "./webhook.js"
import type { WebhookDeliveryHistoryDto } from "./webhook.js"

describe("shared webhook protocol", () => {
  it("defines the public path prefix and delivery statuses once", () => {
    expect(WEBHOOK_PUBLIC_PATH_PREFIX).toBe("/webhooks")
    expect(WEBHOOK_DELIVERY_STATUS.received).toBe("received")
    expect(WEBHOOK_DELIVERY_STATUS.noOnlineClients).toBe("no_online_clients")
    expect(WEBHOOK_DELIVERY_STATUS.sent).toBe("sent")
    expect(WEBHOOK_DELIVERY_STATUS.delivered).toBe("delivered")
    expect(WEBHOOK_DELIVERY_STATUS.broadcastFailed).toBe("broadcast_failed")
    expect(WEBHOOK_DELIVERY_STATUS.rejected).toBe("rejected")
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

  it("exports a delivery history DTO that can carry deleted webhook and admin user summaries", () => {
    const row: WebhookDeliveryHistoryDto = {
      id: "delivery-1",
      webhookId: "webhook-1",
      method: "POST",
      path: "/webhooks/wh_public/***",
      query: { event: "push" },
      headers: { "x-github-event": "push" },
      bodyKind: "json",
      bodySize: 12,
      bodyPreview: "{\"ok\":true}",
      receivedAt: "2026-06-07T09:00:00.000Z",
      onlineClientCount: 2,
      sentClientCount: 2,
      failedClientCount: 0,
      acknowledgedClientCount: 1,
      clientReceipts: [],
      status: WEBHOOK_DELIVERY_STATUS.delivered,
      webhook: {
        id: "webhook-1",
        publicId: "wh_public",
        name: "GitHub",
        currentName: "GitHub",
        deletedAt: "2026-06-07T10:00:00.000Z",
      },
      user: {
        id: "user-1",
        email: "user@example.com",
        handle: "user",
      },
    }

    expect(row.webhook.deletedAt).toBe("2026-06-07T10:00:00.000Z")
    expect(row.user?.email).toBe("user@example.com")
  })
})
