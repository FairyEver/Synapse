import { describe, expect, it } from "vitest"

import { buildClaudeCodePrintRequest, sanitizeClaudeCodeArgsForDebug } from "../command"
import { defaultClaudeCodeNodeConfig, type ClaudeCodeNodeConfig } from "../schema"

function request(config: Partial<ClaudeCodeNodeConfig> = {}) {
  const abortSignal = new AbortController().signal
  return buildClaudeCodePrintRequest({
    config: { ...defaultClaudeCodeNodeConfig, prompt: "Run", ...config },
    prompt: "Write a summary",
    cwd: "/Users/liyang/project",
    abortSignal,
    timeoutMs: 60_000,
    actor: { kind: "system", id: "workflow-engine" },
    metadata: { source: "workflow", actionType: "workflow.claude_code" },
  })
}

describe("buildClaudeCodePrintRequest", () => {
  it("builds default claude print request from merged PATH", () => {
    const built = request()

    expect(built).toMatchObject({
      actor: { kind: "system", id: "workflow-engine" },
      action: "shell.exec",
      command: "claude",
      cwd: "/Users/liyang/project",
      timeoutMs: 60_000,
      pathStrategy: "merge",
      output: { stdout: "ignore", stderr: "ignore" },
      metadata: { source: "workflow", actionType: "workflow.claude_code" },
    })
    expect(built.args).toEqual([
      "-p",
      "--output-format",
      "stream-json",
      "--verbose",
      "--permission-mode",
      "acceptEdits",
      "--setting-sources",
      "user,project,local",
      "--",
      "Write a summary",
    ])
  })

  it("maps optional Claude Code flags", () => {
    const built = request({
      model: "sonnet",
      maxTurns: 3,
      outputFormat: "json",
      verbose: false,
      safeMode: true,
      bareMode: true,
      noSessionPersistence: true,
      settingSources: ["user"],
      settingsPath: "/Users/liyang/project/.claude/settings.json",
      mcpConfigPath: "/Users/liyang/project/mcp.json",
      strictMcpConfig: true,
      additionalDirectories: ["/Users/liyang/lib"],
      allowedTools: ["Read", "Edit"],
      disallowedTools: ["Bash(rm *)"],
    })

    expect(built.args).toEqual([
      "-p",
      "--output-format",
      "json",
      "--permission-mode",
      "acceptEdits",
      "--setting-sources",
      "user",
      "--model",
      "sonnet",
      "--max-turns",
      "3",
      "--safe-mode",
      "--bare",
      "--no-session-persistence",
      "--settings",
      "/Users/liyang/project/.claude/settings.json",
      "--mcp-config",
      "/Users/liyang/project/mcp.json",
      "--strict-mcp-config",
      "--add-dir",
      "/Users/liyang/lib",
      "--allowedTools",
      "Read",
      "--allowedTools",
      "Edit",
      "--disallowedTools",
      "Bash(rm *)",
      "--",
      "Write a summary",
    ])
  })

  it("separates the prompt from variadic Claude Code flags", () => {
    const built = request({
      mcpConfigPath: "/Users/liyang/project/mcp.json",
      additionalDirectories: ["/Users/liyang/lib"],
      allowedTools: ["mcp__chrome-devtools__navigate_page"],
      disallowedTools: ["Bash(*)"],
    })
    const args = built.args ?? []
    const separatorIndex = args.indexOf("--")

    expect(separatorIndex).toBeGreaterThan(args.lastIndexOf("/Users/liyang/lib"))
    expect(separatorIndex).toBeGreaterThan(args.lastIndexOf("/Users/liyang/project/mcp.json"))
    expect(separatorIndex).toBeGreaterThan(args.lastIndexOf("mcp__chrome-devtools__navigate_page"))
    expect(separatorIndex).toBeGreaterThan(args.lastIndexOf("Bash(*)"))
    expect(args.slice(separatorIndex)).toEqual(["--", "Write a summary"])
  })

  it("redacts prompt and secret-looking argv values for debug", () => {
    const built = request({
      settingsPath: "/Users/liyang/project/settings.json?token=sk-secret",
      allowedTools: ["Authorization=Bearer secret"],
    })

    expect(sanitizeClaudeCodeArgsForDebug(built.args ?? [], "Write a summary")).toEqual([
      "-p",
      "--output-format",
      "stream-json",
      "--verbose",
      "--permission-mode",
      "acceptEdits",
      "--setting-sources",
      "user,project,local",
      "--",
      "[prompt]",
    ])
  })
})
