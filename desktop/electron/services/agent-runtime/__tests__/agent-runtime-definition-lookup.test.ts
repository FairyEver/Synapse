import { describe, expect, it, vi } from "vitest"

vi.mock("electron", () => ({
  app: {
    getPath: (which: string) => `/tmp/synapse-agent-runtime-definition-lookup-test-${which}`,
    getName: () => "synapse-test",
    getVersion: () => "0.0.0-test",
    isPackaged: false,
  },
}))

import { createAdapterFromRuntimeDefinition } from "../index"

describe("Agent runtime definition lookup", () => {
  it("creates the requested adapter from runtime view", () => {
    const runner = {
      run: vi.fn(),
      start: vi.fn(),
    }

    expect(createAdapterFromRuntimeDefinition({
      projectId: "project-1",
      agentType: "claude-code",
      providers: [],
      env: {},
      envAllowlist: [],
    }, runner).agentType).toBe("claude-code")
  })

  it("throws a readable error for unknown agent runtimes", () => {
    const runner = {
      run: vi.fn(),
      start: vi.fn(),
    }

    expect(() => createAdapterFromRuntimeDefinition({
      projectId: "project-1",
      agentType: "missing-agent",
      providers: [],
      env: {},
      envAllowlist: [],
    }, runner)).toThrow("Unknown agent runtime: missing-agent")
  })
})
