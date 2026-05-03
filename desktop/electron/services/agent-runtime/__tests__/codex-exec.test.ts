import path from "node:path"
import { mkdir, mkdtemp, writeFile } from "node:fs/promises"
import { tmpdir } from "node:os"

import { describe, expect, it } from "vitest"

import {
  CodexJsonLineParser,
  CodexExecAdapter,
  buildCodexExecArgs,
} from "../adapters/codex-exec"
import type { ControlledProcessResult, ControlledProcessRunRequest } from "../../../runtime/process"
import type { ControlledProcessSession } from "../../../runtime/process"
import type { CodexProcessRunner } from "../adapters/codex-exec"

describe("Codex exec adapter", () => {
  it("builds new-session exec args with prompt over stdin", () => {
    expect(buildCodexExecArgs({ workDir: "/repo" })).toEqual([
      "exec",
      "--skip-git-repo-check",
      "--json",
      "--cd",
      "/repo",
      "-",
    ])
  })

  it("builds resume exec args with thread id and prompt over stdin", () => {
    expect(buildCodexExecArgs({ workDir: "/repo", threadId: "thread-1" })).toEqual([
      "exec",
      "resume",
      "--skip-git-repo-check",
      "thread-1",
      "--json",
      "-",
    ])
  })

  it("builds provider/model/reasoning options when supplied", () => {
    expect(buildCodexExecArgs({
      workDir: "/repo",
      threadId: "thread-1",
      model: "gpt-5.4",
      provider: "openai",
      baseUrl: "https://api.example.test/v1",
      effort: "high",
    })).toEqual([
      "exec",
      "resume",
      "--skip-git-repo-check",
      "--model",
      "gpt-5.4",
      "-c",
      "model_provider=\"openai\"",
      "-c",
      "openai_base_url=\"https://api.example.test/v1\"",
      "-c",
      "model_reasoning_effort=\"high\"",
      "thread-1",
      "--json",
      "-",
    ])
  })

  it("injects per-session env through the controlled process allowlist", async () => {
    const runner = new EnvCaptureRunner()
    const adapter = new CodexExecAdapter(runner, {
      env: { EXISTING: "1" },
      envAllowlist: ["EXISTING"],
    })

    await adapter.execute({
      projectId: "project-1",
      sessionKey: "bridge:s1",
      platform: "bridge",
      content: "hello",
    }, {
      projectId: "project-1",
      workDir: "/repo",
      sessionEnv: {
        CC_PROJECT: "project-1",
        CC_SESSION_KEY: "bridge:s1",
        SYNAPSE_SIDE_CHANNEL_TOKEN: "tok",
      },
      actor: { kind: "user" },
    })

    expect(runner.requests[0]).toEqual(expect.objectContaining({
      env: expect.objectContaining({
        EXISTING: "1",
        CC_PROJECT: "project-1",
        CC_SESSION_KEY: "bridge:s1",
        SYNAPSE_SIDE_CHANNEL_TOKEN: "tok",
      }),
      envAllowlist: expect.arrayContaining([
        "EXISTING",
        "CC_PROJECT",
        "CC_SESSION_KEY",
        "SYNAPSE_SIDE_CHANNEL_TOKEN",
      ]),
    }))
  })

  it("streams parsed events through the execution context callback", async () => {
    const runner = new StreamingRunner([
      JSON.stringify({ type: "thread.started", thread_id: "thread-1" }),
      JSON.stringify({
        type: "item.completed",
        item: {
          type: "agent_message",
          content: [{ type: "output_text", text: "hello" }],
        },
      }),
      JSON.stringify({ type: "turn.completed" }),
    ])
    const adapter = new CodexExecAdapter(runner)
    const seen: string[] = []

    const result = await adapter.execute({
      projectId: "project-1",
      sessionKey: "s1",
      platform: "local",
      content: "hello",
    }, {
      projectId: "project-1",
      workDir: "/repo",
      actor: { kind: "user" },
      onEvent: (event) => seen.push(event.type),
    })

    expect(seen).toEqual(["text", "result"])
    expect(result.resultText).toBe("hello")
    expect(result.threadId).toBe("thread-1")
  })

  it("bridges codex app-server approval requests through a live session", async () => {
    const runner = new FakeCodexAppServerRunner()
    const adapter = new CodexExecAdapter(runner, {
      command: "codex-test",
      model: "gpt-5.5",
      effort: "high",
      backend: "app-server",
    })

    const session = await adapter.startSession?.({
      projectId: "project-1",
      workDir: "/repo",
      sessionEnv: {
        CC_PROJECT: "project-1",
        CC_SESSION_KEY: "bridge:s1",
      },
      actor: { kind: "user" },
    })

    expect(session).toBeDefined()
    expect(runner.requests[0]).toEqual(expect.objectContaining({
      command: "codex-test",
      args: ["app-server", "--listen", "stdio://", "-c", "model_reasoning_effort=\"high\""],
      cwd: "/repo",
      env: expect.objectContaining({
        CC_PROJECT: "project-1",
        CC_SESSION_KEY: "bridge:s1",
      }),
      envAllowlist: expect.arrayContaining(["CC_PROJECT", "CC_SESSION_KEY"]),
    }))
    expect(runner.session.writes.map((line) => JSON.parse(line))).toEqual([
      expect.objectContaining({ jsonrpc: "2.0", method: "initialize" }),
      { jsonrpc: "2.0", method: "initialized", params: null },
      expect.objectContaining({
        jsonrpc: "2.0",
        method: "thread/start",
        params: expect.objectContaining({
          approvalPolicy: "on-request",
          sandbox: "read-only",
          model: "gpt-5.5",
        }),
      }),
    ])

    await session?.send({
      projectId: "project-1",
      sessionKey: "bridge:s1",
      platform: "bridge",
      content: "hello",
    })

    expect(JSON.parse(runner.session.writes.at(-1) ?? "{}")).toEqual(
      expect.objectContaining({
        jsonrpc: "2.0",
        method: "turn/start",
        params: expect.objectContaining({
          threadId: "thread-1",
          input: [{ type: "text", text: "hello", text_elements: [] }],
          effort: "high",
          approvalPolicy: "on-request",
        }),
      }),
    )

    runner.emitServerRequest({
      id: "approval-1",
      method: "item/commandExecution/requestApproval",
      params: {
        threadId: "thread-1",
        turnId: "turn-1",
        itemId: "item-1",
        command: "pwd",
        cwd: "/repo",
      },
    })

    expect(await session?.nextEvent()).toEqual(
      expect.objectContaining({
        type: "permissionRequest",
        requestId: "approval-1",
        toolName: "Bash",
        toolInput: "pwd",
        toolInputRaw: expect.objectContaining({ command: "pwd" }),
      }),
    )

    await session?.respondPermission("approval-1", { behavior: "allow" })

    expect(JSON.parse(runner.session.writes.at(-1) ?? "{}")).toEqual({
      jsonrpc: "2.0",
      id: "approval-1",
      result: { decision: "accept" },
    })

    runner.emitServerRequest({
      id: "mcp-1",
      method: "mcpServer/elicitation/request",
      params: {
        threadId: "thread-1",
        turnId: "turn-1",
        serverName: "synapse-mcp",
        mode: "url",
        message: "Authorize MCP",
        url: "http://127.0.0.1:23578/mcp",
        elicitationId: "elicit-1",
        _meta: null,
      },
    })

    expect(await session?.nextEvent()).toEqual(
      expect.objectContaining({
        type: "permissionRequest",
        requestId: "mcp-1",
        toolName: "MCP Elicitation",
        toolInput: "Authorize MCP",
        toolInputRaw: expect.objectContaining({ serverName: "synapse-mcp" }),
      }),
    )

    await session?.respondPermission("mcp-1", { behavior: "deny" })

    expect(JSON.parse(runner.session.writes.at(-1) ?? "{}")).toEqual({
      jsonrpc: "2.0",
      id: "mcp-1",
      result: {
        action: "decline",
        content: null,
        _meta: null,
      },
    })

    runner.emitServerRequest({
      id: "legacy-exec-1",
      method: "execCommandApproval",
      params: { command: "pnpm test", cwd: "/repo" },
    })

    expect(await session?.nextEvent()).toEqual(
      expect.objectContaining({
        type: "permissionRequest",
        requestId: "legacy-exec-1",
        toolName: "Bash",
        toolInput: "pnpm test",
      }),
    )

    await session?.respondPermission("legacy-exec-1", { behavior: "deny" })

    expect(JSON.parse(runner.session.writes.at(-1) ?? "{}")).toEqual({
      jsonrpc: "2.0",
      id: "legacy-exec-1",
      result: { decision: "decline" },
    })

    runner.emitServerRequest({
      id: "question-1",
      method: "item/tool/requestUserInput",
      params: {
        questions: [{
          id: "q1",
          question: "Pick one",
          options: [{ label: "A" }],
        }],
      },
    })

    expect(await session?.nextEvent()).toEqual(
      expect.objectContaining({
        type: "permissionRequest",
        requestId: "question-1",
        toolName: "AskUserQuestion",
        questions: [{ question: "Pick one", options: [{ label: "A", description: undefined }] }],
      }),
    )

    await session?.respondPermission("question-1", {
      behavior: "allow",
      updatedInput: { answers: { q1: { answers: ["A"] } } },
    })

    expect(JSON.parse(runner.session.writes.at(-1) ?? "{}")).toEqual({
      jsonrpc: "2.0",
      id: "question-1",
      result: { answers: { q1: { answers: ["A"] } } },
    })

    runner.emitServerRequest({
      id: "refresh-1",
      method: "account/chatgptAuthTokens/refresh",
      params: {},
    })

    expect(JSON.parse(runner.session.writes.at(-1) ?? "{}")).toEqual({
      jsonrpc: "2.0",
      id: "refresh-1",
      error: {
        code: -32000,
        message: "ChatGPT auth token refresh is not available in this Synapse provider session.",
      },
    })

    runner.emitServerRequest({
      id: "tool-call-1",
      method: "item/tool/call",
      params: { namespace: "synapse", tool: "example", arguments: {} },
    })

    expect(JSON.parse(runner.session.writes.at(-1) ?? "{}")).toEqual({
      jsonrpc: "2.0",
      id: "tool-call-1",
      error: {
        code: -32601,
        message: "Unsupported codex app-server request: item/tool/call",
      },
    })
  })
})

