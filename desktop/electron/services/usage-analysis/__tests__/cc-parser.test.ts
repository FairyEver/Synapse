import { describe, expect, it } from "vitest"
import fs from "node:fs"
import os from "node:os"
import path from "node:path"
import { parseClaudeUsageFile } from "../cc-parser"

describe("Claude Code usage parser", () => {
  it("extracts assistant usage and tool calls without content text", async () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), "cc-parser-"))
    try {
      const file = path.join(dir, "session.jsonl")
      fs.writeFileSync(file, [
        JSON.stringify({ type: "user", timestamp: "2026-05-19T01:00:00.000Z", message: { role: "user", content: "secret prompt" } }),
        JSON.stringify({
          type: "assistant",
          timestamp: "2026-05-19T01:00:01.000Z",
          message: {
            role: "assistant",
            model: "claude-opus-4.6",
            usage: {
              input_tokens: 100,
              output_tokens: 20,
              cache_read_input_tokens: 30,
              cache_creation_input_tokens: 40,
              cache_creation: {
                ephemeral_5m_input_tokens: 40,
                ephemeral_1h_input_tokens: 0,
              },
            },
            content: [
              { type: "tool_use", name: "Bash", id: "tool-1", input: { command: "echo hidden" } },
              { type: "tool_result", tool_use_id: "tool-1", content: "hidden output" },
              { type: "thinking", thinking: "hidden thinking" },
            ],
          },
        }),
      ].join("\n"))

      const parsed = await parseClaudeUsageFile(file)
      expect(parsed.sessions[0]).toMatchObject({
        sessionId: "session",
        requestCount: 1,
        conversationCount: 1,
        toolCallCount: 1,
      })
      expect(parsed.usageEvents[0]).toMatchObject({
        model: "claude-opus-4.6",
        inputTokens: 100,
        outputTokens: 20,
        cacheReadTokens: 30,
        cacheWriteTokens: 40,
      })
      expect(parsed.toolEvents[0]).toMatchObject({
        toolName: "Bash",
        category: "tool_use",
      })
      expect(JSON.stringify(parsed)).not.toContain("secret prompt")
      expect(JSON.stringify(parsed)).not.toContain("hidden output")
      expect(JSON.stringify(parsed)).not.toContain("hidden thinking")
    } finally {
      fs.rmSync(dir, { recursive: true, force: true })
    }
  })
})
