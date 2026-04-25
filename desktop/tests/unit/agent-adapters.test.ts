import { describe, expect, it } from "vitest"
import {
  buildAgentLaunchSpec,
  detectAgentAdapters,
  splitCommandLine,
} from "../../electron/services/agent-adapter-service"

describe("agent adapter launch specs", () => {
  it("maps Claude Code wrapper options without storing the continue sentinel", () => {
    const spec = buildAgentLaunchSpec({
      adapter: "claudecode",
      cliPath: "bunx claude-code",
      cliArgsFlag: "-a",
      workDir: "/workspace/app",
      model: "claude-sonnet",
      mode: "accept-edits",
      reasoningEffort: "med",
      sessionId: "__continue__",
      allowedTools: ["Read", "Edit"],
      disallowedTools: ["Bash"],
      maxContextTokens: 12000,
    })

    expect(spec.command).toBe("bunx")
    expect(spec.cwd).toBe("/workspace/app")
    expect(spec.resumeSessionId).toBeNull()
    expect(spec.args[0]).toBe("claude-code")
    expect(spec.args[1]).toBe("-a")
    expect(spec.args[2]).toContain("--permission-mode acceptEdits")
    expect(spec.args[2]).not.toContain("--resume")
    expect(spec.args[2]).toContain("--allowedTools Read,Edit")
    expect(spec.args[2]).toContain("--disallowedTools Bash")
    expect(spec.args[2]).toContain("--effort medium")
    expect(spec.args[2]).toContain("--max-context-tokens 12000")
    expect(spec.args.slice(-2)).toEqual(["--model", "claude-sonnet"])
  })

  it("builds Codex fresh and resume argv with provider routing", () => {
    const fresh = buildAgentLaunchSpec({
      adapter: "codex",
      workDir: "/workspace/app",
      mode: "auto",
      reasoningEffort: "very-high",
      provider: {
        id: "global:codex-relay",
        schemaVersion: 1,
        kind: "llm",
        name: "codex-relay",
        scope: "global",
        baseUrl: "https://codex.example.com/v1",
        model: "openai/gpt-5.3-codex",
      },
    })

    expect(fresh.args).toEqual([
      "exec",
      "--skip-git-repo-check",
      "--full-auto",
      "--model",
      "openai/gpt-5.3-codex",
      "-c",
      "model_provider=\"codex-relay\"",
      "-c",
      "openai_base_url=\"https://codex.example.com/v1\"",
      "-c",
      "model_reasoning_effort=\"xhigh\"",
      "--json",
      "--cd",
      "/workspace/app",
      "-",
    ])

    const resume = buildAgentLaunchSpec({
      adapter: "codex",
      workDir: "/workspace/app",
      sessionId: "thread-123",
    })

    expect(resume.resumeSessionId).toBe("thread-123")
    expect(resume.args).toEqual(["exec", "resume", "--skip-git-repo-check", "thread-123", "--json", "-"])
    expect(resume.args).not.toContain("--cd")
  })

  it("builds Cursor, OpenCode, Pi, Gemini, and Kimi specs without launching CLIs", () => {
    expect(buildAgentLaunchSpec({
      adapter: "cursor",
      workDir: "/w",
      mode: "ask",
      sessionId: "cursor-1",
      prompt: "hi",
    }).args).toEqual([
      "--print",
      "--output-format",
      "stream-json",
      "--trust",
      "--mode",
      "ask",
      "--resume",
      "cursor-1",
      "--workspace",
      "/w",
      "--",
      "hi",
    ])

    expect(buildAgentLaunchSpec({
      adapter: "opencode",
      workDir: "/w",
      model: "gpt-4o",
      sessionId: "open-1",
      prompt: "hi",
    }).args).toEqual(["run", "--format", "json", "--session", "open-1", "--model", "gpt-4o", "--dir", "/w", "--thinking", "hi"])

    expect(buildAgentLaunchSpec({
      adapter: "pi",
      workDir: "/w",
      mode: "bypass",
      reasoningEffort: "xhigh",
      prompt: "hi",
    }).args).toEqual(["--mode", "json", "-p", "--auto-approve", "--thinking", "xhigh", "hi"])

    expect(buildAgentLaunchSpec({
      adapter: "gemini",
      mode: "acceptedits",
      model: "gemini-2.5-pro",
      prompt: "hi",
    }).args).toEqual(["--output-format", "stream-json", "--approval-mode", "auto_edit", "-m", "gemini-2.5-pro", "-p", "hi"])

    expect(buildAgentLaunchSpec({
      adapter: "kimi",
      workDir: "/w",
      mode: "quiet",
      sessionId: "kimi-1",
      prompt: "hi",
    }).args).toEqual(["--print", "--output-format", "stream-json", "--quiet", "--resume", "kimi-1", "--work-dir", "/w", "--prompt", "hi"])
  })

  it("detects CLI availability through an injected resolver", () => {
    const availability = detectAgentAdapters((command) => command === "codex" ? "/usr/local/bin/codex" : null)

    expect(availability.find((item) => item.adapter === "codex")).toMatchObject({
      command: "codex",
      available: true,
      resolvedPath: "/usr/local/bin/codex",
    })
    expect(availability.find((item) => item.adapter === "claudecode")).toMatchObject({
      command: "claude",
      available: false,
      reason: "claude CLI not found in PATH",
    })
  })

  it("splits wrapper command lines with quoted path segments", () => {
    expect(splitCommandLine("'custom cli' --flag value")).toEqual(["custom cli", "--flag", "value"])
  })
})