describe("Codex JSONL parser", () => {
  it("saves thread.started thread id", () => {
    const parser = new CodexJsonLineParser()
    parser.pushLine(JSON.stringify({ type: "thread.started", thread_id: "thread-1" }))
    expect(parser.finalize().threadId).toBe("thread-1")
  })

  it("maps agent_message and message items to text on turn completion", () => {
    const parser = new CodexJsonLineParser()
    parser.pushLine(JSON.stringify({ type: "thread.started", thread_id: "thread-1" }))
    parser.pushLine(JSON.stringify({ type: "turn.started" }))
    parser.pushLine(JSON.stringify({
      type: "item.completed",
      item: {
        type: "agent_message",
        content: [{ type: "output_text", text: "hello" }],
      },
    }))
    parser.pushLine(JSON.stringify({
      type: "item.completed",
      item: {
        type: "message",
        text: " world",
      },
    }))
    parser.pushLine(JSON.stringify({ type: "turn.completed" }))

    const result = parser.finalize()
    expect(result.events.filter((event) => event.type === "text")).toEqual([
      expect.objectContaining({ content: "hello", threadId: "thread-1" }),
      expect.objectContaining({ content: " world", threadId: "thread-1" }),
    ])
    expect(result.events.at(-1)).toEqual(
      expect.objectContaining({ type: "result", content: "hello world" }),
    )
  })

  it("does not carry result text across turns when reused by a live session", () => {
    const parser = new CodexJsonLineParser()
    parser.pushLine(JSON.stringify({ type: "thread.started", thread_id: "thread-1" }))
    parser.pushLine(JSON.stringify({ type: "turn.started" }))
    parser.pushLine(JSON.stringify({
      type: "item.completed",
      item: {
        type: "agent_message",
        content: [{ type: "output_text", text: "first" }],
      },
    }))
    parser.pushLine(JSON.stringify({ type: "turn.completed" }))
    parser.pushLine(JSON.stringify({ type: "turn.started" }))
    parser.pushLine(JSON.stringify({
      type: "item.completed",
      item: {
        type: "agent_message",
        content: [{ type: "output_text", text: "second" }],
      },
    }))
    parser.pushLine(JSON.stringify({ type: "turn.completed" }))

    const results = parser.finalize().events.filter((event) => event.type === "result")
    expect(results).toEqual([
      expect.objectContaining({ content: "first" }),
      expect.objectContaining({ content: "second" }),
    ])
  })

  it("attaches Codex footer metadata and context remaining", async () => {
    const codexHome = await mkdtemp(path.join(tmpdir(), "synapse-codex-home-"))
    const sessionDir = path.join(codexHome, "sessions", "2026", "04", "26")
    await mkdir(sessionDir, { recursive: true })
    await writeFile(path.join(sessionDir, "rollout-thread-1.jsonl"), `${JSON.stringify({
      type: "event_msg",
      payload: {
        type: "token_count",
        info: {
          model_context_window: 112000,
          total_token_usage: { total_tokens: 62000 },
        },
      },
    })}\n`)

    const parser = new CodexJsonLineParser(undefined, undefined, {
      model: "gpt-5.5",
      effort: "xhigh",
      workDir: "/repo",
      codexHome,
    })
    parser.pushLine(JSON.stringify({ type: "thread.started", thread_id: "thread-1" }))
    parser.pushLine(JSON.stringify({
      type: "item.completed",
      item: {
        type: "agent_message",
        content: [{ type: "output_text", text: "hello" }],
      },
    }))
    parser.pushLine(JSON.stringify({ type: "turn.completed" }))

    expect(parser.finalize().events.at(-1)).toEqual(expect.objectContaining({
      type: "result",
      metadata: {
        model: "gpt-5.5",
        effort: "xhigh",
        contextRemainingPercent: 50,
        workDir: "/repo",
      },
    }))
  })

  it("maps reasoning items to thinking", () => {
    const parser = new CodexJsonLineParser("thread-1")
    parser.pushLine(JSON.stringify({
      type: "item.completed",
      item: {
        type: "reasoning",
        summary: [{ type: "summary_text", text: "thinking" }],
      },
    }))
    expect(parser.finalize().events).toEqual([
      expect.objectContaining({ type: "thinking", content: "thinking" }),
    ])
  })

  it("maps command_execution and function_call to tool events", () => {
    const parser = new CodexJsonLineParser("thread-1")
    parser.pushLine(JSON.stringify({
      type: "item.started",
      item: { type: "command_execution", command: "pnpm test" },
    }))
    parser.pushLine(JSON.stringify({
      type: "item.completed",
      item: {
        type: "command_execution",
        status: "completed",
        aggregated_output: "ok",
        exit_code: 0,
      },
    }))
    parser.pushLine(JSON.stringify({
      type: "item.started",
      item: { type: "function_call", name: "read_file", arguments: "{\"path\":\"a\"}" },
    }))
    parser.pushLine(JSON.stringify({
      type: "item.completed",
      item: { type: "function_call", name: "read_file", status: "completed", output: "file" },
    }))

    expect(parser.finalize().events).toEqual([
      expect.objectContaining({ type: "toolUse", toolName: "Bash", toolInput: "pnpm test" }),
      expect.objectContaining({ type: "toolResult", toolName: "Bash", content: "ok", exitCode: 0, success: true }),
      expect.objectContaining({ type: "toolUse", toolName: "read_file", toolInput: "{\"path\":\"a\"}" }),
      expect.objectContaining({ type: "toolResult", toolName: "read_file", content: "file", success: true }),
    ])
  })

  it("maps camelCase app-server tool items to progress events", () => {
    const parser = new CodexJsonLineParser("thread-1")
    parser.pushLine(JSON.stringify({
      type: "item.started",
      item: { type: "commandExecution", command: "pwd" },
    }))
    parser.pushLine(JSON.stringify({
      type: "item.completed",
      item: {
        type: "commandExecution",
        command: "pwd",
        status: "completed",
        aggregatedOutput: "/repo",
        exitCode: 0,
      },
    }))
    parser.pushLine(JSON.stringify({
      type: "item.started",
      item: {
        type: "mcpToolCall",
        server: "synapse_mcp",
        tool: "database_table_list",
        arguments: {},
      },
    }))
    parser.pushLine(JSON.stringify({
      type: "item.completed",
      item: {
        type: "mcpToolCall",
        server: "synapse_mcp",
        tool: "database_table_list",
        arguments: {},
        status: "completed",
        result: { content: [] },
      },
    }))
    parser.pushLine(JSON.stringify({
      type: "item.started",
      item: {
        type: "dynamicToolCall",
        namespace: "synapse",
        tool: "example",
        arguments: {},
      },
    }))
    parser.pushLine(JSON.stringify({
      type: "item.completed",
      item: {
        type: "dynamicToolCall",
        namespace: "synapse",
        tool: "example",
        arguments: {},
        status: "completed",
        contentItems: [{ type: "inputText", text: "ok" }],
        success: true,
      },
    }))
    parser.pushLine(JSON.stringify({
      type: "item.completed",
      item: { type: "fileChange", changes: [], status: "completed" },
    }))

    expect(parser.finalize().events).toEqual([
      expect.objectContaining({ type: "toolUse", toolName: "Bash", toolInput: "pwd" }),
      expect.objectContaining({
        type: "toolResult",
        toolName: "Bash",
        content: "/repo",
        exitCode: 0,
        success: true,
      }),
      expect.objectContaining({
        type: "toolUse",
        toolName: "synapse_mcp.database_table_list",
        toolInput: "{}",
      }),
      expect.objectContaining({
        type: "toolResult",
        toolName: "synapse_mcp.database_table_list",
        content: "{\"content\":[]}",
        success: true,
      }),
      expect.objectContaining({
        type: "toolUse",
        toolName: "synapse.example",
        toolInput: "{}",
      }),
      expect.objectContaining({
        type: "toolResult",
        toolName: "synapse.example",
        content: "ok",
        success: true,
      }),
      expect.objectContaining({
        type: "toolUse",
        toolName: "FileChange",
        toolInput: "[]",
      }),
    ])
  })

  it("maps turn.failed and error events to errors", () => {
    const failed = new CodexJsonLineParser()
    failed.pushLine(JSON.stringify({
      type: "turn.failed",
      error: { message: "bad turn" },
    }))
    expect(failed.finalize().events).toEqual([
      expect.objectContaining({ type: "error", message: "bad turn" }),
    ])

    const errored = new CodexJsonLineParser()
    errored.pushLine(JSON.stringify({ type: "error", message: "bad event" }))
    expect(errored.finalize().events).toEqual([
      expect.objectContaining({ type: "error", message: "bad event" }),
    ])
  })
})

