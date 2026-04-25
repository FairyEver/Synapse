import { describe, expect, it } from "vitest"
import {
  appendRotatingLog,
  prepareDaemonLogExport,
  readLastLines,
  redactDaemonLogContent,
  type RotatingLogState,
} from "../../electron/services/daemon-log-export-service"

describe("daemon log export", () => {
  it("reads the last N log lines like cc-connect daemon logs", () => {
    expect(readLastLines("one\ntwo\nthree\n", 2)).toBe("two\nthree")
    expect(readLastLines("one\ntwo", 10)).toBe("one\ntwo")
  })

  it("redacts common token, secret, password, authorization and exact values", () => {
    const content = [
      "Authorization: Bearer sk-live-token",
      "api_key=sk-api",
      "client_secret: topsecret",
      "password = hunter2",
      "--token=tok-123",
      "exact sk-special-token",
    ].join("\n")

    const redacted = redactDaemonLogContent(content, ["sk-special-token"])

    expect(redacted).toContain("Authorization: Bearer ***")
    expect(redacted).toContain("api_key=***")
    expect(redacted).toContain("client_secret: ***")
    expect(redacted).toContain("password = ***")
    expect(redacted).toContain("--token=***")
    expect(redacted).toContain("exact [REDACTED]")
    expect(redacted).not.toContain("sk-live-token")
    expect(redacted).not.toContain("topsecret")
    expect(redacted).not.toContain("sk-special-token")
  })

  it("keeps one backup when rotating over the max size", () => {
    let state: RotatingLogState = { current: "" }
    state = appendRotatingLog(state, "a".repeat(6), 10)
    expect(state).toEqual({ current: "aaaaaa" })

    state = appendRotatingLog(state, "b".repeat(6), 10)
    expect(state.current).toBe("")
    expect(state.backup).toBe("aaaaaabbbbbb")

    state = appendRotatingLog(state, "c".repeat(11), 10)
    expect(state.current).toBe("")
    expect(state.backup).toBe("c".repeat(11))
  })

  it("prepares redacted multi-file exports in stable mtime order", () => {
    const result = prepareDaemonLogExport([
      { name: "new.log", content: "new\nsecret=abc", mtimeMs: 2 },
      { name: "old.log", content: "one\ntwo\ntoken=raw", mtimeMs: 1 },
    ], { lineCount: 2 })

    expect(result.fileCount).toBe(2)
    expect(result.files.map((file) => file.name)).toEqual(["old.log", "new.log"])
    expect(result.combinedContent).toContain("== old.log ==")
    expect(result.combinedContent).not.toContain("token=raw")
    expect(result.combinedContent).not.toContain("secret=abc")
  })
})
