import { describe, expect, it } from "vitest"
import {
  buildAgentConversationWindowSearchParams,
  parseAgentConversationWindowRequest,
} from "@/lib/agent-conversation-window"

describe("agent conversation window request parsing", () => {
  it("round-trips an agent conversation window request", () => {
    const params = buildAgentConversationWindowSearchParams({
      projectId: "project-1",
      conversationId: "conversation-1",
      sessionKey: "local:renderer",
      title: "新会话 08:04 AM",
    })

    expect(parseAgentConversationWindowRequest(`?${params.toString()}`)).toEqual({
      projectId: "project-1",
      conversationId: "conversation-1",
      sessionKey: "local:renderer",
      title: "新会话 08:04 AM",
    })
  })

  it("omits blank optional title", () => {
    const params = buildAgentConversationWindowSearchParams({
      projectId: "project-1",
      conversationId: "conversation-1",
      sessionKey: "local:renderer",
      title: "   ",
    })

    expect(parseAgentConversationWindowRequest(`?${params.toString()}`)).toEqual({
      projectId: "project-1",
      conversationId: "conversation-1",
      sessionKey: "local:renderer",
    })
  })

  it("rejects non-agent-conversation windows", () => {
    expect(parseAgentConversationWindowRequest("?synapseWindow=content&id=x")).toBeNull()
  })

  it("rejects missing target fields", () => {
    expect(parseAgentConversationWindowRequest("?synapseWindow=agent-conversation&projectId=p&conversationId=c")).toBeNull()
    expect(parseAgentConversationWindowRequest("?synapseWindow=agent-conversation&projectId=p&sessionKey=s")).toBeNull()
    expect(parseAgentConversationWindowRequest("?synapseWindow=agent-conversation&conversationId=c&sessionKey=s")).toBeNull()
  })
})
