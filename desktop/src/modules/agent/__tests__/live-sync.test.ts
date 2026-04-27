import { describe, expect, it } from "vitest"

import {
  clearConversationUnread,
  incrementUnreadForConversation,
  isSelectedConversation,
  shouldAutoFollowConversation,
  shouldApplyTimelineSnapshot,
} from "../live-sync"

describe("agent live sync helpers", () => {
  it("matches selected conversations by conversation id first", () => {
    expect(isSelectedConversation({
      conversationId: "feishu-conv",
      sessionKey: "feishu:chat:user",
    }, {
      conversationId: "feishu-conv",
      sessionKey: "local:renderer",
    })).toBe(true)

    expect(isSelectedConversation({
      conversationId: "feishu-conv",
      sessionKey: "feishu:chat:user",
    }, {
      conversationId: "local-conv",
      sessionKey: "feishu:chat:user",
    })).toBe(false)
  })

  it("falls back to session key when no conversation is selected", () => {
    expect(isSelectedConversation({
      sessionKey: "feishu:chat:user",
    }, {
      sessionKey: "feishu:chat:user",
    })).toBe(true)
  })

  it("increments unread only for non-selected conversations with ids", () => {
    expect(incrementUnreadForConversation({}, {
      conversationId: "feishu-conv",
      sessionKey: "feishu:chat:user",
    }, {
      conversationId: "local-conv",
      sessionKey: "local:renderer",
    })).toEqual({ "feishu-conv": 1 })

    expect(incrementUnreadForConversation({ "feishu-conv": 1 }, {
      conversationId: "feishu-conv",
      sessionKey: "feishu:chat:user",
    }, {
      conversationId: "local-conv",
      sessionKey: "local:renderer",
    })).toEqual({ "feishu-conv": 2 })

    expect(incrementUnreadForConversation({ "feishu-conv": 2 }, {
      conversationId: "feishu-conv",
      sessionKey: "feishu:chat:user",
    }, {
      conversationId: "feishu-conv",
      sessionKey: "local:renderer",
    })).toEqual({ "feishu-conv": 2 })
  })

  it("clears unread for a selected conversation", () => {
    expect(clearConversationUnread({
      "feishu-conv": 3,
      "other-conv": 1,
    }, "feishu-conv")).toEqual({ "other-conv": 1 })
  })

  it("auto-follows only clean Feishu updates when enabled", () => {
    expect(shouldAutoFollowConversation({
      conversationId: "feishu-conv",
      projectId: "project-1",
      sessionKey: "feishu:chat:user",
      platform: "feishu",
    }, {
      followFeishu: true,
      inputDirty: false,
      selectedConversationId: "local-conv",
      selectedSessionKey: "local:renderer",
    })).toBe(true)

    expect(shouldAutoFollowConversation({
      conversationId: "feishu-conv",
      projectId: "project-1",
      sessionKey: "feishu:chat:user",
      platform: "feishu",
    }, {
      followFeishu: true,
      inputDirty: true,
      selectedConversationId: "local-conv",
      selectedSessionKey: "local:renderer",
    })).toBe(false)

    expect(shouldAutoFollowConversation({
      conversationId: "bridge-conv",
      projectId: "project-1",
      sessionKey: "bridge:chat:user",
      platform: "bridge",
    }, {
      followFeishu: true,
      inputDirty: false,
      selectedConversationId: "local-conv",
      selectedSessionKey: "local:renderer",
    })).toBe(false)
  })

  it("applies timeline snapshots only for unchanged selected timelines", () => {
    expect(shouldApplyTimelineSnapshot({
      conversationId: "feishu-conv",
      sessionKey: "feishu:chat:user",
    }, {
      conversationId: "feishu-conv",
      sessionKey: "feishu:chat:user",
    }, {
      capturedVersion: 2,
      currentVersion: 2,
    })).toBe(true)

    expect(shouldApplyTimelineSnapshot({
      conversationId: "feishu-conv",
      sessionKey: "feishu:chat:user",
    }, {
      conversationId: "local-conv",
      sessionKey: "local:renderer",
    }, {
      capturedVersion: 2,
      currentVersion: 2,
    })).toBe(false)

    expect(shouldApplyTimelineSnapshot({
      conversationId: "feishu-conv",
      sessionKey: "feishu:chat:user",
    }, {
      conversationId: "feishu-conv",
      sessionKey: "feishu:chat:user",
    }, {
      capturedVersion: 2,
      currentVersion: 3,
    })).toBe(false)
  })
})
