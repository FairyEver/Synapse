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
  source: "builtin",
  readonly: true,
}

describe("agent persona runtime resolver", () => {
  it("builds stable SDK agent names", () => {
    expect(sdkAgentNameForPersona("builtin-zh-en-translator"))
      .toBe("synapse-persona__builtin-zh-en-translator")
  })

  it("maps personas to Claude SDK agents with Agent tool disabled", async () => {
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
      disallowedTools: ["Agent"],
    })
    expect(resolved.snapshot).toMatchObject({
      id: translator.id,
      name: "中英翻译",
      source: "builtin",
    })
    expect(resolved.definitionsHash).toHaveLength(64)
  })

  it("returns ordinary mode when no active persona is set", async () => {
    const resolver = createAgentPersonaRuntimeResolver({
      listPersonas: async () => [translator],
    })

    const resolved = await resolver.resolve({ agentConfig: {} })

    expect(resolved.activeAgentName).toBeUndefined()
    expect(resolved.snapshot).toBeUndefined()
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
