import { describe, expect, it } from "vitest"
import fs from "node:fs"
import os from "node:os"
import path from "node:path"
import {
  normalizeConversationFocus,
  normalizeConversationListInput,
  normalizeRecordDetailsInput,
  normalizeUsageRangeForIpc,
  resolveClaudeUsageRoots,
} from "../ipc-handlers"

describe("usage analysis ipc handlers", () => {
  it("accepts today range preset", () => {
    expect(normalizeUsageRangeForIpc({ preset: "today" })).toEqual({ preset: "today" })
  })

  it("accepts valid trend bucket granularity", () => {
    expect(normalizeUsageRangeForIpc({ preset: "30d", bucket: "hour" })).toEqual({
      preset: "30d",
      bucket: "hour",
    })
  })

  it("drops invalid trend bucket granularity", () => {
    expect(normalizeUsageRangeForIpc({ preset: "30d", bucket: "minute" })).toEqual({ preset: "30d" })
  })

  it("falls back to 30d for unknown range preset", () => {
    expect(normalizeUsageRangeForIpc({ preset: "unknown" })).toEqual({ preset: "30d" })
  })

  it("normalizes Claude Code conversation query inputs", () => {
    expect(normalizeConversationListInput({
      preset: "all",
      query: "  登录  ",
      rawText: true,
      project: "-repo",
      model: "opus",
      tool: "Read",
      eventType: "user",
      limit: 20,
      offset: 5,
      cursor: "next",
    })).toEqual({
      preset: "all",
      query: "登录",
      rawText: true,
      project: "-repo",
      model: "opus",
      tool: "Read",
      eventType: "user",
      limit: 20,
      offset: 5,
      cursor: "next",
    })
    expect(normalizeConversationFocus({
      eventId: "event-1",
      usageEventId: "usage-1",
      toolEventId: "tool-1",
      timestampMs: 1779860000000.9,
    })).toEqual({
      eventId: "event-1",
      usageEventId: "usage-1",
      toolEventId: "tool-1",
      timestampMs: 1779860000000,
    })
  })

  it("defaults Claude Code record query inputs to a 50 item batch", () => {
    expect(normalizeConversationListInput({
      preset: "all",
      limit: undefined,
      offset: undefined,
    })).toEqual({
      preset: "all",
      query: undefined,
      rawText: false,
      project: undefined,
      model: undefined,
      tool: undefined,
      eventType: undefined,
      limit: 50,
      offset: 0,
      cursor: undefined,
    })
  })

  it("normalizes Claude Code record detail inputs", () => {
    expect(normalizeRecordDetailsInput({
      sessionId: " session-1 ",
      limit: 400,
      offset: 10,
    })).toEqual({
      sessionId: "session-1",
      limit: 400,
      offset: 10,
    })
    expect(() => normalizeRecordDetailsInput({ sessionId: " " })).toThrow("sessionId is required")
  })

  it("includes the default and configured Claude Code projects directories", () => {
    expect(resolveClaudeUsageRoots({
      home: "/Users/test",
      env: { CLAUDE_CONFIG_DIR: "/tmp/claude-a,/tmp/claude-b" },
      platform: "darwin",
    })).toEqual([
      "/Users/test/.claude/projects",
      "/tmp/claude-a/projects",
      "/tmp/claude-b/projects",
    ])
  })

  it("discovers Claude desktop projects directories", () => {
    const home = fs.mkdtempSync(path.join(os.tmpdir(), "usage-analysis-home-"))
    try {
      const projectsDir = path.join(
        home,
        "Library",
        "Application Support",
        "Claude",
        "local-agent-mode-sessions",
        "account",
        "org",
        "projects",
      )
      fs.mkdirSync(projectsDir, { recursive: true })

      expect(resolveClaudeUsageRoots({ home, env: {}, platform: "darwin" })).toEqual([
        path.posix.join(home, ".claude", "projects"),
        projectsDir,
      ])
    } finally {
      fs.rmSync(home, { recursive: true, force: true })
    }
  })
})
