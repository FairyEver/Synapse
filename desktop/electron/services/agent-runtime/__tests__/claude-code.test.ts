import { describe, expect, it } from "vitest"

import type {
  ControlledProcessResult,
  ControlledProcessRunRequest,
  ControlledProcessSession,
} from "../../../runtime/process"
import {
  ClaudeCodeAdapter,
  buildClaudeCodeArgs,
  type ClaudeProcessRunner,
} from "../adapters/claude-code"

describe("Claude Code adapter", () => {
  it("builds stream-json args with resume and permission prompt stdio", () => {
    expect(buildClaudeCodeArgs({
      sessionId: "claude-session-1",
      model: "sonnet",
      effort: "high",
      mode: "acceptEdits",
    })).toEqual([
      "--print",
      "--verbose",
      "--input-format",
      "stream-json",
      "--output-format",
      "stream-json",
      "--permission-prompt-tool",
      "stdio",
      "--permission-mode",
      "acceptEdits",
      "--resume",
      "claude-session-1",
      "--effort",
      "high",
      "--model",
      "sonnet",
    ])
  })

  it("parses stream-json assistant, control_request, control_response, and close", async () => {
    const runner = new FakeClaudeRunner()
    const adapter = new ClaudeCodeAdapter(runner, { command: "claude-test" })
    const session = await adapter.startSession({
      projectId: "project-1",
      workDir: "/repo",
      agentSessionId: "claude-session-1",
      sessionEnv: {
        CC_PROJECT: "project-1",
        CC_SESSION_KEY: "bridge:s1",
      },
      actor: { kind: "user" },
    })

    expect(runner.requests[0]).toEqual(
      expect.objectContaining({
        command: "claude-test",
        action: "agent.spawn",
        cwd: "/repo",
        env: expect.objectContaining({
          CC_PROJECT: "project-1",
          CC_SESSION_KEY: "bridge:s1",
        }),
        envAllowlist: expect.arrayContaining(["CC_PROJECT", "CC_SESSION_KEY"]),
      }),
    )

    await session.send({
      projectId: "project-1",
      sessionKey: "s1",
      platform: "local",
      content: "hello",
    })

    expect(runner.session.writes.map((line) => JSON.parse(line))).toEqual([
      {
        type: "user",
        message: { role: "user", content: "hello" },
      },
    ])

    runner.emit({
      type: "assistant",
      message: {
        content: [
          { type: "thinking", thinking: "thinking" },
          { type: "tool_use", name: "Bash", input: { command: "pwd" } },
          { type: "text", text: "done" },
        ],
      },
    })
    runner.emit({
      type: "control_request",
      request_id: "perm-1",
      request: {
        subtype: "can_use_tool",
        tool_name: "Bash",
        input: { command: "pwd" },
      },
    })

    expect(await session.nextEvent()).toEqual(
      expect.objectContaining({ type: "thinking", content: "thinking" }),
    )
    expect(await session.nextEvent()).toEqual(
      expect.objectContaining({ type: "toolUse", toolName: "Bash", toolInput: "pwd" }),
    )
    expect(await session.nextEvent()).toEqual(
      expect.objectContaining({ type: "text", content: "done" }),
    )
    expect(await session.nextEvent()).toEqual(
      expect.objectContaining({
        type: "permissionRequest",
        requestId: "perm-1",
        toolName: "Bash",
        toolInputRaw: { command: "pwd" },
      }),
    )

    await session.respondPermission("perm-1", {
      behavior: "allow",
      updatedInput: { command: "pwd" },
    })

    expect(JSON.parse(runner.session.writes.at(-1) ?? "{}")).toEqual({
      type: "control_response",
      response: {
        subtype: "success",
        request_id: "perm-1",
        response: {
          behavior: "allow",
          updatedInput: { command: "pwd" },
        },
      },
    })

    runner.emit({ type: "result", session_id: "claude-session-2", result: "final" })
    expect(await session.nextEvent()).toEqual(
      expect.objectContaining({
        type: "result",
        content: "final",
        agentSessionId: "claude-session-2",
      }),
    )
    expect(session.currentSessionId()).toBe("claude-session-2")

    await session.close()
    expect(runner.session.closed).toBe(true)
  })
})

class FakeClaudeRunner implements ClaudeProcessRunner {
  readonly requests: ControlledProcessRunRequest[] = []
  readonly session = new FakeProcessSession()

  async start(request: ControlledProcessRunRequest): Promise<ControlledProcessSession> {
    this.requests.push(request)
    this.session.onLine = request.onStdoutLine
    return this.session
  }

  emit(value: Record<string, unknown>): void {
    this.session.onLine?.(JSON.stringify(value))
  }
}

class FakeProcessSession implements ControlledProcessSession {
  readonly writes: string[] = []
  onLine?: (line: string) => void
  closed = false
  private waitResolve: ((result: ControlledProcessResult) => void) | undefined
  private readonly waitPromise = new Promise<ControlledProcessResult>((resolve) => {
    this.waitResolve = resolve
  })

  async writeStdin(input: string | Uint8Array): Promise<void> {
    this.writes.push(typeof input === "string" ? input.trimEnd() : Buffer.from(input).toString("utf8").trimEnd())
  }

  async endStdin(input?: string | Uint8Array): Promise<void> {
    if (input !== undefined) await this.writeStdin(input)
    this.closed = true
  }

  wait(): Promise<ControlledProcessResult> {
    return this.waitPromise
  }

  async close(): Promise<ControlledProcessResult> {
    this.closed = true
    const result: ControlledProcessResult = {
      exitCode: 0,
      signal: null,
      stdout: "",
      stderr: "",
      timedOut: false,
      durationMs: 1,
    }
    this.waitResolve?.(result)
    return result
  }

  alive(): boolean {
    return !this.closed
  }
}
