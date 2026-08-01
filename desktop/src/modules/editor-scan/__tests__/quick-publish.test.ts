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

    const result = buildRuleQuickPublishPayload(draft)
    const { payload } = result

    expect(payload).toMatchObject({
      name: "release-rule",
      title: "Release Checklist",
      description: "Publishing checklist.",
      category: "workflow",
      content: "# Release Rule\n\nUse this before publishing.\n\nMore details.",
    })
    expect(payload.icon).not.toBe("")
    expect(payload.iconBg).not.toBe("")
    expect(result.notices).toEqual([])
  })

  it("leaves category empty and reports a notice when the scanned category is unknown", () => {
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

    const result = buildRuleQuickPublishPayload(draft)

    expect(result.payload.category).toBe("")
    expect(result.notices).toEqual([
      { id: "unknown-category", message: "未识别分类，已留空。" },
    ])
  })

  it("reports a notice when frontmatter contains unsupported lines", () => {
    const draft: EditorScanQuickPublishDraft = {
      itemType: "rule",
      itemPath: "/repo/AGENTS.md",
      itemName: "Release Rule.md",
      content: [
        "---",
        "name: release-rule",
        "tags:",
        "  - release",
        "---",
        "",
        "# Release Rule",
        "",
        "Use this before publishing.",
      ].join("\n"),
      metadata: {},
    }

    const result = buildRuleQuickPublishPayload(draft)

    expect(result.payload.name).toBe("release-rule")
    expect(result.notices).toEqual([
      { id: "frontmatter-partial", message: "元数据未完全识别，请检查已填内容。" },
    ])
  })

  it("reports a notice when frontmatter is not closed", () => {
    const draft: EditorScanQuickPublishDraft = {
      itemType: "rule",
      itemPath: "/repo/AGENTS.md",
      itemName: "Release Rule.md",
      content: [
        "---",
        "name: release-rule",
        "",
        "# Release Rule",
        "",
        "Use this before publishing.",
      ].join("\n"),
      metadata: {},
    }

    const result = buildRuleQuickPublishPayload(draft)

    expect(result.payload.name).toBe("release-rule")
    expect(result.notices).toEqual([
      { id: "frontmatter-partial", message: "元数据未完全识别，请检查已填内容。" },
    ])
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
      publishFingerprint: "sha256:publish",
      sourceFingerprint: "sha256:source",
      sourceImportSummary: {
        controlFilesExcluded: [],
        fileCount: 1,
        hiddenEntryCount: 0,
        runtimeEnvExcluded: false,
        symlinkCount: 0,
        totalBytes: 1,
      },
    }

    const { payload } = buildSkillQuickPublishPayload(draft)

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
      publishFingerprint: "sha256:publish",
      sourceFingerprint: "sha256:source",
      sourceImportSummary: {
        controlFilesExcluded: [],
        fileCount: 2,
        hiddenEntryCount: 0,
        runtimeEnvExcluded: false,
        symlinkCount: 0,
        totalBytes: 4,
      },
    }

    const result = buildSkillQuickPublishPayload(draft)
    const { payload } = result

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
    expect(result.notices).toEqual([])
  })

  it("formats compact source labels for local scan items", () => {
    expect(formatQuickPublishSourceLabel({
      editorLabel: "Codex",
      scope: "project",
      type: "rule",
    })).toBe("来自 Codex · 项目 Rule")

    expect(formatQuickPublishSourceLabel({
      editorLabel: "CC/Synapse",
      scope: "global",
      type: "skill",
    })).toBe("来自 CC/Synapse · 全局 Skill")
  })
})
