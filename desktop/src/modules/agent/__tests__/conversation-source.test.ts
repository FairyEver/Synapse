import { describe, expect, it } from "vitest"

import {
  CONVERSATION_SOURCE_OPTIONS,
  conversationSourceForSession,
  filterSessionsBySource,
} from "../conversation-source"
import type { SynapseAgentSessionSummary } from "@/types/agent"

function session(platform?: string): SynapseAgentSessionSummary {
  return {
    projectId: "project-1",
    id: platform ?? "missing",
    sessionKey: "local:renderer",
    platform,
    active: false,
    historyCount: 0,
    createdAt: "2026-05-21T00:00:00.000Z",
    updatedAt: "2026-05-21T00:00:00.000Z",
  }
}

describe("conversation source filtering", () => {
  it("classifies known platform values", () => {
    expect(conversationSourceForSession(session(undefined))).toBe("user")
    expect(conversationSourceForSession(session("local"))).toBe("user")
    expect(conversationSourceForSession(session("local-renderer"))).toBe("user")
    expect(conversationSourceForSession(session("automation"))).toBe("automation")
    expect(conversationSourceForSession(session("scheduled"))).toBe("scheduled")
    expect(conversationSourceForSession(session("workflow"))).toBe("workflow")
    expect(conversationSourceForSession(session("webhook"))).toBe("webhook")
    expect(conversationSourceForSession(session("relay"))).toBe("relay")
    expect(conversationSourceForSession(session("slack"))).toBe("bridge")
  })

  it("keeps the default option as user conversations", () => {
    expect(CONVERSATION_SOURCE_OPTIONS[0]).toMatchObject({
      value: "user",
      label: "用户对话",
    })
  })

  it("filters sessions by selected source and preserves all mode", () => {
    const sessions = [
      session("local-renderer"),
      session("automation"),
      session("scheduled"),
      session("workflow"),
      session("slack"),
    ]

    expect(filterSessionsBySource(sessions, "user").map((item) => item.platform)).toEqual(["local-renderer"])
    expect(filterSessionsBySource(sessions, "automation").map((item) => item.platform)).toEqual(["automation"])
    expect(filterSessionsBySource(sessions, "scheduled").map((item) => item.platform)).toEqual(["scheduled"])
    expect(filterSessionsBySource(sessions, "workflow").map((item) => item.platform)).toEqual(["workflow"])
    expect(filterSessionsBySource(sessions, "bridge").map((item) => item.platform)).toEqual(["slack"])
    expect(filterSessionsBySource(sessions, "all")).toEqual(sessions)
  })
})
