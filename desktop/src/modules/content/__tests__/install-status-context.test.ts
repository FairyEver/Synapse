import { describe, expect, it } from "vitest"

import { mergeInstallStatusSnapshot } from "../contexts/install-status-context"
import type { InstallStatusEntry, InstallStatusMap } from "@/types/install-status"

const installed: InstallStatusEntry = {
  editorId: "claude-code",
  scope: "global",
  status: "installed",
}

const needsUpdate: InstallStatusEntry = {
  editorId: "codex",
  scope: "project",
  projectName: "Synapse",
  projectPath: "/repo",
  status: "needs_update",
}

describe("mergeInstallStatusSnapshot", () => {
  it("keeps install status changes that arrived before the initial snapshot", () => {
    const snapshot: InstallStatusMap = {
      "content-a": [installed],
    }
    const current: InstallStatusMap = {
      "content-a": [needsUpdate],
      "content-b": [installed],
    }

    expect(mergeInstallStatusSnapshot(snapshot, current, new Set(["content-a", "content-b"]))).toEqual({
      "content-a": [needsUpdate],
      "content-b": [installed],
    })
  })

  it("keeps install status deletes that arrived before the initial snapshot", () => {
    const snapshot: InstallStatusMap = {
      "content-a": [installed],
      "content-b": [needsUpdate],
    }
    const current: InstallStatusMap = {
      "content-b": [needsUpdate],
    }

    expect(mergeInstallStatusSnapshot(snapshot, current, new Set(["content-a"]))).toEqual({
      "content-b": [needsUpdate],
    })
  })
})
