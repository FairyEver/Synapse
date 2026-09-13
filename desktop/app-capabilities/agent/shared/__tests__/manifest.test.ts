import { describe, expect, it } from "vitest"
import { agentConversationCapabilityManifest } from "../manifest"
import { buildAgentConversationDeepLink } from "../schema"

describe("Agent conversation capability manifest", () => {
  it("declares eleven MCP tools and only one open deep link without another app surface", () => {
    expect(agentConversationCapabilityManifest).toMatchObject({
      id: "agent",
      app: null,
      workflowNodes: [],
      deepLinks: [],
      protocolRoutes: [{ hostname: "threads", action: "open", capabilityId: "app.agent.conversation.open" }],
    })
    expect(agentConversationCapabilityManifest.capabilities).toHaveLength(11)
    expect(agentConversationCapabilityManifest.mcpTools).toEqual([
      "app_agent_conversation_open",
      "app_agent_conversation_inspect",
      "app_agent_conversation_observe",
      "app_agent_message_send",
      "app_agent_turn_steer",
      "app_agent_turn_stop",
      "app_agent_turn_force_stop",
      "app_agent_permission_respond",
      "app_agent_group_list",
      "app_agent_conversation_create",
      "app_agent_provider_list",
    ])
  })

  it("builds a deterministic encoded local deep link", () => {
    expect(() => buildAgentConversationDeepLink({
      projectId: "project / one",
      conversationId: "conversation?二",
    })).toThrow("agent_conversation_reference_required")
    expect(buildAgentConversationDeepLink({
      projectId: "project one",
      conversationRef: "agc_abcdefghijklmnopqrstuv.abc",
    })).toBe(
      "synapse://threads/abcdefghijklmnopqrstuv%2Eabc",
    )
    expect(buildAgentConversationDeepLink({
      projectId: "project one",
      conversationRef: "agc_abcdefghij_lmnopqrstuv.abc",
    })).toBe(
      "synapse://threads/abcdefghij%5Flmnopqrstuv%2Eabc",
    )
  })
})
