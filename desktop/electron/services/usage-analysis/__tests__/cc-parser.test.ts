import { describe, expect, it, vi } from "vitest"
import fs from "node:fs"
import os from "node:os"
import path from "node:path"
import { parseClaudeUsageFile, parseClaudeUsageFileSegment } from "../cc-parser"
import { localDateKey, localHourKey } from "../range"

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

  it("parses only the appended segment from a byte offset", async () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), "cc-parser-"))
    try {
      const file = path.join(dir, "session.jsonl")
      const first = `${JSON.stringify({
        type: "assistant",
        sessionId: "session",
        timestamp: "2026-05-19T01:00:01.000Z",
        message: {
          id: "msg-1",
          role: "assistant",
          model: "claude-opus-4.6",
          usage: { input_tokens: 100, output_tokens: 20 },
        },
      })}\n`
      fs.writeFileSync(file, first)
      const offset = Buffer.byteLength(first)
      const appendedTimestamp = "2026-05-19T02:00:01.000Z"
      fs.appendFileSync(file, `${JSON.stringify({
        type: "assistant",
        sessionId: "session",
        timestamp: appendedTimestamp,
        message: {
          id: "msg-2",
          role: "assistant",
          model: "claude-opus-4.6",
          usage: { input_tokens: 10, output_tokens: 5 },
        },
      })}\n`)

      const parsed = await parseClaudeUsageFileSegment({
        filePath: file,
        startOffset: offset,
        mode: "append",
        previousState: { recentDedupeKeys: [] },
      })

      expect(parsed.usageEvents).toHaveLength(1)
      expect(parsed.usageEvents[0]).toMatchObject({
        id: "session:usage:msg-2",
        inputTokens: 10,
        outputTokens: 5,
      })
      expect(parsed.nextOffset).toBe(fs.statSync(file).size)
      expect(parsed.affectedDates).toEqual([localDateKey(Date.parse(appendedTimestamp))])
      expect(parsed.affectedHours).toEqual([localHourKey(Date.parse(appendedTimestamp))])
    } finally {
      fs.rmSync(dir, { recursive: true, force: true })
    }
  })

  it("skips unrelated JSON lines before JSON.parse", async () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), "cc-parser-"))
    try {
      const file = path.join(dir, "session.jsonl")
      const lines = [
        JSON.stringify({ type: "summary", summary: "secret summary" }),
        JSON.stringify({ type: "system", content: "secret system" }),
        JSON.stringify({
          type: "assistant",
          sessionId: "session",
          timestamp: "2026-05-19T01:00:01.000Z",
          message: {
            id: "msg-1",
            role: "assistant",
            model: "claude-opus-4.6",
            usage: { input_tokens: 1, output_tokens: 2 },
          },
        }),
      ]
      fs.writeFileSync(file, `${lines.join("\n")}\n`)
      const parseSpy = vi.spyOn(JSON, "parse")
      try {
        const parsed = await parseClaudeUsageFileSegment({ filePath: file, startOffset: 0, mode: "replace" })

        expect(parsed.usageEvents).toHaveLength(1)
        expect(parseSpy).toHaveBeenCalledTimes(1)
        expect(JSON.stringify(parsed)).not.toContain("secret summary")
        expect(JSON.stringify(parsed)).not.toContain("secret system")
      } finally {
        parseSpy.mockRestore()
      }
    } finally {
      fs.rmSync(dir, { recursive: true, force: true })
    }
  })

  it("dedupes appended assistant usage by message and request id", async () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), "cc-parser-"))
    try {
      const file = path.join(dir, "session.jsonl")
      const duplicate = {
        type: "assistant",
        sessionId: "session",
        requestId: "req-1",
        timestamp: "2026-05-19T01:00:01.000Z",
        message: {
          id: "msg-1",
          role: "assistant",
          model: "claude-opus-4.6",
          usage: { input_tokens: 1, output_tokens: 2 },
        },
      }
      fs.writeFileSync(file, `${JSON.stringify(duplicate)}\n`)

      const parsed = await parseClaudeUsageFileSegment({
        filePath: file,
        startOffset: 0,
        mode: "replace",
        previousState: { recentDedupeKeys: ["msg-1:req-1"] },
      })

      expect(parsed.usageEvents).toHaveLength(0)
      expect(parsed.parserState.recentDedupeKeys).toContain("msg-1:req-1")
    } finally {
      fs.rmSync(dir, { recursive: true, force: true })
    }
  })
})
