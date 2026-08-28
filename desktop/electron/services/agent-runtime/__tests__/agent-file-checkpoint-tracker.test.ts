import { mkdtemp, rm, writeFile } from "node:fs/promises"
import os from "node:os"
import path from "node:path"

import { describe, expect, it } from "vitest"

import { AgentFileCheckpointTracker } from "../agent-file-checkpoint-tracker"

describe("AgentFileCheckpointTracker", () => {
  it("captures a bounded patch for a foreground Edit tracked by the SDK", async () => {
    const root = await mkdtemp(path.join(os.tmpdir(), "synapse-checkpoint-tracker-"))
    try {
      const filePath = path.join(root, "notes.md")
      await writeFile(filePath, "before\n")
      const tracker = new AgentFileCheckpointTracker({ cwd: root })
      tracker.begin("turn-1")
      tracker.recordSdkUserMessageId("user-message-1")
      await tracker.captureBeforeTool(preToolUse("Edit", { file_path: filePath }))
      await writeFile(filePath, "after\n")

      const capture = await tracker.finalize("sdk-session-1", async () => ({
        canRewind: true,
        filesChanged: [filePath],
        insertions: 1,
        deletions: 1,
      }))

      expect(capture).toMatchObject({
        turnId: "turn-1",
        sdkSessionId: "sdk-session-1",
        sdkUserMessageId: "user-message-1",
        insertions: 1,
        deletions: 1,
        files: [{
          displayPath: "notes.md",
          kind: "modified",
          insertions: 1,
          deletions: 1,
          binary: false,
          truncated: false,
        }],
      })
      expect(capture?.files[0]?.patch).toContain("-before")
      expect(capture?.files[0]?.patch).toContain("+after")
    } finally {
      await rm(root, { recursive: true, force: true })
    }
  })

  it("summarizes the forward file diff instead of the reverse SDK rewind counts", async () => {
    const root = await mkdtemp(path.join(os.tmpdir(), "synapse-checkpoint-direction-"))
    try {
      const filePath = path.join(root, "added.md")
      const tracker = new AgentFileCheckpointTracker({ cwd: root })
      tracker.begin("turn-1")
      tracker.recordSdkUserMessageId("user-message-1")
      await tracker.captureBeforeTool(preToolUse("Write", { file_path: filePath }))
      await writeFile(filePath, "first\nsecond\n")

      const capture = await tracker.finalize("sdk-session-1", async () => ({
        canRewind: true,
        filesChanged: [filePath],
        insertions: 0,
        deletions: 2,
      }))

      expect(capture).toMatchObject({
        insertions: 2,
        deletions: 0,
        files: [{
          displayPath: "added.md",
          insertions: 2,
          deletions: 0,
        }],
      })
    } finally {
      await rm(root, { recursive: true, force: true })
    }
  })

  it("ignores subagent and outside-workspace writes", async () => {
    const root = await mkdtemp(path.join(os.tmpdir(), "synapse-checkpoint-scope-"))
    try {
      const tracker = new AgentFileCheckpointTracker({ cwd: root })
      tracker.begin("turn-1")
      tracker.recordSdkUserMessageId("user-message-1")
      await tracker.captureBeforeTool({
        ...preToolUse("Write", { file_path: path.join(root, "child.md") }),
        agent_id: "subagent-1",
      })
      await tracker.captureBeforeTool(preToolUse("Write", { file_path: path.join(root, "..", "outside.md") }))

      await expect(tracker.finalize("sdk-session-1", async () => ({
        canRewind: true,
        filesChanged: [path.join(root, "child.md")],
      }))).resolves.toBeNull()
    } finally {
      await rm(root, { recursive: true, force: true })
    }
  })

  it("does not persist a checkpoint when the SDK reports a file without a captured baseline", async () => {
    const root = await mkdtemp(path.join(os.tmpdir(), "synapse-checkpoint-coverage-"))
    try {
      const capturedPath = path.join(root, "captured.md")
      const missingBaselinePath = path.join(root, "other.md")
      await writeFile(capturedPath, "before\n")
      await writeFile(missingBaselinePath, "external\n")
      const tracker = new AgentFileCheckpointTracker({ cwd: root })
      tracker.begin("turn-1")
      tracker.recordSdkUserMessageId("user-message-1")
      await tracker.captureBeforeTool(preToolUse("Edit", { file_path: capturedPath }))
      await writeFile(capturedPath, "after\n")

      await expect(tracker.finalize("sdk-session-1", async () => ({
        canRewind: true,
        filesChanged: [capturedPath, missingBaselinePath],
      }))).resolves.toBeNull()
    } finally {
      await rm(root, { recursive: true, force: true })
    }
  })

  it("records a coverage warning when Bash or a subagent runs in the same turn", async () => {
    const root = await mkdtemp(path.join(os.tmpdir(), "synapse-checkpoint-warning-"))
    try {
      const filePath = path.join(root, "notes.md")
      await writeFile(filePath, "before\n")
      const tracker = new AgentFileCheckpointTracker({ cwd: root })
      tracker.begin("turn-1")
      tracker.recordSdkUserMessageId("user-message-1")
      await tracker.captureBeforeTool(preToolUse("Edit", { file_path: filePath }))
      await tracker.captureBeforeTool(preToolUse("Bash", { command: "true" }))
      await tracker.captureBeforeTool({
        ...preToolUse("Edit", { file_path: filePath }),
        agent_id: "subagent-1",
      })
      await writeFile(filePath, "after\n")

      await expect(tracker.finalize("sdk-session-1", async () => ({
        canRewind: true,
        filesChanged: [filePath],
      }))).resolves.toMatchObject({ coverageWarning: true })
    } finally {
      await rm(root, { recursive: true, force: true })
    }
  })

  it("persists an unavailable checkpoint when the SDK reports more than 1000 files", async () => {
    const root = await mkdtemp(path.join(os.tmpdir(), "synapse-checkpoint-limit-"))
    try {
      const filePaths = Array.from({ length: 1_001 }, (_, index) => path.join(root, `file-${index}.md`))
      const tracker = new AgentFileCheckpointTracker({ cwd: root })
      tracker.begin("turn-1")
      tracker.recordSdkUserMessageId("user-message-1")
      for (const filePath of filePaths) {
        await tracker.captureBeforeTool(preToolUse("Write", { file_path: filePath }))
      }

      await expect(tracker.finalize("sdk-session-1", async () => ({
        canRewind: true,
        filesChanged: filePaths,
      }))).resolves.toMatchObject({
        status: "unavailable",
        fileCount: 1_001,
        files: [],
      })
    } finally {
      await rm(root, { recursive: true, force: true })
    }
  })
})

function preToolUse(toolName: string, toolInput: Record<string, unknown>) {
  return {
    hook_event_name: "PreToolUse",
    tool_name: toolName,
    tool_input: toolInput,
    tool_use_id: "tool-use-1",
  }
}
