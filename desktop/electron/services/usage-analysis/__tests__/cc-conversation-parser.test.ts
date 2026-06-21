import { afterEach, describe, expect, it, vi } from "vitest"
import fs from "node:fs"
import os from "node:os"
import path from "node:path"
import { Readable } from "node:stream"
import { parseCcConversationFile, parseCcConversationFileChunk } from "../cc-conversation-parser"

const tempDirs: string[] = []
const SENSITIVE_NON_OBJECT_LINE =
  "ANTHROPIC_AUTH_TOKEN=sk-live-secret Authorization: Bearer sk-live-bearer " +
  '{"token":"data-server-token"} /Users/liyang/project/file.ts'

function writeJsonl(lines: readonly string[], newline = "\n"): string {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "cc-conversation-parser-"))
  tempDirs.push(dir)
  const file = path.join(dir, "session-1.jsonl")
  fs.writeFileSync(file, `${lines.join(newline)}${newline}`, "utf8")
  return file
}

afterEach(() => {
  vi.restoreAllMocks()
  for (const dir of tempDirs.splice(0)) {
    fs.rmSync(dir, { recursive: true, force: true })
  }
})

describe("parseCcConversationFile", () => {
  it("preserves observed raw event types and normalized fields", async () => {
    const file = writeJsonl([
      JSON.stringify({ type: "ai-title", sessionId: "s1", aiTitle: "标题" }),
      JSON.stringify({
        type: "user",
        sessionId: "s1",
        uuid: "u1",
        parentUuid: null,
        timestamp: "2026-05-27T01:00:00.000Z",
        cwd: "/repo",
        gitBranch: "main",
        message: { role: "user", content: "帮我看一下" },
      }),
      JSON.stringify({
        type: "assistant",
        sessionId: "s1",
        uuid: "a1",
        parentUuid: "u1",
        timestamp: "2026-05-27T01:00:01.000Z",
        message: {
          role: "assistant",
          model: "claude-opus-4.6",
          stop_reason: "tool_use",
          usage: { input_tokens: 10, output_tokens: 2 },
          content: [
            { type: "thinking", thinking: "analysis" },
            { type: "tool_use", id: "tool-1", name: "Read", input: { file_path: "a.ts" } },
          ],
        },
      }),
      JSON.stringify({
        type: "user",
        sessionId: "s1",
        uuid: "tr1",
        parentUuid: "a1",
        timestamp: "2026-05-27T01:00:02.000Z",
        message: { role: "user", content: [{ type: "tool_result", tool_use_id: "tool-1", content: "ok" }] },
        toolUseResult: { stdout: "ok", stderr: "", interrupted: false },
      }),
      JSON.stringify({ type: "attachment", sessionId: "s1", uuid: "att1", attachment: { fileName: "a.png" } }),
      JSON.stringify({ type: "system", sessionId: "s1", uuid: "sys1", level: "info", content: "done" }),
      JSON.stringify({ type: "queue-operation", sessionId: "s1", operation: "enqueue", content: "x" }),
      JSON.stringify({ type: "permission-mode", sessionId: "s1", permissionMode: "default" }),
      JSON.stringify({ type: "last-prompt", sessionId: "s1", lastPrompt: "继续", leafUuid: "a1" }),
      JSON.stringify({ type: "file-history-snapshot", messageId: "m1", snapshot: [] }),
    ])

    const result = await parseCcConversationFile(file)

    expect(result.events.map((event) => event.type)).toEqual([
      "ai-title",
      "user",
      "assistant",
      "user",
      "attachment",
      "system",
      "queue-operation",
      "permission-mode",
      "last-prompt",
      "file-history-snapshot",
    ])
    expect(result.events[1]).toMatchObject({ id: "u1", role: "user", uuid: "u1" })
    expect(result.events[2]).toMatchObject({
      id: "a1",
      role: "assistant",
      model: "claude-opus-4.6",
      toolName: "Read",
      toolUseId: "tool-1",
    })
    expect(result.events[2].contentBlocks).toHaveLength(2)
    expect(result.events[3].raw.toolUseResult).toEqual({ stdout: "ok", stderr: "", interrupted: false })
    expect(result.parseErrors).toEqual([])
  })

  it("keeps malformed lines as parse errors", async () => {
    const file = writeJsonl([
      JSON.stringify({ type: "user", sessionId: "s1", uuid: "u1", message: { role: "user", content: "ok" } }),
      "{bad json",
    ])

    const result = await parseCcConversationFile(file)

    expect(result.events).toHaveLength(1)
    expect(result.parseErrors).toEqual([expect.objectContaining({
      id: "parse-error:2",
      lineNumber: 2,
      rawLine: "{bad json",
    })])
  })

  it("redacts non-object JSON parse error raw lines", async () => {
    const file = writeJsonl([JSON.stringify(SENSITIVE_NON_OBJECT_LINE)])

    const result = await parseCcConversationFile(file)

    expect(result.events).toEqual([])
    expect(result.parseErrors).toEqual([
      expect.objectContaining({
        id: "parse-error:1",
        lineNumber: 1,
        message: "JSONL line is not an object.",
        rawLine: expect.stringContaining("/Users/liyang/project/file.ts"),
      }),
    ])
    expect(result.parseErrors[0]?.rawLine).toContain("[redacted]")
    expect(result.parseErrors[0]?.rawLine).not.toContain("sk-live-secret")
    expect(result.parseErrors[0]?.rawLine).not.toContain("sk-live-bearer")
    expect(result.parseErrors[0]?.rawLine).not.toContain("data-server-token")
  })

  it("records stream read failures as parse errors instead of rejecting", async () => {
    vi.spyOn(fs, "createReadStream").mockReturnValue(createFailingReadStream() as ReturnType<typeof fs.createReadStream>)

    const result = await parseCcConversationFile("/tmp/session.jsonl")

    expect(result.events).toHaveLength(1)
    expect(result.parseErrors).toEqual([
      expect.objectContaining({
        id: "stream-error:2",
        lineNumber: 2,
        byteOffset: expect.any(Number),
        message: "stream read failed token=[redacted]",
      }),
    ])
  })
})

