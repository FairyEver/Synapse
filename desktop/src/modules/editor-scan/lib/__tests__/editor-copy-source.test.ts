import { describe, expect, it } from "vitest"
import { createCopySource, type EditorScanSkillCopyItem } from "../editor-copy-source"
import type { ScanItemForDetail } from "@/types/editor-scan"

describe("createCopySource", () => {
  it("builds a Skill copy source without rule content", () => {
    const item: ScanItemForDetail = {
      type: "skill",
      name: "bark-notification",
      path: "/Users/test/.claude/skills/bark-notification",
      source: "external",
      preview: "Send Bark notifications.",
      fileCount: 3,
      synapseContentId: null,
      editorId: "claude-code",
      editorLabel: "CC/Synapse",
      scope: "global",
      trash: { mode: "path" },
    }

    expect(createCopySource(item, "ignored content")).toEqual({
      content: undefined,
      editorId: "claude-code",
      itemName: "bark-notification",
      itemPath: "/Users/test/.claude/skills/bark-notification",
      itemType: "skill",
      metadata: undefined,
      scope: "global",
      synapseContentId: null,
    })
  })

  it("builds a Rule copy source with content and metadata", () => {
    const item: ScanItemForDetail = {
      type: "rule",
      name: "review-rule",
      path: "/repo/.cursor/rules/review-rule.mdc",
      source: "external",
      preview: "Review carefully.",
      metadata: { description: "Review" },
      synapseContentId: "rule-1",
      editorId: "cursor",
      editorLabel: "Cursor",
      scope: "project",
      projectName: "repo",
      projectPath: "/repo",
      content: "Review carefully.",
      trash: { mode: "path" },
    }

    expect(createCopySource(item, "Loaded body")).toEqual({
      content: "Loaded body",
      editorId: "cursor",
      itemName: "review-rule",
      itemPath: "/repo/.cursor/rules/review-rule.mdc",
      itemType: "rule",
      metadata: { description: "Review" },
      scope: "project",
      synapseContentId: "rule-1",
    })
  })

  it("builds a Skill copy source from bulk list items", () => {
    const item: EditorScanSkillCopyItem = {
      key: "global:/Users/test/.claude/skills/jenkins",
      name: "jenkins",
      path: "/Users/test/.claude/skills/jenkins",
      source: "external",
      preview: "Operate Jenkins.",
      fileCount: 2,
      synapseContentId: null,
      editorId: "claude-code",
      editorLabel: "CC/Synapse",
      scope: "global",
      trash: { mode: "path" },
    }

    expect(createCopySource(item)).toMatchObject({
      content: undefined,
      itemName: "jenkins",
      itemType: "skill",
      scope: "global",
    })
  })
})
