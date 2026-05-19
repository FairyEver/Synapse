import { describe, expect, it } from "vitest"

import {
  clearConversationUnread,
  incrementUnreadForConversation,
  isSelectedConversation,
  shouldApplyPhaseUpdate,
  shouldApplyTimelineSnapshot,
} from "../live-sync"

describe("agent live sync helpers", () => {
  it("matches selected conversations by conversation id first", () => {
    expect(isSelectedConversation({
      projectId: "project-1",
      conversationId: "external-conv",
      sessionKey: "external:chat:user",
    }, {
      projectId: "project-1",
      conversationId: "external-conv",
      sessionKey: "local:renderer",
    })).toBe(true)

    expect(isSelectedConversation({
      projectId: "project-1",
      conversationId: "external-conv",
      sessionKey: "external:chat:user",
    }, {
      projectId: "project-1",
      conversationId: "local-conv",
      sessionKey: "external:chat:user",
    })).toBe(false)
  })

  it("does not match equal conversation ids across different projects", () => {
    expect(isSelectedConversation({
      projectId: "project-2",
      conversationId: "shared-conv",
      sessionKey: "external:chat:user",
    }, {
      projectId: "project-1",
      conversationId: "shared-conv",
      sessionKey: "external:chat:user",
    })).toBe(false)
  })

  it("falls back to session key when no conversation is selected", () => {
    expect(isSelectedConversation({
      projectId: "project-1",
      sessionKey: "external:chat:user",
    }, {
      projectId: "project-1",
      sessionKey: "external:chat:user",
    })).toBe(true)
  })

  it("increments unread only for non-selected conversations with ids", () => {
    expect(incrementUnreadForConversation({}, {
      projectId: "project-1",
      conversationId: "external-conv",
      sessionKey: "external:chat:user",
    }, {
      projectId: "project-1",
      conversationId: "local-conv",
      sessionKey: "local:renderer",
    })).toEqual({ "project-1:external-conv": 1 })

    expect(incrementUnreadForConversation({ "project-1:external-conv": 1 }, {
      projectId: "project-1",
      conversationId: "external-conv",
      sessionKey: "external:chat:user",
    }, {
      projectId: "project-1",
      conversationId: "local-conv",
      sessionKey: "local:renderer",
    })).toEqual({ "project-1:external-conv": 2 })

    expect(incrementUnreadForConversation({ "project-1:external-conv": 2 }, {
      projectId: "project-1",
      conversationId: "external-conv",
      sessionKey: "external:chat:user",
    }, {
      projectId: "project-1",
      conversationId: "external-conv",
      sessionKey: "local:renderer",
    })).toEqual({ "project-1:external-conv": 2 })

    expect(incrementUnreadForConversation({}, {
      projectId: "project-2",
      conversationId: "shared-conv",
      sessionKey: "external:chat:user",
    }, {
      projectId: "project-1",
      conversationId: "shared-conv",
      sessionKey: "local:renderer",
    })).toEqual({ "project-2:shared-conv": 1 })
  })

  it("clears unread for a selected conversation", () => {
    expect(clearConversationUnread({
      "project-1:external-conv": 3,
      "project-2:external-conv": 1,
    }, "project-1", "external-conv")).toEqual({ "project-2:external-conv": 1 })
  })

  it("applies timeline snapshots only for unchanged selected timelines", () => {
    expect(shouldApplyTimelineSnapshot({
      projectId: "project-1",
      conversationId: "external-conv",
      sessionKey: "external:chat:user",
    }, {
      projectId: "project-1",
      conversationId: "external-conv",
      sessionKey: "external:chat:user",
    }, {
      capturedVersion: 2,
      currentVersion: 2,
    })).toBe(true)

    expect(shouldApplyTimelineSnapshot({
      projectId: "project-1",
      conversationId: "external-conv",
      sessionKey: "external:chat:user",
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
      conversationId: "external-conv",
      sessionKey: "external:chat:user",
    }, {
      projectId: "project-1",
      conversationId: "external-conv",
      sessionKey: "external:chat:user",
    }, {
      capturedVersion: 2,
      currentVersion: 3,
    })).toBe(false)
  })

  it("does not apply pending phase updates for background conversations", () => {
    expect(shouldApplyPhaseUpdate({
      projectId: "project-1",
      conversationId: "background-conv",
      sessionKey: "external:chat:user",
    }, {
      projectId: "project-1",
      conversationId: "local-conv",
      sessionKey: "local:renderer",
    }, {
      pendingConversationIds: new Set(["background-conv"]),
    })).toBe(false)
  })

  it("applies phase updates for the selected project while conversation id is still resolving", () => {
    expect(shouldApplyPhaseUpdate({
      projectId: "project-2",
      conversationId: "shared-conv",
      sessionKey: "local:renderer",
    }, {
      projectId: "project-2",
      sessionKey: "local:renderer",
    }, {
      pendingConversationIds: new Set(["shared-conv"]),
    })).toBe(true)
  })

  it("applies phase updates for the selected conversation", () => {
    expect(shouldApplyPhaseUpdate({
      projectId: "project-1",
      conversationId: "local-conv",
      sessionKey: "local:renderer",
    }, {
      projectId: "project-1",
      conversationId: "local-conv",
      sessionKey: "local:renderer",
    }, {
      pendingConversationIds: new Set<string>(),
    })).toBe(true)
  })
})
