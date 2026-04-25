import { describe, expect, it } from "vitest"
import {
  buildConnectorSessionKey,
  normalizeInboundMessage,
} from "../../electron/services/inbound-message-normalizer"

describe("inbound message normalizer", () => {
  it("normalizes CC Connect core.Message fields into the Synapse inbound model", () => {
    const result = normalizeInboundMessage({
      SessionKey: "telegram:100:55:7",
      Platform: "telegram",
      MessageID: "10",
      UserID: "7",
      UserName: "alice",
      ChatName: "Test Group",
      Content: "hello from topic",
      Images: [{ Name: "photo.png", MimeType: "image/png", Data: "base64" }],
      Files: [{ FileName: "doc.pdf", Size: 1234, Ref: "file-ref" }],
      Audio: { MimeType: "audio/ogg", URL: "https://example.test/a.ogg" },
      ChannelKey: "telegram:100",
      ReplyCtx: { chatID: 100, threadID: 55, messageID: 10 },
      ModeOverride: "plan",
    }, {
      connectorId: "connector:telegram:main",
      allowFrom: "7",
      now: () => new Date("2026-04-26T00:00:00.000Z"),
    })

    expect(result.ok).toBe(true)
    if (!result.ok) {
      throw new Error(result.message)
    }
    expect(result.message).toMatchObject({
      connectorId: "connector:telegram:main",
      platform: "telegram",
      sessionKey: "telegram:100:55:7",
      channelKey: "telegram:100",
      messageId: "10",
      userId: "7",
      userName: "alice",
      chatName: "Test Group",
      content: "hello from topic",
      fromVoice: false,
      modeOverride: "plan",
      authorized: true,
      receivedAt: "2026-04-26T00:00:00.000Z",
    })
    expect(result.message.attachments).toEqual([
      { kind: "image", name: "photo.png", mimeType: "image/png", hasInlineData: true },
      { kind: "file", name: "doc.pdf", size: 1234, ref: "file-ref" },
      { kind: "audio", mimeType: "audio/ogg", url: "https://example.test/a.ogg" },
    ])
    expect(result.diagnostic.attachmentCount).toBe(3)
  })

  it("rebuilds session keys from platform channel and user defaults like CC Connect adapters", () => {
    expect(buildConnectorSessionKey({
      platform: "telegram",
      channelId: "100",
      threadId: "55",
      userId: "7",
    })).toBe("telegram:100:55:7")
    expect(buildConnectorSessionKey({
      platform: "telegram",
      channelId: "100",
      threadId: "55",
      userId: "7",
      shareSessionInChannel: true,
    })).toBe("telegram:100:55")
    expect(buildConnectorSessionKey({
      platform: "wecom",
      userId: "zhangsan",
    })).toBe("wecom:zhangsan:zhangsan")
    expect(buildConnectorSessionKey({
      platform: "lark",
      channelId: "oc_test",
      userId: "ou_test",
      rootMessageId: "om_root",
      threadIsolation: true,
    })).toBe("lark:oc_test:root:om_root")
  })

  it("applies allow_from before delivering normalized inbound messages", () => {
    const result = normalizeInboundMessage({
      platform: "weibo",
      messageId: "blocked-1",
      userId: "user1",
      content: "hello",
    }, {
      allowFrom: "user2,user3",
    })

    expect(result).toMatchObject({
      ok: false,
      code: "unauthorized",
      message: "user is not allowed by allow_from",
    })
  })

  it("rejects empty messages without text, media, or location", () => {
    const result = normalizeInboundMessage({
      platform: "weibo",
      messageId: "empty-1",
      userId: "user1",
      text: "",
    }, {
      allowFrom: "*",
    })

    expect(result).toMatchObject({
      ok: false,
      code: "empty_message",
      message: "message has no content or attachments",
    })
  })

  it("keeps voice and location metadata in the unified model", () => {
    const result = normalizeInboundMessage({
      platform: "wecom",
      userId: "u1",
      chatId: "grp1",
      text: "voice transcript",
      fromVoice: true,
      location: { lat: 31.2, lng: 121.5, label: "Shanghai" },
    })

    expect(result.ok).toBe(true)
    if (!result.ok) {
      throw new Error(result.message)
    }
    expect(result.message).toMatchObject({
      sessionKey: "wecom:grp1:u1",
      channelKey: "wecom:grp1",
      content: "voice transcript",
      fromVoice: true,
      location: {
        latitude: 31.2,
        longitude: 121.5,
        label: "Shanghai",
      },
    })
  })
})
