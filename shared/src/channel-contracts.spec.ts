import { describe, expect, it } from "vitest"
import {
  CHANNEL_CLIENT_ID_REGEX,
  CHANNEL_EVENT_NAME_REGEX,
  CHANNEL_MAX_EVENT_FILTERS,
  CHANNEL_META_MAX_BYTES,
  CHANNEL_PAYLOAD_MAX_BYTES,
  CHANNEL_TOKEN_ROLES,
  CHANNEL_WS_CLOSE_CODES,
  CHANNEL_WS_FRAME_MAX_BYTES,
  channelClientIdSchema,
  channelCreateSchema,
  channelEventNameSchema,
  channelKeyResourcesSchema,
  channelMetaSchema,
  channelPayloadSchema,
  channelPublishHttpSchema,
  channelRoleSchema,
  channelTokenCreateSchema,
  channelUpdateSchema,
  channelWsClientFrameSchema,
  channelWsServerFrameSchema,
  matchesChannelEventFilter,
} from "./channel-contracts.js"

describe("channel-contracts", () => {
  it("exposes spec constants and close codes", () => {
    expect(CHANNEL_PAYLOAD_MAX_BYTES).toBe(65536)
    expect(CHANNEL_META_MAX_BYTES).toBe(2048)
    expect(CHANNEL_WS_FRAME_MAX_BYTES).toBe(131072)
    expect(CHANNEL_MAX_EVENT_FILTERS).toBe(20)
    expect(CHANNEL_TOKEN_ROLES).toEqual(["subscribe", "publish", "pubsub"])
    expect(CHANNEL_WS_CLOSE_CODES).toEqual({
      NORMAL: 1000,
      GOING_AWAY: 1001,
      AUTH_FAILED: 4001,
      REVOKED: 4003,
      ROLE_CHANGED: 4004,
      TIMEOUT_OR_SLOW: 4008,
      LIMIT_EXCEEDED: 4029,
    })
    expect(CHANNEL_EVENT_NAME_REGEX.test("slide.next:1_a-b")).toBe(true)
    expect(CHANNEL_EVENT_NAME_REGEX.test("slide next")).toBe(false)
    expect(CHANNEL_CLIENT_ID_REGEX.test("big-screen_1:a.b")).toBe(true)
  })

  it("enforces UTF-8 byte cap on payload including multi-byte CJK strings and accepts null", () => {
    expect(channelPayloadSchema.safeParse(null).success).toBe(true)
    expect(channelPayloadSchema.safeParse({ step: 1, ok: true }).success).toBe(true)

    // 22000 CJK chars => .length = 22000 (< 65536), UTF-8 bytes = 66000 + 2 quotes > 65536
    const oversizedCjk = "中".repeat(22000)
    expect(oversizedCjk.length).toBeLessThan(CHANNEL_PAYLOAD_MAX_BYTES)
    expect(channelPayloadSchema.safeParse(oversizedCjk).success).toBe(false)

    // 65534 ASCII chars + 2 quotes = 65536 UTF-8 bytes => valid
    expect(channelPayloadSchema.safeParse("a".repeat(65534)).success).toBe(true)
    expect(channelPayloadSchema.safeParse("a".repeat(65535)).success).toBe(false)
  })

  it("enforces UTF-8 byte cap and plain object constraint on meta", () => {
    expect(channelMetaSchema.safeParse({ kind: "remote", v: 1 }).success).toBe(true)
    expect(channelMetaSchema.safeParse(["not-an-object"]).success).toBe(false)
    expect(channelMetaSchema.safeParse(null).success).toBe(false)

    const oversizedMeta = { label: "测".repeat(700) } // 2100+ UTF-8 bytes
    expect(channelMetaSchema.safeParse(oversizedMeta).success).toBe(false)
  })

  it("validates channel, token, key resource, and HTTP publish schemas", () => {
    expect(channelRoleSchema.safeParse("pubsub").success).toBe(true)
    expect(channelRoleSchema.safeParse("admin").success).toBe(false)
    expect(channelEventNameSchema.safeParse("scene.current").success).toBe(true)
    expect(channelClientIdSchema.safeParse("phone-1").success).toBe(true)

    expect(channelCreateSchema.safeParse({ name: "客厅大屏" }).success).toBe(true)
    expect(channelUpdateSchema.safeParse({ name: "客厅大屏", description: "遥控器联动" }).success).toBe(true)
    expect(channelTokenCreateSchema.safeParse({ name: "大屏只读", role: "subscribe" }).success).toBe(true)

    expect(channelKeyResourcesSchema.safeParse({ mode: "selected", channelIds: ["ch_1"] }).success).toBe(true)
    expect(channelKeyResourcesSchema.safeParse({ mode: "all_owned", channelIds: [] }).success).toBe(true)
    expect(channelKeyResourcesSchema.safeParse({ mode: "all_owned", channelIds: ["ch_1"] }).success).toBe(false)
    expect(channelKeyResourcesSchema.safeParse({ mode: "selected", channelIds: ["ch_1", "ch_1"] }).success).toBe(false)

    expect(channelPublishHttpSchema.safeParse({
      event: "slide.next",
      payload: { step: 1 },
      retain: true,
    }).success).toBe(true)

    expect(channelPublishHttpSchema.safeParse({
      event: "slide.next",
      payload: { step: 1 },
      retain: true,
      targetClientId: "big-screen-1",
    }).success).toBe(false)
  })

  it("validates WS client frames including auth filter limit, publish retain+target conflict, and retained.clear", () => {
    expect(channelWsClientFrameSchema.safeParse({
      type: "auth",
      token: "syc_test123",
      events: Array.from({ length: 21 }, (_, idx) => `ev.${idx}`),
    }).success).toBe(false)

    expect(channelWsClientFrameSchema.safeParse({
      type: "auth",
      token: "syc_test123",
      events: ["screen.*", "command.result"],
      afterSeq: 120,
      includeRetained: true,
    }).success).toBe(true)

    expect(channelWsClientFrameSchema.safeParse({
      type: "publish",
      id: "req-1",
      event: "slide.next",
      payload: { step: 1 },
      retain: true,
      targetClientId: "big-screen-1",
    }).success).toBe(false)

    expect(channelWsClientFrameSchema.safeParse({
      type: "retained.clear",
      id: "r1",
      event: "scene.current",
    }).success).toBe(true)

    expect(channelWsClientFrameSchema.safeParse({ type: "ping" }).success).toBe(true)
  })

  it("validates WS server frames including publish ack and retained.clear ack", () => {
    expect(channelWsServerFrameSchema.safeParse({
      type: "ack",
      id: "req-1",
      seq: 126,
      deliveredCount: 2,
      retained: false,
    }).success).toBe(true)

    expect(channelWsServerFrameSchema.safeParse({
      type: "ack",
      id: "r1",
      deleted: true,
    }).success).toBe(true)

    expect(channelWsServerFrameSchema.safeParse({
      type: "ack",
      id: "bad-mixed",
      seq: 1,
      deliveredCount: 0,
      retained: false,
      deleted: true,
    }).success).toBe(false)

    expect(channelWsServerFrameSchema.safeParse({
      type: "ready",
      channelId: "ch_1",
      connectionId: "conn_1",
      clientId: "remote-1",
      role: "pubsub",
      latestSeq: 10,
      replayTruncated: false,
      presence: [],
      retained: [],
    }).success).toBe(true)
  })

  it("matches channel event filters with exact names and trailing .* wildcards", () => {
    expect(matchesChannelEventFilter("screen.page.next", ["screen.*"])).toBe(true)
    expect(matchesChannelEventFilter("screen", ["screen.*"])).toBe(false)
    expect(matchesChannelEventFilter("screen2.next", ["screen.*"])).toBe(false)
    expect(matchesChannelEventFilter("any", undefined)).toBe(true)
    expect(matchesChannelEventFilter("slide.next", ["slide.next"])).toBe(true)
    expect(matchesChannelEventFilter("slide.prev", ["slide.next"])).toBe(false)
  })
})