describe("parseCcConversationFileChunk", () => {
  it("resumes CRLF transcripts from the correct byte cursor", async () => {
    const lines = [
      JSON.stringify({ type: "user", sessionId: "s1", uuid: "u1", message: { role: "user", content: "one" } }),
      JSON.stringify({ type: "assistant", sessionId: "s1", uuid: "a1", message: { role: "assistant", content: "two" } }),
      JSON.stringify({ type: "user", sessionId: "s1", uuid: "u2", message: { role: "user", content: "three" } }),
    ]
    const file = writeJsonl(lines, "\r\n")

    const first = await parseCcConversationFileChunk(file, { limit: 2 })
    const second = await parseCcConversationFileChunk(file, { cursor: first.nextCursor, limit: 2 })

    expect(first.events.map((event) => event.uuid)).toEqual(["u1", "a1"])
    expect(first.parseErrors).toEqual([])
    expect(first.nextCursor).toBeDefined()
    expect(second.events.map((event) => event.uuid)).toEqual(["u2"])
    expect(second.parseErrors).toEqual([])
    expect(second.nextCursor).toBeUndefined()
  })

  it("redacts non-object JSON parse error raw lines", async () => {
    const file = writeJsonl([JSON.stringify(SENSITIVE_NON_OBJECT_LINE)])

    const result = await parseCcConversationFileChunk(file)

    expect(result.events).toEqual([])
    expect(result.parseErrors).toEqual([
      expect.objectContaining({
        id: "parse-error:1",
        lineNumber: 1,
        message: "JSONL line is not an object.",
        rawLine: expect.stringContaining("/Users/liyang/project/file.ts"),
      }),
    ])
    expect(result.parseErrors[0]?.rawLine).toContain("[redacted]")
    expect(result.parseErrors[0]?.rawLine).not.toContain("sk-live-secret")
    expect(result.parseErrors[0]?.rawLine).not.toContain("sk-live-bearer")
    expect(result.parseErrors[0]?.rawLine).not.toContain("data-server-token")
  })
})

function createFailingReadStream(): Readable {
  let sent = false
  return new Readable({
    read() {
      if (sent) return
      sent = true
      this.push(`${JSON.stringify({ type: "user", sessionId: "s1", uuid: "u1", message: { role: "user", content: "ok" } })}\n`)
      this.destroy(new Error("stream read failed token=secret-value"))
    },
  })
}
