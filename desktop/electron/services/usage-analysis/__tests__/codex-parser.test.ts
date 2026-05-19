import { describe, expect, it } from "vitest"
import fs from "node:fs"
import os from "node:os"
import path from "node:path"
import { parseCodexUsageFile } from "../codex-parser"

describe("Codex usage parser", () => {
  it("extracts token counts, session metadata, tools, and task timings", async () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), "codex-parser-"))
    try {
      const file = path.join(dir, "rollout-test.jsonl")
      fs.writeFileSync(file, [
        JSON.stringify({ type: "session_meta", timestamp: "2026-05-19T01:00:00.000Z", payload: { type: "session_meta", id: "s1", cwd: "/tmp/project", model_provider: "openai", source: "cli", cli_version: "1.0.0" } }),
        JSON.stringify({ type: "turn_context", timestamp: "2026-05-19T01:00:01.000Z", payload: { type: "turn_context", model: "gpt-5.5" } }),
        JSON.stringify({ type: "event_msg", timestamp: "2026-05-19T01:00:02.000Z", payload: { type: "user_message", content: "hidden user message" } }),
        JSON.stringify({ type: "event_msg", timestamp: "2026-05-19T01:00:03.000Z", payload: { type: "token_count", info: { last_token_usage: { input_tokens: 100, cached_input_tokens: 20, output_tokens: 30, reasoning_output_tokens: 10, total_tokens: 140 } } } }),
        JSON.stringify({ type: "response_item", timestamp: "2026-05-19T01:00:04.000Z", payload: { type: "function_call", name: "exec_command", call_id: "call-1", arguments: { cmd: "hidden command" } } }),
        JSON.stringify({ type: "event_msg", timestamp: "2026-05-19T01:00:05.000Z", payload: { type: "exec_command_end", call_id: "call-1", status: "failed", exit_code: 1, duration: 123 } }),
        JSON.stringify({ type: "event_msg", timestamp: "2026-05-19T01:00:06.000Z", payload: { type: "task_complete", turn_id: "t1", duration_ms: 5000, time_to_first_token_ms: 700 } }),
      ].join("\n"))

      const parsed = await parseCodexUsageFile(file)
      expect(parsed.sessions[0]).toMatchObject({
        sessionId: "s1",
        workspaceLabel: "project",
        provider: "openai",
        source: "cli",
        requestCount: 1,
        conversationCount: 1,
        toolCallCount: 2,
      })
      expect(parsed.usageEvents[0]).toMatchObject({
        model: "gpt-5.5",
        inputTokens: 80,
        cacheReadTokens: 20,
        outputTokens: 30,
        reasoningTokens: 10,
      })
      expect(parsed.toolEvents.map((event) => event.category)).toEqual(["function_call", "exec"])
      expect(parsed.taskEvents[0]).toMatchObject({
        durationMs: 5000,
        timeToFirstTokenMs: 700,
      })
      expect(JSON.stringify(parsed)).not.toContain("hidden user message")
      expect(JSON.stringify(parsed)).not.toContain("hidden command")
    } finally {
      fs.rmSync(dir, { recursive: true, force: true })
    }
  })
})
