import { describe, expect, it } from "vitest"

import { serializeCreateSkillFiles } from "@/modules/skills/utils"
import type { EditorScanQuickPublishDraft } from "@/types/editor-scan"
import {
  buildRuleQuickPublishPayload,
  buildSkillQuickPublishPayload,
  formatQuickPublishSourceLabel,
} from "../lib/quick-publish"

describe("quick publish payload builders", () => {
  it("builds a rule create payload from local rule content", () => {
    const draft: EditorScanQuickPublishDraft = {
      itemType: "rule",
      itemPath: "/repo/AGENTS.md",
      itemName: "Release-Rule.md",
      content: "# Release Rule\n\nUse this before publishing.\n\nMore details.",
      metadata: { description: "Publishing checklist." },
    }

    const payload = buildRuleQuickPublishPayload(draft)

    expect(payload).toMatchObject({
      name: "release-rule",
      title: "Release Rule",
      description: "Publishing checklist.",
      category: "",
      content: draft.content,
    })
    expect(payload.icon).not.toBe("")
    expect(payload.iconBg).not.toBe("")
  })

  it("builds a skill create payload from frontmatter and keeps attachment bytes", async () => {
    const bytes = Uint8Array.from([1, 2, 3])
    const draft: EditorScanQuickPublishDraft = {
      itemType: "skill",
      itemPath: "/skills/release-helper",
      itemName: "release-helper",
      content: [
        "---",
        "name: release-helper",
        "title: Release Helper",
        "description: Draft release notes.",
        "---",
        "",
        "# Usage",
        "",
        "Run the checklist.",
      ].join("\n"),
      files: [{ originalName: "assets/template.bin", size: 3, bytes }],
      metadata: {},
    }

    const payload = buildSkillQuickPublishPayload(draft)

    expect(payload).toMatchObject({
      name: "release-helper",
      title: "Release Helper",
      description: "Draft release notes.",
      category: "",
      content: "# Usage\n\nRun the checklist.",
    })
    expect(payload.files).toHaveLength(1)
    expect(payload.files[0]?.bytes).toBe(bytes)

    await expect(serializeCreateSkillFiles(payload.files)).resolves.toEqual([
      { originalName: "assets/template.bin", size: 3, bytes },
    ])
  })

  it("formats compact source labels for local scan items", () => {
    expect(formatQuickPublishSourceLabel({
      editorLabel: "Codex",
      scope: "project",
      type: "rule",
    })).toBe("来自 Codex · 项目 Rule")

    expect(formatQuickPublishSourceLabel({
      editorLabel: "Claude Code",
      scope: "global",
      type: "skill",
    })).toBe("来自 Claude Code · 全局 Skill")
  })
})
