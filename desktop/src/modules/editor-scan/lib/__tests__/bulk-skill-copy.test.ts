import { describe, expect, it } from "vitest"
import {
  buildBulkSkillCopySummary,
  classifyBulkSkillCopyPreflight,
  createBulkSkillCopyPayload,
  type BulkSkillCopyResultItem,
} from "../bulk-skill-copy"
import { createCopySource, type EditorScanSkillCopyItem } from "../editor-copy-source"
import type { SynapseEditorResolvedTarget } from "@/types/editor"

function createItem(name: string): EditorScanSkillCopyItem {
  return {
    key: `global:/source/${name}`,
    name,
    path: `/source/${name}`,
    source: "external",
    preview: name,
    fileCount: 1,
    synapseContentId: null,
    editorId: "claude-code",
    editorLabel: "CC/Synapse",
    scope: "global",
    trash: { mode: "path" },
  }
}

function createReadyTarget(targetPath: string, targetExists: boolean): SynapseEditorResolvedTarget {
  return {
    contentType: "skill",
    editorId: "codex",
    label: "Codex",
    message: null,
    scope: "global",
    status: "ready",
    targetExists,
    targetKind: "directory",
    targetPath,
  }
}

describe("bulk skill copy helpers", () => {
  it("classifies ready targets without existing content", () => {
    const item = createItem("jenkins")
    const source = createCopySource(item)
    const result = classifyBulkSkillCopyPreflight(item, source, createReadyTarget("/target/jenkins", false))

    expect(result).toEqual({
      item,
      overwrite: false,
      source,
      status: "ready",
      targetPath: "/target/jenkins",
    })
  })

  it("classifies existing targets as overwrite", () => {
    const item = createItem("jenkins")
    const source = createCopySource(item)
    const result = classifyBulkSkillCopyPreflight(item, source, createReadyTarget("/target/jenkins", true))

    expect(result).toMatchObject({
      item,
      overwrite: true,
      status: "overwrite",
      targetPath: "/target/jenkins",
    })
  })

  it("classifies unavailable targets with a message", () => {
    const item = createItem("jenkins")
    const source = createCopySource(item)
    const result = classifyBulkSkillCopyPreflight(item, source, {
      contentType: "skill",
      editorId: "codex",
      label: "Codex",
      message: "目标位置与源位置相同",
      scope: "global",
      status: "unavailable",
      targetKind: null,
      targetPath: null,
    })

    expect(result).toEqual({
      item,
      message: "目标位置与源位置相同",
      source,
      status: "unavailable",
    })
  })

  it("creates copy payloads with overwrite confirmation only for overwrite items", () => {
    const item = createItem("jenkins")
    const source = createCopySource(item)
    const ready = classifyBulkSkillCopyPreflight(item, source, createReadyTarget("/target/jenkins", false))
    const overwrite = classifyBulkSkillCopyPreflight(item, source, createReadyTarget("/target/jenkins", true))

    if (ready.status !== "ready") throw new Error("Expected ready preflight item.")
    if (overwrite.status !== "overwrite") throw new Error("Expected overwrite preflight item.")

    expect(createBulkSkillCopyPayload(ready, "codex", "global")).toMatchObject({
      overwriteConfirmed: undefined,
      targetEditorId: "codex",
      targetScope: "global",
    })
    expect(createBulkSkillCopyPayload(overwrite, "codex", "project", "/repo")).toMatchObject({
      overwriteConfirmed: true,
      targetEditorId: "codex",
      targetProjectPath: "/repo",
      targetScope: "project",
    })
  })

  it("summarizes copied, failed, and skipped results", () => {
    const item = createItem("jenkins")
    const results: BulkSkillCopyResultItem[] = [
      { status: "copied", item, targetPath: "/target/a", overwritten: false },
      { status: "failed", item, message: "写入失败" },
      { status: "skipped", item, message: "不可用" },
    ]

    expect(buildBulkSkillCopySummary(results)).toEqual({
      copied: 1,
      failed: 1,
      skipped: 1,
      total: 3,
    })
  })
})
