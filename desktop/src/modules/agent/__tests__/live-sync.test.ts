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
      projectId: "project-1",
      conversationId: "feishu-conv",
      sessionKey: "feishu:chat:user",
    }, {
      projectId: "project-1",
      conversationId: "feishu-conv",
      sessionKey: "local:renderer",
    })).toBe(true)

    expect(isSelectedConversation({
      projectId: "project-1",
      conversationId: "feishu-conv",
      sessionKey: "feishu:chat:user",
    }, {
      projectId: "project-1",
      conversationId: "local-conv",
      sessionKey: "feishu:chat:user",
    })).toBe(false)
  })

  it("does not match equal conversation ids across different projects", () => {
    expect(isSelectedConversation({
      projectId: "project-2",
      conversationId: "shared-conv",
      sessionKey: "feishu:chat:user",
    }, {
      projectId: "project-1",
      conversationId: "shared-conv",
      sessionKey: "feishu:chat:user",
    })).toBe(false)
  })

  it("falls back to session key when no conversation is selected", () => {
    expect(isSelectedConversation({
      projectId: "project-1",
      sessionKey: "feishu:chat:user",
    }, {
      projectId: "project-1",
      sessionKey: "feishu:chat:user",
    })).toBe(true)
  })

  it("increments unread only for non-selected conversations with ids", () => {
    expect(incrementUnreadForConversation({}, {
      projectId: "project-1",
      conversationId: "feishu-conv",
      sessionKey: "feishu:chat:user",
    }, {
      projectId: "project-1",
      conversationId: "local-conv",
      sessionKey: "local:renderer",
    })).toEqual({ "project-1:feishu-conv": 1 })

    expect(incrementUnreadForConversation({ "project-1:feishu-conv": 1 }, {
      projectId: "project-1",
      conversationId: "feishu-conv",
      sessionKey: "feishu:chat:user",
    }, {
      projectId: "project-1",
      conversationId: "local-conv",
      sessionKey: "local:renderer",
    })).toEqual({ "project-1:feishu-conv": 2 })

    expect(incrementUnreadForConversation({ "project-1:feishu-conv": 2 }, {
      projectId: "project-1",
      conversationId: "feishu-conv",
      sessionKey: "feishu:chat:user",
    }, {
      projectId: "project-1",
      conversationId: "feishu-conv",
      sessionKey: "local:renderer",
    })).toEqual({ "project-1:feishu-conv": 2 })

    expect(incrementUnreadForConversation({}, {
      projectId: "project-2",
      conversationId: "shared-conv",
      sessionKey: "feishu:chat:user",
    }, {
      projectId: "project-1",
      conversationId: "shared-conv",
      sessionKey: "local:renderer",
    })).toEqual({ "project-2:shared-conv": 1 })
  })

  it("clears unread for a selected conversation", () => {
    expect(clearConversationUnread({
      "project-1:feishu-conv": 3,
      "project-2:feishu-conv": 1,
    }, "project-1", "feishu-conv")).toEqual({ "project-2:feishu-conv": 1 })
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
      selectedProjectId: "project-1",
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
      selectedProjectId: "project-1",
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
      selectedProjectId: "project-1",
      selectedConversationId: "local-conv",
      selectedSessionKey: "local:renderer",
    })).toBe(false)
  })

  it("applies timeline snapshots only for unchanged selected timelines", () => {
    expect(shouldApplyTimelineSnapshot({
      projectId: "project-1",
      conversationId: "feishu-conv",
      sessionKey: "feishu:chat:user",
    }, {
      projectId: "project-1",
      conversationId: "feishu-conv",
      sessionKey: "feishu:chat:user",
    }, {
      capturedVersion: 2,
      currentVersion: 2,
    })).toBe(true)

    expect(shouldApplyTimelineSnapshot({
      projectId: "project-1",
      conversationId: "feishu-conv",
      sessionKey: "feishu:chat:user",
    }, {
      projectId: "project-1",
      conversationId: "local-conv",
      sessionKey: "local:renderer",
    }, {
      capturedVersion: 2,
      currentVersion: 2,
    })).toBe(false)

    expect(shouldApplyTimelineSnapshot({
      projectId: "project-1",
      conversationId: "feishu-conv",
      sessionKey: "feishu:chat:user",
    }, {
      projectId: "project-1",
      conversationId: "feishu-conv",
      sessionKey: "feishu:chat:user",
    }, {
      capturedVersion: 2,
      currentVersion: 3,
    })).toBe(false)
  })
})
