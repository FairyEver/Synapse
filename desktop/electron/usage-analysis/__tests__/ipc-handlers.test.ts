import { describe, expect, it } from "vitest"
import fs from "node:fs"
import os from "node:os"
import path from "node:path"
import { normalizeUsageRangeForIpc, resolveClaudeUsageRoots } from "../ipc-handlers"

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
