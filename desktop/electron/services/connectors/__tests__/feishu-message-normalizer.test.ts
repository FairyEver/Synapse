import { describe, expect, it } from "vitest"

import type { ConnectorRecord } from "../types"
import { normalizeFeishuMessage } from "../feishu/message-normalizer"

describe("normalizeFeishuMessage", () => {
  it("normalizes mentioned group text into an AgentMessage and stores dedupe", () => {
    const result = normalizeFeishuMessage({
      projectId: "project-1",
      connector: connector(),
      botOpenId: "ou_bot",
      event: {
        sender: { sender_id: { open_id: "ou_user" } },
        message: {
          message_id: "m1",
          create_time: "1777161600000",
          chat_id: "oc_group",
          chat_type: "group",
          message_type: "text",
          content: JSON.stringify({ text: "@bot hello" }),
          mentions: [{
            key: "@bot",
            id: { open_id: "ou_bot" },
          }],
        },
      },
    })

    expect(result.kind).toBe("message")
    if (result.kind !== "message") return
    expect(result.message).toEqual(expect.objectContaining({
      projectId: "project-1",
      platform: "feishu",
      sessionKey: "feishu:oc_group:ou_user",
      content: "hello",
      chatType: "group",
      replyCtx: expect.objectContaining({
        kind: "feishu",
        connectorId: "feishu:project-1",
        chatId: "oc_group",
        messageId: "m1",
      }),
    }))
    expect(result.dedupe.lastMessageIds).toEqual(["m1"])
  })

  it("ignores duplicate, stale, unmentioned, and disallowed messages", () => {
    expect(normalizeFeishuMessage({
      projectId: "project-1",
      connector: connector({ dedupe: { ttlMs: 60_000, lastMessageIds: ["m1"] } }),
      event: message({ message_id: "m1" }),
    })).toEqual(expect.objectContaining({ kind: "ignored", reason: "duplicate_message" }))

    expect(normalizeFeishuMessage({
      projectId: "project-1",
      connector: connector({ dedupe: { ttlMs: 60_000, ignoreBefore: "2026-04-26T00:00:00.000Z" } }),
      event: message({ create_time: "1000" }),
    })).toEqual(expect.objectContaining({ kind: "ignored", reason: "old_message" }))

    expect(normalizeFeishuMessage({
      projectId: "project-1",
      connector: connector(),
      botOpenId: "ou_bot",
      event: message({ chat_type: "group", mentions: [] }),
    })).toEqual(expect.objectContaining({ kind: "ignored", reason: "no_bot_mention" }))

    expect(normalizeFeishuMessage({
      projectId: "project-1",
      connector: connector({ allowlist: { mode: "users", userIds: ["ou_other"] } }),
      event: message(),
    })).toEqual(expect.objectContaining({ kind: "ignored", reason: "sender_not_allowed" }))
  })
})

function connector(patch: Partial<ConnectorRecord> = {}): ConnectorRecord {
  return {
    id: "feishu:project-1",
    schemaVersion: 1,
    projectId: "project-1",
    platform: "feishu",
    status: "connected",
    allowlist: { mode: "all" },
    sessionKeyPolicy: { mode: "per-user" },
    dedupe: { ttlMs: 60_000, lastMessageIds: [], ignoreBefore: "2026-04-26T00:00:00.000Z" },
    ...patch,
  }
}

function message(patch: Record<string, unknown> = {}) {
  return {
    sender: { sender_id: { open_id: "ou_user" } },
    message: {
      message_id: "m2",
      create_time: "1777161600000",
      chat_id: "oc_group",
      chat_type: "p2p",
      message_type: "text",
      content: JSON.stringify({ text: "hello" }),
      ...patch,
    },
  }
}