class EnvCaptureRunner implements CodexProcessRunner {
  readonly requests: ControlledProcessRunRequest[] = []

  async run(request: ControlledProcessRunRequest): Promise<ControlledProcessResult> {
    this.requests.push(request)
    return {
      exitCode: 0,
      signal: null,
      stdout: JSON.stringify({ type: "turn.completed" }),
      stderr: "",
      timedOut: false,
      durationMs: 1,
    }
  }
}

class StreamingRunner implements CodexProcessRunner {
  private readonly lines: readonly string[]

  constructor(lines: readonly string[]) {
    this.lines = lines
  }

  async run(request: ControlledProcessRunRequest): Promise<ControlledProcessResult> {
    for (const line of this.lines) request.onStdoutLine?.(line)
    return {
      exitCode: 0,
      signal: null,
      stdout: "",
      stderr: "",
      timedOut: false,
      durationMs: 1,
    }
  }
}

class FakeCodexAppServerRunner implements CodexProcessRunner {
  readonly requests: ControlledProcessRunRequest[] = []
  readonly session = new FakeCodexAppServerSession()

  async run(): Promise<ControlledProcessResult> {
    throw new Error("run is not used by live session tests")
  }

  async start(request: ControlledProcessRunRequest): Promise<ControlledProcessSession> {
    this.requests.push(request)
    this.session.onLine = request.onStdoutLine
    return this.session
  }

