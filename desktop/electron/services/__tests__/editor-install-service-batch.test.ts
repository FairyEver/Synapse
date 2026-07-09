import { describe, expect, it, vi } from "vitest"
import { EditorInstallService } from "../editor-install-service"
import type { SynapseContentInstallResult } from "../../../src/types/editor"
import type { SynapseInstallSourceToEditorPayload } from "../../../src/types/installers"

const source = {
  kind: "skill",
  origin: "prepared",
  sourceIdentity: "synapse-skill",
  name: "synapse-skill",
  title: "Synapse Skill",
  description: "Synapse MCP 使用指南",
  preparedSourceId: "synapse-skill:test",
  mainContent: "# Synapse Skill",
  sourceFingerprint: "sha256:test",
} satisfies SynapseInstallSourceToEditorPayload["source"]

function createInstallResult(editorId: string): SynapseContentInstallResult {
  return {
    editorId: editorId as SynapseContentInstallResult["editorId"],
    label: editorId,
    scope: "global",
    contentType: "skill",
    contentId: "synapse-skill",
    targetKind: "directory",
    targetPath: `/tmp/${editorId}/skills/synapse-skill`,
  }
}

describe("EditorInstallService batch source install", () => {
  it("installs each target sequentially and returns per-target results", async () => {
    const service = new EditorInstallService()
    const calls: string[] = []
    vi.spyOn(service, "installSourceToEditor").mockImplementation(async (payload) => {
      calls.push(payload.editorId)
      return createInstallResult(payload.editorId)
    })

    const result = await service.installSourceToEditorTargets({
      mode: "install",
      source,
      targets: [
        { editorId: "codex" as never, scope: "global" },
        { editorId: "cursor" as never, scope: "global" },
      ],
    })

    expect(calls).toEqual(["codex", "cursor"])
    expect(result.results).toEqual([
      expect.objectContaining({ status: "installed", target: { editorId: "codex", scope: "global" } }),
      expect.objectContaining({ status: "installed", target: { editorId: "cursor", scope: "global" } }),
    ])
  })

  it("keeps installing after one target fails", async () => {
    const service = new EditorInstallService()
    vi.spyOn(service, "installSourceToEditor").mockImplementation(async (payload) => {
      if (payload.editorId === "broken") {
        throw new Error("install failed")
      }
      return createInstallResult(payload.editorId)
    })

    const result = await service.installSourceToEditorTargets({
      mode: "update",
      source,
      targets: [
        { editorId: "broken" as never, scope: "global" },
        { editorId: "codex" as never, scope: "global" },
      ],
    })

    expect(result.results).toEqual([
      {
        target: { editorId: "broken", scope: "global" },
        status: "failed",
        error: "install failed",
      },
      expect.objectContaining({
        target: { editorId: "codex", scope: "global" },
        status: "installed",
      }),
    ])
  })
})
