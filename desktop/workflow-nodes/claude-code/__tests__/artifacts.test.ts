import path from "node:path"

import { describe, expect, it } from "vitest"

import {
  buildClaudeCodeDebugOutput,
  claudeCodeArtifactPaths,
  finalOutputFromClaudeCodeResult,
} from "../artifacts.main"

describe("claude code artifacts", () => {
  it("creates safe per-node artifact paths", () => {
    const paths = claudeCodeArtifactPaths("/tmp/synapse", "run-1", "node-1")

    expect(paths.directory).toBe(path.join("/tmp/synapse", "workflow-runs", "run-1", "nodes", "node-1", "claude-code"))
    expect(paths.promptPath).toBe(path.join(paths.directory, "prompt.txt"))
    expect(paths.stdoutPath).toBe(path.join(paths.directory, "stdout.log"))
    expect(paths.stderrPath).toBe(path.join(paths.directory, "stderr.log"))
    expect(paths.lastMessagePath).toBe(path.join(paths.directory, "last-message.txt"))
  })

  it("extracts final output from stream-json, json, and text output", () => {
    const streamJson = [
      JSON.stringify({ type: "assistant", message: { content: [{ type: "text", text: "draft" }] } }),
      JSON.stringify({ type: "result", subtype: "success", result: "final answer" }),
    ].join("\n")

    expect(finalOutputFromClaudeCodeResult(streamJson, "stream-json")).toBe("final answer")
    expect(finalOutputFromClaudeCodeResult(JSON.stringify({ result: "json answer" }), "json")).toBe("json answer")
    expect(finalOutputFromClaudeCodeResult("plain answer\n", "text")).toBe("plain answer")
  })

  it("redacts previews and keeps ordinary paths", () => {
    const debug = buildClaudeCodeDebugOutput({
      args: ["-p", "[prompt]"],
      cwd: "/Users/liyang/project",
      exitCode: 0,
      durationMs: 12,
      stdout: "Authorization: Bearer sk-secret\npath=/Users/liyang/project/file.ts",
      stderr: "COOKIE=session-secret",
    })

    expect(debug.stdoutPreview).toContain("[redacted]")
    expect(debug.stdoutPreview).toContain("/Users/liyang/project/file.ts")
    expect(debug.stderrPreview).toContain("[redacted]")
    expect(debug.cwd).toBe("/Users/liyang/project")
  })
})
