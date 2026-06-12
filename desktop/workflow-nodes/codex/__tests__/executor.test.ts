import { mkdtemp } from "node:fs/promises"
import os from "node:os"
import path from "node:path"

import { describe, expect, it } from "vitest"

import {
  buildCodexDebugOutput,
  codexArtifactPaths,
  finalOutputFromResult,
  readCodexArtifact,
  writeCodexArtifact,
} from "../artifacts.main"

describe("codex artifacts", () => {
  it("builds the expected path shape", () => {
    const paths = codexArtifactPaths("/tmp/synapse", "run-1", "node-1")

    expect(paths).toEqual({
      directory: path.join("/tmp/synapse", "workflow-runs", "run-1", "nodes", "node-1", "codex"),
      promptPath: path.join("/tmp/synapse", "workflow-runs", "run-1", "nodes", "node-1", "codex", "prompt.txt"),
      stdoutPath: path.join("/tmp/synapse", "workflow-runs", "run-1", "nodes", "node-1", "codex", "stdout.log"),
      stderrPath: path.join("/tmp/synapse", "workflow-runs", "run-1", "nodes", "node-1", "codex", "stderr.log"),
      lastMessagePath: path.join("/tmp/synapse", "workflow-runs", "run-1", "nodes", "node-1", "codex", "last-message.txt"),
    })
  })

  it("redacts secret-looking debug previews while keeping normal paths", () => {
    const debug = buildCodexDebugOutput({
      args: ["exec", "--config", "ANTHROPIC_API_KEY=sk-test-secret", "--cd", "/Users/liyang/project"],
      cwd: "/Users/liyang/project",
      exitCode: 1,
      durationMs: 123,
      stdout: "created /Users/liyang/project/out.txt\nAuthorization: Bearer secret-token",
      stderr: "token=secret-token at /Users/liyang/project/error.log",
    })

    expect(JSON.stringify(debug)).not.toContain("sk-test-secret")
    expect(JSON.stringify(debug)).not.toContain("secret-token")
    expect(debug.cwd).toBe("/Users/liyang/project")
    expect(debug.args).toContain("/Users/liyang/project")
    expect(debug.stdoutPreview).toContain("/Users/liyang/project/out.txt")
    expect(debug.stderrPreview).toContain("/Users/liyang/project/error.log")
  })

  it("redacts URL query secrets in debug args and previews", () => {
    const debug = buildCodexDebugOutput({
      args: ["exec", "--config", "endpoint=https://example.com/path?token=secret-token"],
      cwd: "/Users/liyang/project",
      exitCode: 1,
      durationMs: 123,
      stdout: "opened https://example.com/path?token=secret-token",
      stderr: "failed https://example.com/path?api_key=secret-token",
    })

    expect(JSON.stringify(debug)).not.toContain("secret-token")
    expect(debug.args.join(" ")).toContain("token=[redacted]")
    expect(debug.stdoutPreview).toContain("token=[redacted]")
    expect(debug.stderrPreview).toContain("api_key=[redacted]")
  })

  it("truncates debug previews to 2000 characters", () => {
    const debug = buildCodexDebugOutput({
      args: ["exec"],
      cwd: "/Users/liyang/project",
      exitCode: 0,
      durationMs: 10,
      stdout: "x".repeat(2001),
    })

    expect(debug.stdoutPreview).toHaveLength(2000)
    expect(debug.stdoutPreview?.endsWith("...")).toBe(true)
  })

  it("prefers last message before stdout fallback", () => {
    expect(finalOutputFromResult(" final answer \n", " stdout ")).toBe("final answer")
    expect(finalOutputFromResult(" \n", " stdout \n")).toBe("stdout")
    expect(finalOutputFromResult(undefined, undefined)).toBe("")
  })

  it("extracts and dedupes JSONL session hints", () => {
    const debug = buildCodexDebugOutput({
      args: ["exec"],
      cwd: "/Users/liyang/project",
      exitCode: 0,
      durationMs: 10,
      stdout: [
        JSON.stringify({ thread_id: "thread-1", session_id: "session-1" }),
        JSON.stringify({ thread_id: "thread-1", session_path: "/Users/liyang/.codex/sessions/session-1.jsonl" }),
        "not json",
      ].join("\n"),
    })

    expect(debug.sessionHints).toEqual([
      "thread_id=thread-1",
      "session_id=session-1",
      "session_path=/Users/liyang/.codex/sessions/session-1.jsonl",
    ])
  })

  it("writes sanitized artifact content", async () => {
    const tempDir = await mkdtemp(path.join(os.tmpdir(), "synapse-codex-artifacts-"))
    const filePath = path.join(tempDir, "stdout.log")

    await writeCodexArtifact(filePath, "result\nAuthorization: Bearer secret-token")

    const content = await readCodexArtifact(filePath)
    expect(content).toContain("result")
    expect(content).not.toContain("secret-token")
  })
})
