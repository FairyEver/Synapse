import { describe, expect, it } from "vitest"

import {
  BRIDGE_ATTACHMENT_DATA_MAX_CHARS,
  BRIDGE_ATTACHMENT_MAX_COUNT,
  BRIDGE_MESSAGE_CONTENT_MAX_CHARS,
  BRIDGE_REPLY_CONTEXT_MAX_BYTES,
  normalizeCapabilities,
  parseBridgeBase,
  parseBridgeMessage,
  parseBridgePreviewAck,
  parseBridgeRegister,
  sanitizeBridgeMetadata,
} from "../bridge-protocol"

describe("bridge protocol schema", () => {
  it("accepts register and defaults text capability", () => {
    const parsed = parseBridgeRegister({
      type: "register",
      platform: "adapter",
      capabilities: ["card"],
    })
    expect(parsed.ok).toBe(true)
    expect([...normalizeCapabilities(parsed.ok ? parsed.value.capabilities : [])].sort())
      .toEqual(["card", "text"])
  })

  it("rejects register without platform", () => {
    const parsed = parseBridgeRegister({
      type: "register",
      capabilities: ["text"],
    })
    expect(parsed.ok).toBe(false)
  })

  it("rejects message without session or user", () => {
    expect(parseBridgeMessage({
      type: "message",
      user_id: "u1",
      content: "hello",
      reply_ctx: "ctx",
    }).ok).toBe(false)
    expect(parseBridgeMessage({
      type: "message",
      session_key: "s1",
      content: "hello",
      reply_ctx: "ctx",
    }).ok).toBe(false)
  })

  it("rejects oversized message fields", () => {
    const baseMessage = {
      type: "message",
      session_key: "s1",
      user_id: "u1",
      content: "hello",
      reply_ctx: "ctx",
    }

    expect(parseBridgeMessage({
      ...baseMessage,
      content: "x".repeat(BRIDGE_MESSAGE_CONTENT_MAX_CHARS + 1),
    }).ok).toBe(false)
    expect(parseBridgeMessage({
      ...baseMessage,
      reply_ctx: { value: "x".repeat(BRIDGE_REPLY_CONTEXT_MAX_BYTES) },
    }).ok).toBe(false)
    expect(parseBridgeMessage({
      ...baseMessage,
      images: Array.from({ length: BRIDGE_ATTACHMENT_MAX_COUNT + 1 }, () => ({
        mime_type: "image/png",
        data: "a",
      })),
    }).ok).toBe(false)
    expect(parseBridgeMessage({
      ...baseMessage,
      files: [{
        mime_type: "text/plain",
        file_name: "a.txt",
        data: "a".repeat(BRIDGE_ATTACHMENT_DATA_MAX_CHARS + 1),
      }],
    }).ok).toBe(false)
  })

  it("parses unknown types without throwing", () => {
    expect(parseBridgeBase({ type: "something_new" })).toEqual({
      ok: true,
      type: "something_new",
    })
  })

  it("accepts preview acknowledgements", () => {
    expect(parseBridgePreviewAck({
      type: "preview_ack",
      ref_id: "ref-1",
      preview_handle: "message-1",
    })).toEqual({
      ok: true,
      value: {
        type: "preview_ack",
        ref_id: "ref-1",
        preview_handle: "message-1",
      },
    })
  })

  it("removes token-like metadata keys", () => {
    expect(sanitizeBridgeMetadata({
      control_plane: ["capabilities_snapshot_v1"],
      token: "secret",
      nested: { authorization: "bearer", ok: true },
    })).toEqual({
      control_plane: ["capabilities_snapshot_v1"],
      nested: { ok: true },
    })
  })

  it("redacts token-like metadata string values", () => {
    const sanitized = sanitizeBridgeMetadata({
      note: "authorization=Bearer sk-live token:sk-token cookie=session-id",
      nested: {
        detail: "apiKey=sk-api credential:super-secret",
      },
    })

    expect(sanitized).toEqual({
      note: "authorization=[redacted] token:[redacted] cookie=[redacted]",
      nested: {
        detail: "apiKey=[redacted] credential:[redacted]",
      },
    })
    expect(JSON.stringify(sanitized)).not.toContain("sk-live")
    expect(JSON.stringify(sanitized)).not.toContain("sk-token")
    expect(JSON.stringify(sanitized)).not.toContain("session-id")
    expect(JSON.stringify(sanitized)).not.toContain("super-secret")
  })
})
