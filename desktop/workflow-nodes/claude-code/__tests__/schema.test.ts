import { describe, expect, it } from "vitest"
import { claudeCodeNodeConfigSchema, defaultClaudeCodeNodeConfig } from "../schema"

describe("claudeCodeNodeConfigSchema", () => {
  it("keeps unattended local CLI defaults", () => {
    expect(defaultClaudeCodeNodeConfig).toEqual({
      variables: [],
      prompt: "",
      permissionMode: "acceptEdits",
      outputFormat: "stream-json",
      verbose: true,
      safeMode: false,
      bareMode: false,
      noSessionPersistence: false,
      settingSources: ["user", "project", "local"],
      strictMcpConfig: false,
      additionalDirectories: [],
      allowedTools: [],
      disallowedTools: [],
      captureDebugArtifacts: true,
    })
  })

  it("trims optional strings and list values", () => {
    const parsed = claudeCodeNodeConfigSchema.parse({
      ...defaultClaudeCodeNodeConfig,
      prompt: "  Run tests  ",
      projectId: "  repo-1  ",
      model: "  sonnet  ",
      workingDirectory: "  packages/app  ",
      settingsPath: "  .claude/settings.json  ",
      mcpConfigPath: "  mcp.json  ",
      additionalDirectories: ["  ../lib  "],
      allowedTools: ["  Read  "],
      disallowedTools: ["  Bash(rm *)  "],
    })

    expect(parsed.prompt).toBe("Run tests")
    expect(parsed.projectId).toBe("repo-1")
    expect(parsed.model).toBe("sonnet")
    expect(parsed.workingDirectory).toBe("packages/app")
    expect(parsed.settingsPath).toBe(".claude/settings.json")
    expect(parsed.mcpConfigPath).toBe("mcp.json")
    expect(parsed.additionalDirectories).toEqual(["../lib"])
    expect(parsed.allowedTools).toEqual(["Read"])
    expect(parsed.disallowedTools).toEqual(["Bash(rm *)"])
  })

  it("rejects empty prompt, invalid numbers, and duplicate setting sources", () => {
    expect(claudeCodeNodeConfigSchema.safeParse({
      ...defaultClaudeCodeNodeConfig,
      prompt: " ",
    }).success).toBe(false)

    expect(claudeCodeNodeConfigSchema.safeParse({
      ...defaultClaudeCodeNodeConfig,
      prompt: "Run",
      timeoutMins: 0,
    }).success).toBe(false)

    expect(claudeCodeNodeConfigSchema.safeParse({
      ...defaultClaudeCodeNodeConfig,
      prompt: "Run",
      maxTurns: 0,
    }).success).toBe(false)

    expect(claudeCodeNodeConfigSchema.safeParse({
      ...defaultClaudeCodeNodeConfig,
      prompt: "Run",
      settingSources: ["user", "user"],
    }).success).toBe(false)
  })
})
