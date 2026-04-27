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
      itemName: "Release Rule.md",
      content: [
        "---",
        "name: Release Rule",
        "title: Release Checklist",
        "description: Publishing checklist.",
        "category: workflow",
        "---",
        "",
        "# Release Rule",
        "",
        "Use this before publishing.",
        "",
        "More details.",
      ].join("\n"),
      metadata: {},
    }

    const payload = buildRuleQuickPublishPayload(draft)

    expect(payload).toMatchObject({
      name: "release-rule",
      title: "Release Checklist",
      description: "Publishing checklist.",
      category: "workflow",
      content: "# Release Rule\n\nUse this before publishing.\n\nMore details.",
    })
    expect(payload.icon).not.toBe("")
    expect(payload.iconBg).not.toBe("")
  })

  it("leaves category empty when the scanned category is unknown", () => {
    const draft: EditorScanQuickPublishDraft = {
      itemType: "rule",
      itemPath: "/repo/AGENTS.md",
      itemName: "Release Rule.md",
      content: [
        "---",
        "name: release-rule",
        "category: unknown-category",
        "---",
        "",
        "# Release Rule",
        "",
        "Use this before publishing.",
      ].join("\n"),
      metadata: {},
    }

    const payload = buildRuleQuickPublishPayload(draft)

    expect(payload.category).toBe("")
  })

  it("keeps auto-generated descriptions short", () => {
    const draft: EditorScanQuickPublishDraft = {
      itemType: "skill",
      itemPath: "/skills/release-helper",
      itemName: "release-helper",
      content: [
        "# Release Helper",
        "",
        "This paragraph is intentionally long enough to exceed the quick publish description limit because imported content often begins with implementation notes rather than a concise summary.",
      ].join("\n"),
      files: [],
      metadata: {},
    }

    const payload = buildSkillQuickPublishPayload(draft)

    expect(payload.description.length).toBeLessThanOrEqual(120)
    expect(payload.description).toMatch(/\.$/)
  })

  it("builds a skill create payload from frontmatter and keeps attachment bytes", async () => {
    const bytes = Uint8Array.from([1, 2, 3])
    const draft: EditorScanQuickPublishDraft = {
      itemType: "skill",
      itemPath: "/skills/release-helper",
      itemName: "release-helper",
      content: [
        "---",
        "name: Release Helper",
        "title: Release Helper",
        "description: Draft release notes.",
        "category: automation",
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
      category: "automation",
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
