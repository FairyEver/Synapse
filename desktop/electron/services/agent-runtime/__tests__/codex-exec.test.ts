import { describe, expect, it } from "vitest"

import {
  CodexJsonLineParser,
  buildCodexExecArgs,
} from "../adapters/codex-exec"

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
