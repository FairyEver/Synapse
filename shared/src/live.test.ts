import { describe, expect, it } from "vitest"
import {
  LIVE_MESSAGE_TYPES,
  createLiveEnvelope,
  isLiveDesktopClientMessage,
  isLiveDesktopServerMessage,
} from "./live.js"

describe("shared live protocol", () => {
  it("creates stable envelopes with namespaced message types", () => {
    const envelope = createLiveEnvelope(LIVE_MESSAGE_TYPES.ping, {
      sentAt: "2026-06-06T10:00:00.000Z",
    }, {
      id: "msg-1",
      sentAt: "2026-06-06T10:00:01.000Z",
    })

    expect(envelope).toEqual({
      type: "live.ping",
      id: "msg-1",
      sentAt: "2026-06-06T10:00:01.000Z",
      payload: { sentAt: "2026-06-06T10:00:00.000Z" },
    })
  })

  it("recognizes client heartbeat messages and rejects malformed envelopes", () => {
    expect(isLiveDesktopClientMessage(createLiveEnvelope(LIVE_MESSAGE_TYPES.hello, {
      clientInstanceId: "client-a",
      appVersion: "0.2.253",
      platform: "darwin-arm64",
      deviceName: "MacBook",
    }, { id: "msg-1", sentAt: "2026-06-06T10:00:00.000Z" }))).toBe(true)

    expect(isLiveDesktopClientMessage({
      type: "live.hello",
      id: "msg-1",
      sentAt: "2026-06-06T10:00:00.000Z",
      payload: { clientInstanceId: "client-a" },
    })).toBe(false)
  })

  it("recognizes client webhook delivery ack messages", () => {
    expect(isLiveDesktopClientMessage(createLiveEnvelope(LIVE_MESSAGE_TYPES.webhookDeliveryAck, {
      deliveryId: "delivery-1",
    }, {
      id: "msg-ack",
      sentAt: "2026-06-06T10:00:02.000Z",
    }))).toBe(true)

    expect(isLiveDesktopClientMessage(createLiveEnvelope(LIVE_MESSAGE_TYPES.webhookDeliveryAck, {
      deliveryId: "",
    }, {
      id: "msg-ack",
      sentAt: "2026-06-06T10:00:02.000Z",
    }))).toBe(false)
  })

  it("recognizes server webhook delivery messages", () => {
    expect(isLiveDesktopServerMessage(createLiveEnvelope(
      LIVE_MESSAGE_TYPES.webhookDeliveryReceived,
      {
        deliveryId: "delivery-1",
        webhook: { id: "db-id", publicId: "wh_abc", name: "GitHub" },
        request: {
          method: "POST",
          url: "https://synapse.test/webhooks/wh_abc/***",
          query: { event: "push" },
          headers: { "x-github-event": "push" },
          body: { repository: { full_name: "FairyEver/Synapse" } },
          contentType: "application/json",
          receivedAt: "2026-06-06T10:00:00.000Z",
        },
      },
      { id: "msg-2", sentAt: "2026-06-06T10:00:01.000Z" },
    ))).toBe(true)
  })
})
