import { describe, expect, it, vi } from "vitest"

vi.mock("electron", () => ({
  app: {
    getPath: (which: string) => `/tmp/synapse-agent-runtime-registry-test-${which}`,
  },
}))

import {
  agentRuntimeDefinitionById,
  agentRuntimeDefinitions,
} from "../generated/main-registry"

describe("agent runtime main registry", () => {
  it("exports Codex and Claude Code runtime definitions", () => {
    expect(agentRuntimeDefinitions.map((definition) => definition.id)).toEqual([
      "claude-code",
      "codex",
    ])
    expect(agentRuntimeDefinitionById.get("codex")?.runtime.binaries).toEqual(["codex"])
    expect(agentRuntimeDefinitionById.get("claude-code")?.runtime.binaries).toEqual(["claude"])
  })

  it("creates adapters with the expected agent types", () => {
    const runner = {
      run: vi.fn(),
      start: vi.fn(),
    }
    const codex = agentRuntimeDefinitionById.get("codex")?.createAdapter({
      projectId: "project-1",
      agentType: "codex",
      providers: [],
      env: {},
      envAllowlist: [],
    }, runner)
    const claude = agentRuntimeDefinitionById.get("claude-code")?.createAdapter({
      projectId: "project-1",
      agentType: "claude-code",
      providers: [],
      env: {},
      envAllowlist: [],
    }, runner)

    expect(codex?.agentType).toBe("codex")
    expect(claude?.agentType).toBe("claude-code")
  })
})
