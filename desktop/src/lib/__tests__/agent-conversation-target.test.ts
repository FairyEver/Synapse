/**
 * @vitest-environment jsdom
 */
import { afterEach, describe, expect, it, vi } from "vitest"
import {
  agentConversationTargetFromOutputs,
  openAgentConversationTarget,
} from "../agent-conversation-target"

describe("agent conversation target helpers", () => {
  afterEach(() => {
    delete (window as unknown as { synapse?: unknown }).synapse
    vi.clearAllMocks()
  })

  it("extracts a nested Agent conversation target", () => {
    const target = agentConversationTargetFromOutputs({
      agentConversation: {
        projectId: "project-1",
        conversationId: "conversation-1",
        sessionKey: "workflow:project-1:123",
        platform: "workflow",
      },
    })

    expect(target).toEqual({
      projectId: "project-1",
      conversationId: "conversation-1",
      sessionKey: "workflow:project-1:123",
      platform: "workflow",
    })
  })

  it("extracts a flat Agent conversation target", () => {
    const target = agentConversationTargetFromOutputs({
      projectId: "project-1",
      conversationId: "conversation-1",
      sessionKey: "scheduled:project-1:123",
      platform: "scheduled",
    })

    expect(target).toEqual({
      projectId: "project-1",
      conversationId: "conversation-1",
      sessionKey: "scheduled:project-1:123",
      platform: "scheduled",
    })
  })

  it("ignores incomplete Agent conversation targets", () => {
    expect(agentConversationTargetFromOutputs({
      agentConversation: {
        projectId: "project-1",
        conversationId: "conversation-1",
        platform: "workflow",
      },
    })).toBeNull()
  })

  it("calls the bridge to open the target", async () => {
    const target = {
      projectId: "project-1",
      conversationId: "conversation-1",
      sessionKey: "workflow:project-1:123",
      platform: "workflow" as const,
    }
    const openConversation = vi.fn().mockResolvedValue({ opened: true })
    ;(window as unknown as { synapse?: unknown }).synapse = {
      agent: { openConversation },
    }

    await expect(openAgentConversationTarget(target)).resolves.toEqual({ opened: true })
    expect(openConversation).toHaveBeenCalledWith(target)
  })
})
