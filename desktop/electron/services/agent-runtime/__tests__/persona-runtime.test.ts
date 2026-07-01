import { describe, expect, it } from "vitest"

import type { AgentPersona } from "../../../../app-capabilities/agent-personas/shared/schema"
import {
  createAgentPersonaRuntimeResolver,
  sdkAgentNameForPersona,
} from "../persona-runtime"

const translator: AgentPersona = {
  id: "builtin-zh-en-translator",
  schemaVersion: 1,
  name: "中英翻译",
  description: "在中文和英文之间互译。",
  systemPrompt: "你是中英翻译智能体。",
  providerModel: null,
  toolPolicy: { mode: "none", allowedTools: [] },
  source: "builtin",
  readonly: true,
}

describe("agent persona runtime resolver", () => {
  it("builds stable SDK agent names", () => {
    expect(sdkAgentNameForPersona("builtin-zh-en-translator"))
      .toBe("synapse-persona__builtin-zh-en-translator")
  })

  it("maps personas to Claude SDK agents with active prompt and no tools for the translator", async () => {
    const resolver = createAgentPersonaRuntimeResolver({
      listPersonas: async () => [translator],
    })

    const resolved = await resolver.resolve({
      agentConfig: { activeMainThreadPersonaId: translator.id },
    })

    expect(resolved.activeAgentName).toBe("synapse-persona__builtin-zh-en-translator")
    expect(resolved.agents["synapse-persona__builtin-zh-en-translator"]).toEqual({
      description: "在中文和英文之间互译。",
      prompt: "你是中英翻译智能体。",
      tools: [],
      disallowedTools: ["*"],
    })
    expect(resolved.systemPrompt).toEqual({
      type: "preset",
      preset: "claude_code",
      append: "你是中英翻译智能体。",
    })
    expect(resolved.toolPolicy).toEqual({ mode: "none", allowedTools: [] })
    expect(resolved.agents["synapse-persona__builtin-zh-en-translator"]).not.toHaveProperty("initialPrompt")
    expect(resolved.snapshot).toMatchObject({
      id: translator.id,
      name: "中英翻译",
      source: "builtin",
    })
    expect(resolved.providerModel).toBeNull()
    expect(resolved.definitionsHash).toHaveLength(64)
  })

  it("defaults legacy user personas to inherited tools", async () => {
    const userPersona: AgentPersona = {
      ...translator,
      id: "user-1",
      source: "user",
      readonly: false,
      toolPolicy: undefined,
    }
    const resolver = createAgentPersonaRuntimeResolver({
      listPersonas: async () => [userPersona],
    })

    const resolved = await resolver.resolve({
      agentConfig: { activeMainThreadPersonaId: userPersona.id },
    })

    expect(resolved.toolPolicy).toEqual({ mode: "inherit", allowedTools: [] })
    expect(resolved.agents["synapse-persona__user-1"]).toEqual({
      description: "在中文和英文之间互译。",
      prompt: "你是中英翻译智能体。",
      disallowedTools: ["Agent"],
    })
  })

  it("preserves allowlisted tool names for user personas", async () => {
    const userPersona: AgentPersona = {
      ...translator,
      id: "user-allowlist",
      source: "user",
      readonly: false,
      toolPolicy: { mode: "allowlist", allowedTools: ["Read", "mcp__synapse-mcp__database_query"] },
    }
    const resolver = createAgentPersonaRuntimeResolver({
      listPersonas: async () => [userPersona],
    })

    const resolved = await resolver.resolve({
      agentConfig: { activeMainThreadPersonaId: userPersona.id },
    })

    expect(resolved.toolPolicy).toEqual({
      mode: "allowlist",
      allowedTools: ["Read", "mcp__synapse-mcp__database_query"],
    })
    expect(resolved.agents["synapse-persona__user-allowlist"]).toMatchObject({
      tools: ["Read", "mcp__synapse-mcp__database_query"],
      disallowedTools: ["Agent"],
    })
  })

  it("returns the active persona provider model for runtime selection", async () => {
    const deepseekPersona: AgentPersona = {
      ...translator,
      id: "deepseek-persona",
      providerModel: { providerId: "deepseek", modelTier: "default" },
    }
    const resolver = createAgentPersonaRuntimeResolver({
      listPersonas: async () => [deepseekPersona],
    })

    const resolved = await resolver.resolve({
      agentConfig: { activeMainThreadPersonaId: deepseekPersona.id },
    })

    expect(resolved.providerModel).toEqual({ providerId: "deepseek", modelTier: "default" })
  })

  it("returns ordinary mode when no active persona is set", async () => {
    const resolver = createAgentPersonaRuntimeResolver({
      listPersonas: async () => [translator],
    })

    const resolved = await resolver.resolve({ agentConfig: {} })

    expect(resolved.activeAgentName).toBeUndefined()
    expect(resolved.snapshot).toBeUndefined()
    expect(resolved.providerModel).toBeNull()
    expect(resolved.agents).toHaveProperty("synapse-persona__builtin-zh-en-translator")
  })

  it("throws when the active persona no longer exists", async () => {
    const resolver = createAgentPersonaRuntimeResolver({
      listPersonas: async () => [],
    })

    await expect(resolver.resolve({
      agentConfig: { activeMainThreadPersonaId: translator.id },
    })).rejects.toThrow("智能体不可用")
  })
})
