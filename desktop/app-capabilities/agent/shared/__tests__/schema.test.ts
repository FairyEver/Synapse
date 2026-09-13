import { describe, expect, it } from "vitest"

import { buildAgentConversationMcpTools } from "../mcp-tools"
import {
  agentConversationCreateInputSchema,
  agentGroupListInputSchema,
  agentProviderListInputSchema,
  agentConversationInspectInputSchema,
  agentConversationObserveInputSchema,
  parseAgentConversationDeepLink,
  resolveAgentConversationTargetInput,
  agentMessageSendInputSchema,
  agentPermissionRespondInputSchema,
  agentTurnSteerInputSchema,
} from "../schema"

const target = { projectId: "project-1", conversationId: "conversation-1" }

describe("Agent conversation public schemas", () => {
  it("accepts default creation and one group selector, rejecting mixed targets and runtime overrides", () => {
    const key = { idempotencyKey: "8cc55d4d-a4df-4dd8-b5fd-6f1da3385c0f" }
    expect(agentConversationCreateInputSchema.parse(key)).toEqual(key)
    expect(agentConversationCreateInputSchema.safeParse({ ...key, providerId: "custom", modelTier: "opus" }).success).toBe(true)
    for (const selection of [{ providerId: "custom" }, { modelTier: "opus" }, { providerId: "custom", modelTier: "bogus" }]) {
      expect(agentConversationCreateInputSchema.safeParse({ ...key, ...selection }).success).toBe(false)
    }
    expect(agentProviderListInputSchema.parse({})).toEqual({ offset: 0, limit: 50 })
    expect(agentProviderListInputSchema.safeParse({ limit: 101 }).success).toBe(false)
    expect(agentProviderListInputSchema.safeParse({ secret: "canary" }).success).toBe(false)
    expect(agentConversationCreateInputSchema.parse({ ...key, name: " Test ", projectName: " Group " }))
      .toMatchObject({ name: "Test", projectName: "Group" })
    expect(agentConversationCreateInputSchema.safeParse({ ...key, sameGroupAs: target }).success).toBe(true)
    for (const input of [
      {}, { ...key, projectId: "one", projectName: "One" },
      { ...key, projectId: "one", sameGroupAs: target },
      { ...key, sameGroupAs: { projectId: "one" } },
      { ...key, sameGroupAs: { deepLink: "synapse://threads/example", ...target } },
      { ...key, name: " " }, { ...key, name: "a".repeat(257) },
      { ...key, mode: "bypassPermissions" }, { ...key, platform: "telegram" },
      { ...key, content: "hello" }, { ...key, workspacePath: "/tmp" },
    ]) expect(agentConversationCreateInputSchema.safeParse(input).success).toBe(false)
  })

  it("bounds group discovery and does not attach existing-conversation instructions to new tools", () => {
    expect(agentGroupListInputSchema.parse({})).toEqual({ offset: 0, limit: 50 })
    for (const input of [{ limit: 101 }, { offset: -1 }, { query: " " }, { secret: "canary" }]) {
      expect(agentGroupListInputSchema.safeParse(input).success).toBe(false)
    }
    const tools = buildAgentConversationMcpTools().filter((tool) =>
      ["app_agent_group_list", "app_agent_conversation_create"].includes(tool.name))
    for (const tool of tools) expect(tool.description).not.toContain("Provide exactly one target:")
  })

  it("uses strict bounded inspect and observe inputs", () => {
    expect(agentConversationInspectInputSchema.parse(target)).toEqual({ ...target, limit: 50 })
    expect(agentConversationInspectInputSchema.safeParse({ ...target, limit: 101 }).success).toBe(false)
    expect(agentConversationObserveInputSchema.safeParse({ ...target, afterRevision: 0, maxWaitMs: 30_001 }).success).toBe(false)
    expect(agentConversationInspectInputSchema.safeParse({ ...target, extra: true }).success).toBe(false)
  })

  it("accepts one raw deep link target without model-side identifier parsing", () => {
    const deepLink = "synapse://threads/abcdefghijklmnopqrstuv.abc"
    expect(agentConversationInspectInputSchema.parse({ deepLink })).toEqual({ deepLink, limit: 50 })
    expect(agentConversationInspectInputSchema.safeParse({ deepLink, ...target }).success).toBe(false)
    expect(agentConversationInspectInputSchema.safeParse({ projectId: "project-1" }).success).toBe(false)
  })

  it("parses the canonical thread path without requiring a project identifier", () => {
    expect(parseAgentConversationDeepLink(
      "synapse://threads/m0D4NOW0yDeagclYK2CiUQ.xrs",
    )).toEqual({
      conversationRef: "agc_m0D4NOW0yDeagclYK2CiUQ.xrs",
    })
    expect(parseAgentConversationDeepLink(
      "synapse://threads/abcdefghij%5Flmnopqrstuv.abc",
    )).toEqual({
      conversationRef: "agc_abcdefghij_lmnopqrstuv.abc",
    })
    expect(resolveAgentConversationTargetInput({
      conversationRef: "agc_m0D4NOW0yDeagclYK2CiUQ.xrs",
    })).toEqual({
      conversationRef: "agc_m0D4NOW0yDeagclYK2CiUQ.xrs",
    })
  })

  it.each([
    "synapse://threads/wTLA1hereyemgBQqKyvYFw\\.Woo",
    "synapse://threads/wTLA1hereyemgBQqKyvYFw%5C.Woo",
    "synapse://threads/wTLA1hereyemgBQqKyvYFw%2EWoo",
  ])("accepts Markdown-escaped or encoded thread separators: %s", (deepLink) => {
    expect(parseAgentConversationDeepLink(deepLink)).toEqual({
      conversationRef: "agc_wTLA1hereyemgBQqKyvYFw.Woo",
    })
  })

  it("normalizes only Markdown punctuation escapes inside a structurally valid thread id", () => {
    expect(parseAgentConversationDeepLink("synapse://threads/abcdefghij\\_lmnopqrstu\\-\\.abc"))
      .toEqual({ conversationRef: "agc_abcdefghij_lmnopqrstu-.abc" })
    for (const deepLink of [
      "synapse://threads/wTLA1hereyemgBQqKyvYFw\\\\.Woo",
      "synapse://threads/\\wTLA1hereyemgBQqKyvYFw.Woo",
      "synapse://threads/wTLA1hereyemgBQqKyvYFw\\/Woo",
      "synapse://threads/wTLA1hereyemgBQqKyvYFw\\.Woo?extra=1",
      "synapse://threads/wTLA1hereyemgBQqKyvYFw\\.Woo#extra",
      "synapse://threads/wTLA1hereyemgBQqKyvYFw%255C.Woo",
    ]) expect(() => parseAgentConversationDeepLink(deepLink)).toThrow()
  })

  it.each([
    "synapse://app/agent/open",
    "synapse://app/agent/open?projectId=project-1&conversationId=conversation-1",
    "synapse://app/agent/open?projectId=project-1&conversationId=conversation-1&extra=1",
    "synapse://app/agent/open?projectId=project-1&projectId=project-2&conversationId=conversation-1",
    "synapse://app/agent/open?projectId=project-1&conversationId=conversation-1#fragment",
    "synapse://app/agent/open?projectId=project-1&conversationId=%ZZ",
    "synapse://app/agent/open?projectId=project-1&conversationId=%E0%A4",
    "synapse://app/agent/open?%70rojectId=project-1&conversationId=conversation-1",
    "synapse://app/agent/open?projectId=project-1&conversationId=conversation-1&",
    "synapse://app/agent/open?projectId=project+1&conversationId=conversation-1",
    "synapse://threads",
    "synapse://threads/abcdefghijklmnopqrstuv.abc/extra",
    "synapse://threads/abcdefghijklmnopqrstuv.abc?projectId=project-1",
    "synapse://threads/abcdefghijklmnopqrstuv.abc#fragment",
    "synapse://threads/%ZZ",
    "https://app/agent/open?projectId=project-1&conversationId=conversation-1",
  ])("strictly rejects malformed raw Agent links: %s", (deepLink) => {
    expect(() => parseAgentConversationDeepLink(deepLink)).toThrow()
  })

  it("accepts a short conversation reference as the follow-up target", () => {
    expect(agentConversationObserveInputSchema.safeParse({
      projectId: "project-1",
      conversationRef: "agc_abcdefghijklmnopqrstuv.abc",
      afterRevision: 0,
      maxWaitMs: 30_000,
    }).success).toBe(true)
  })

  it("bounds UTF-8 message bytes and rejects slash steering", () => {
    expect(agentMessageSendInputSchema.safeParse({
      ...target,
      content: "消息",
      idempotencyKey: "8cc55d4d-a4df-4dd8-b5fd-6f1da3385c0f",
    }).success).toBe(true)
    expect(agentMessageSendInputSchema.safeParse({
      ...target,
      content: "界".repeat(22_000),
      idempotencyKey: "8cc55d4d-a4df-4dd8-b5fd-6f1da3385c0f",
    }).success).toBe(false)
    expect(agentTurnSteerInputSchema.safeParse({
      ...target,
      expectedTurnId: "turn-1",
      clientMessageId: "2289964b-0493-4cae-ae0d-46aa3812d87b",
      content: "/stop",
    }).success).toBe(false)
  })

  it("enforces strict permission response branches", () => {
    expect(agentPermissionRespondInputSchema.safeParse({
      ...target,
      expectedTurnId: "turn-1",
      requestId: "request-1",
      idempotencyKey: "8cc55d4d-a4df-4dd8-b5fd-6f1da3385c0f",
      kind: "tool_permission",
      expectedToolName: "Bash",
      decision: "allow_once",
    }).success).toBe(true)
    expect(agentPermissionRespondInputSchema.safeParse({
      ...target,
      expectedTurnId: "turn-1",
      requestId: "request-1",
      idempotencyKey: "8cc55d4d-a4df-4dd8-b5fd-6f1da3385c0f",
      kind: "user_question",
      decision: "allow_once",
    }).success).toBe(false)
  })

  it("publishes strict top-level object schemas for all eleven tools", () => {
    const tools = buildAgentConversationMcpTools()
    expect(tools).toHaveLength(11)
    for (const tool of tools) {
      expect(tool.inputSchema.type).toBe("object")
      expect(tool.inputSchema.additionalProperties).toBe(false)
      expect(tool.inputSchema).not.toHaveProperty("oneOf")
      expect(tool.inputSchema).not.toHaveProperty("anyOf")
      expect(tool.inputSchema).not.toHaveProperty("allOf")
    }
  })
})
