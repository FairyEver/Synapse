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

  it("exports the Claude Code runtime metadata", () => {
    expect(agentRuntimeDefinitionById.get("claude-code")?.runtimeKind).toBe(
      "claude-agent-sdk",
    )
  })
})
