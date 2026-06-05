import { describe, expect, it } from "vitest"
import {
  buildBulkSkillTrashSummary,
  createBulkSkillTrashRequest,
  type BulkSkillTrashResultItem,
} from "../bulk-skill-trash"
import type { EditorScanSkillCopyItem } from "../editor-copy-source"

function createItem(name: string): EditorScanSkillCopyItem {
  return {
    key: `project:/repo:/source/${name}`,
    name,
    path: `/source/${name}`,
    source: "external",
    preview: name,
    fileCount: 1,
    synapseContentId: null,
    editorId: "claude-code",
    editorLabel: "ClaudeCode/Synapse",
    scope: "project",
    projectName: "Repo",
    projectPath: "/repo",
    trash: { mode: "path" },
  }
}

describe("bulk skill trash helpers", () => {
  it("creates a trash request from a selected Skill", () => {
    const item = createItem("jenkins")

    expect(createBulkSkillTrashRequest(item)).toEqual({
      itemType: "skill",
      itemName: "jenkins",
      itemPath: "/source/jenkins",
      editorId: "claude-code",
      scope: "project",
      source: "external",
      trash: { mode: "path" },
      synapseContentId: null,
    })
  })

  it("summarizes trashed and failed results", () => {
    const item = createItem("jenkins")
    const results: BulkSkillTrashResultItem[] = [
      { status: "trashed", item, path: "/source/jenkins" },
      { status: "failed", item, message: "移到废纸篓失败" },
    ]

    expect(buildBulkSkillTrashSummary(results)).toEqual({
      failed: 1,
      total: 2,
      trashed: 1,
    })
  })
})
