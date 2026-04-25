import { describe, expect, it } from "vitest"
import {
  formatObservation,
  parseObservationLine,
  TerminalObserverService,
} from "../../electron/services/terminal-observer-service"

describe("terminal observer service", () => {
  it("parses Claude Code user and assistant JSONL lines", () => {
    expect(parseObservationLine(
      `{"type":"user","message":{"role":"user","content":"hello world"},"entrypoint":"cli","sessionId":"s1"}`,
    )).toEqual({ role: "user", text: "hello world", sessionId: "s1" })

    expect(parseObservationLine(
      `{"type":"assistant","message":{"role":"assistant","content":[{"type":"text","text":"hi"},{"type":"tool_use","name":"Bash"},{"type":"text","text":"there"}]},"entrypoint":"cli"}`,
    )).toEqual({ role: "assistant", text: "hi\nthere" })

    expect(parseObservationLine(
      `{"type":"user","message":{"role":"user","content":"skip"},"entrypoint":"sdk-cli"}`,
    )).toBeNull()
    expect(parseObservationLine(`{"type":"system","sessionId":"abc123"}`)).toBeNull()
  })

  it("formats and truncates forwarded observations like cc-connect", () => {
    expect(formatObservation({ role: "user", text: "hello" })).toBe("user: hello")
    expect(formatObservation({ role: "assistant", text: "hi" })).toBe("\nClaude: hi")
    expect(formatObservation({ role: "assistant", text: "" })).toBeNull()

    const long = formatObservation({ role: "user", text: "界".repeat(2000) })
    expect(long?.endsWith("... (truncated)")).toBe(true)
    expect(Buffer.byteLength(long ?? "", "utf8")).toBeLessThanOrEqual(4000)
  })

  it("starts existing and newly discovered files at EOF", () => {
    const observer = new TerminalObserverService()
    observer.initialize([
      {
        path: "/sessions/existing.jsonl",
        content: `{"type":"user","message":{"content":"old"},"entrypoint":"cli"}\n`,
      },
    ])

    expect(observer.poll([
      {
        path: "/sessions/existing.jsonl",
        content: `{"type":"user","message":{"content":"old"},"entrypoint":"cli"}\n`,
      },
      {
        path: "/sessions/new.jsonl",
        content: `{"type":"user","message":{"content":"stale"},"entrypoint":"cli"}\n`,
      },
    ])).toEqual([])

    expect(observer.poll([
      {
        path: "/sessions/existing.jsonl",
        content: [
          `{"type":"user","message":{"content":"old"},"entrypoint":"cli"}`,
          `{"type":"user","message":{"content":"fresh"},"entrypoint":"cli"}`,
          "",
        ].join("\n"),
      },
      {
        path: "/sessions/new.jsonl",
        content: [
          `{"type":"user","message":{"content":"stale"},"entrypoint":"cli"}`,
          `{"type":"assistant","message":{"content":[{"type":"text","text":"new reply"}]},"entrypoint":"cli"}`,
          "",
        ].join("\n"),
      },
    ])).toEqual(["user: fresh", "\nClaude: new reply"])
  })

  it("buffers partial lines and resets cleanly after truncation", () => {
    const observer = new TerminalObserverService()
    observer.initialize([{ path: "/sessions/a.jsonl", content: "" }])

    expect(observer.poll([
      {
        path: "/sessions/a.jsonl",
        content: `{"type":"user","message":{"content":"hel`,
      },
    ])).toEqual([])

    expect(observer.poll([
      {
        path: "/sessions/a.jsonl",
        content: `{"type":"user","message":{"content":"hello"},"entrypoint":"cli"}\n`,
      },
    ])).toEqual(["user: hello"])

    expect(observer.poll([{ path: "/sessions/a.jsonl", content: "" }])).toEqual([])

    expect(observer.poll([
      {
        path: "/sessions/a.jsonl",
        content: `{"type":"assistant","message":{"content":[{"type":"text","text":"after truncate"}]},"entrypoint":"cli"}\n`,
      },
    ])).toEqual(["\nClaude: after truncate"])
  })
})
