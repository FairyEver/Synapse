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
  it("exports only the Claude Code runtime definition", () => {
    expect(agentRuntimeDefinitions.map((definition) => definition.id)).toEqual([
      "claude-code",
    ])
    expect(agentRuntimeDefinitionById.get("claude-code")?.runtime.binaries).toEqual(["claude"])
  })

  it("creates an adapter with the expected agent type", () => {
    const runner = {
      run: vi.fn(),
      start: vi.fn(),
    }
    const claude = agentRuntimeDefinitionById.get("claude-code")?.createAdapter({
      projectId: "project-1",
      agentType: "claude-code",
      providers: [],
      env: {},
      envAllowlist: [],
    }, runner)

    expect(claude?.agentType).toBe("claude-code")
  })
})
