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
import type {
  ControlledProcessResult,
  ControlledProcessRunRequest,
} from "../../../runtime/process"

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

  it("passes the resolved CLI path into Codex adapters", async () => {
    const requests: ControlledProcessRunRequest[] = []
    const runner = {
      run: vi.fn(async (request: ControlledProcessRunRequest): Promise<ControlledProcessResult> => {
        requests.push(request)
        return {
          exitCode: 0,
          signal: null,
          stdout: "",
          stderr: "",
          timedOut: false,
          durationMs: 1,
        }
      }),
      start: vi.fn(),
    }

    const adapter = createAdapterFromRuntimeDefinition({
      projectId: "project-1",
      agentType: "codex",
      runtimeCommand: "/opt/homebrew/bin/codex",
      providers: [],
      env: {},
      envAllowlist: [],
    }, runner)

    await adapter.execute({
      projectId: "project-1",
      sessionKey: "s1",
      platform: "local",
      content: "hello",
    }, {
      projectId: "project-1",
      workDir: "/repo",
      actor: { kind: "user" },
    })

    expect(requests[0]?.command).toBe("/opt/homebrew/bin/codex")
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