  emitServerRequest(value: Record<string, unknown>): void {
    this.session.onLine?.(JSON.stringify(value))
  }
}

class FakeCodexAppServerSession implements ControlledProcessSession {
  readonly writes: string[] = []
  onLine?: (line: string) => void
  closed = false
  private waitResolve: ((result: ControlledProcessResult) => void) | undefined
  private readonly waitPromise = new Promise<ControlledProcessResult>((resolve) => {
    this.waitResolve = resolve
  })

  async writeStdin(input: string | Uint8Array): Promise<void> {
    const line = typeof input === "string" ? input.trimEnd() : Buffer.from(input).toString("utf8").trimEnd()
    this.writes.push(line)
    this.respondToClientRequest(line)
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
    const result = {
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

  private respondToClientRequest(line: string): void {
    const request = JSON.parse(line) as {
      readonly id?: number | string
      readonly method?: string
    }
    if (request.id === undefined) return
    switch (request.method) {
      case "initialize":
        this.onLine?.(JSON.stringify({ id: request.id, result: { protocolVersion: "0.1.0" } }))
        break
      case "thread/start":
        this.onLine?.(JSON.stringify({
          id: request.id,
          result: {
            cwd: "/repo",
            model: "gpt-5.5",
            reasoningEffort: "high",
            thread: { id: "thread-1" },
          },
        }))
        break
      case "turn/start":
        this.onLine?.(JSON.stringify({
          id: request.id,
          result: { turn: { id: "turn-1" } },
        }))
        break
      default:
        break
    }
  }
}
