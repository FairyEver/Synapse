import { mkdtemp, rm, writeFile, mkdir, symlink } from "node:fs/promises"
import os from "node:os"
import path from "node:path"
import { afterEach, describe, expect, it, vi } from "vitest"

vi.mock("electron", () => ({
  app: {
    getPath: (which: string) => `/tmp/synapse-editor-scan-test-${which}`,
    getName: () => "synapse-test",
    getVersion: () => "0.0.0-test",
    isPackaged: false,
  },
}))

import { scanCodexRules, scanCursorRules } from "../../../src/ide-definitions/shared-rule-scanners"
import {
  buildRuleQuickPublishPayload,
  buildSkillQuickPublishPayload,
} from "../../../src/modules/editor-scan/lib/quick-publish"
import { prepareQuickPublishDraft, scanSkillDirectories } from "../editor-scan-service"

const tempDirs: string[] = []

async function createTempDir(): Promise<string> {
  const dir = await mkdtemp(path.join(os.tmpdir(), "synapse-editor-scan-"))
  tempDirs.push(dir)
  return dir
}

afterEach(async () => {
  await Promise.all(tempDirs.splice(0).map((dir) => rm(dir, { recursive: true, force: true })))
})

describe("editor scan quick publish", () => {
  it("merges Codex global skill directories and keeps the primary copy for duplicate names", async () => {
    const root = await createTempDir()
    const primaryDir = path.join(root, ".agents", "skills")
    const compatDir = path.join(root, ".codex", "skills")
    await mkdir(path.join(primaryDir, "reviewer"), { recursive: true })
    await mkdir(path.join(compatDir, "reviewer"), { recursive: true })
    await mkdir(path.join(compatDir, "legacy"), { recursive: true })
    await writeFile(path.join(primaryDir, "reviewer", "SKILL.md"), "# Primary Reviewer\n")
    await writeFile(path.join(compatDir, "reviewer", "SKILL.md"), "# Legacy Reviewer\n")
    await writeFile(path.join(compatDir, "legacy", "SKILL.md"), "# Legacy\n")

    const result = await scanSkillDirectories([primaryDir, compatDir])

    expect(result.skills.map((skill) => skill.name)).toEqual(["reviewer", "legacy"])
    expect(result.skills.find((skill) => skill.name === "reviewer")?.path).toBe(path.join(primaryDir, "reviewer"))
    expect(result.duplicateSkillNames).toEqual(["reviewer"])
  })

  it("creates a skill draft with nested binary attachments from the scan scope", async () => {
    const root = await createTempDir()
    const skillDir = path.join(root, "release-helper")
    await mkdir(path.join(skillDir, "bin"), { recursive: true })
    await writeFile(path.join(skillDir, "SKILL.md"), "---\nname: release-helper\n---\n# Release Helper\n")
    await writeFile(path.join(skillDir, ".synapse.json"), "{\"id\":\"skill-1\"}")
    await writeFile(path.join(skillDir, ".secret"), "hidden")
    await writeFile(path.join(skillDir, "notes.txt"), "notes")
    await writeFile(path.join(skillDir, "bin", "tool.dat"), Uint8Array.from([0, 255, 42]))

    const draft = await prepareQuickPublishDraft({
      itemType: "skill",
      itemPath: skillDir,
      itemName: "release-helper",
      metadata: {},
    })

    expect(draft.itemType).toBe("skill")
    if (draft.itemType !== "skill") return

    expect(draft.content).toContain("# Release Helper")
    expect(draft.files.map((file) => file.originalName)).toEqual([
      "bin/tool.dat",
      "notes.txt",
    ])
    expect(Array.from(draft.files[0]?.bytes ?? [])).toEqual([0, 255, 42])
    expect(draft.files.some((file) => file.originalName.includes(".synapse.json"))).toBe(false)
    expect(draft.files.some((file) => file.originalName.includes(".secret"))).toBe(false)
  })

  it("runs manual quick-publish fixtures through scan and import payload builders", async () => {
    const root = await createTempDir()
    const rulesPath = path.join(root, "AGENTS.md")
    const skillsPath = path.join(root, ".agents", "skills")
    const normalSkillDir = path.join(skillsPath, "normal-import-skill")
    const unknownSkillDir = path.join(skillsPath, "unknown-category-skill")
    const partialSkillDir = path.join(skillsPath, "partial-frontmatter-skill")

    await mkdir(path.join(normalSkillDir, "assets"), { recursive: true })
    await mkdir(unknownSkillDir, { recursive: true })
    await mkdir(partialSkillDir, { recursive: true })
    await writeFile(
      rulesPath,
      [
        "<!-- synapse-rule:unknown-category-rule:begin -->",
        "---",
        "name: unknown-category-rule",
        "category: category-that-does-not-exist",
        "---",
        "",
        "# Unknown Category Rule",
        "",
        "Use this rule to verify the unknown category notice.",
        "<!-- synapse-rule:unknown-category-rule:end -->",
        "<!-- synapse-rule:partial-frontmatter-rule:begin -->",
        "---",
        "name: partial-frontmatter-rule",
        "tags:",
        "  - manual-test",
        "---",
        "",
        "# Partial Frontmatter Rule",
        "",
        "Use this rule to verify the partial frontmatter notice.",
        "<!-- synapse-rule:partial-frontmatter-rule:end -->",
      ].join("\n"),
    )
    await writeFile(
      path.join(normalSkillDir, "SKILL.md"),
      [
        "---",
        "name: normal-import-skill",
        "title: Normal Import Skill",
        "description: Normal skill import case.",
        "category: automation",
        "---",
        "",
        "# Normal Import Skill",
        "",
        "Use this skill to verify the import flow and attachment transfer.",
      ].join("\n"),
    )
    await writeFile(path.join(normalSkillDir, "assets", "template.txt"), "attachment")
    await writeFile(
      path.join(unknownSkillDir, "SKILL.md"),
      [
        "---",
        "name: unknown-category-skill",
        "category: category-that-does-not-exist",
        "---",
        "",
        "# Unknown Category Skill",
      ].join("\n"),
    )
    await writeFile(
      path.join(partialSkillDir, "SKILL.md"),
      [
        "---",
        "name: partial-frontmatter-skill",
        "tags:",
        "  - manual-test",
        "---",
        "",
        "# Partial Frontmatter Skill",
      ].join("\n"),
    )

    const rules = await scanCodexRules(rulesPath)
    const unknownRule = rules.find((rule) => rule.name === "unknown-category-rule")
    const partialRule = rules.find((rule) => rule.name === "partial-frontmatter-rule")

    expect(buildRuleQuickPublishPayload({
      itemType: "rule",
      itemPath: rulesPath,
      itemName: unknownRule?.name ?? "",
      content: unknownRule?.content ?? "",
      metadata: unknownRule?.metadata ?? {},
    }).notices).toEqual([
      { id: "unknown-category", message: "未识别分类，已留空。" },
    ])
    expect(buildRuleQuickPublishPayload({
      itemType: "rule",
      itemPath: rulesPath,
      itemName: partialRule?.name ?? "",
      content: partialRule?.content ?? "",
      metadata: partialRule?.metadata ?? {},
    }).notices).toEqual([
      { id: "frontmatter-partial", message: "元数据未完全识别，请检查已填内容。" },
    ])

    const skillScan = await scanSkillDirectories([skillsPath])
    expect(skillScan.skills.map((skill) => skill.name).sort()).toEqual([
      "normal-import-skill",
      "partial-frontmatter-skill",
      "unknown-category-skill",
    ])

    const normalSkillDraft = await prepareQuickPublishDraft({
      itemType: "skill",
      itemPath: normalSkillDir,
      itemName: "normal-import-skill",
      metadata: {},
    })
    expect(normalSkillDraft.itemType).toBe("skill")
    if (normalSkillDraft.itemType !== "skill") return
    const normalSkillResult = buildSkillQuickPublishPayload(normalSkillDraft)
    expect(normalSkillResult.notices).toEqual([])
    expect(normalSkillResult.payload.files.map((file) => file.originalName)).toEqual(["assets/template.txt"])

    const unknownSkillDraft = await prepareQuickPublishDraft({
      itemType: "skill",
      itemPath: unknownSkillDir,
      itemName: "unknown-category-skill",
      metadata: {},
    })
    expect(unknownSkillDraft.itemType).toBe("skill")
    if (unknownSkillDraft.itemType !== "skill") return
    expect(buildSkillQuickPublishPayload(unknownSkillDraft).notices).toEqual([
      { id: "unknown-category", message: "未识别分类，已留空。" },
    ])

    const partialSkillDraft = await prepareQuickPublishDraft({
      itemType: "skill",
      itemPath: partialSkillDir,
      itemName: "partial-frontmatter-skill",
      metadata: {},
    })
    expect(partialSkillDraft.itemType).toBe("skill")
    if (partialSkillDraft.itemType !== "skill") return
    expect(buildSkillQuickPublishPayload(partialSkillDraft).notices).toEqual([
      { id: "frontmatter-partial", message: "元数据未完全识别，请检查已填内容。" },
    ])
  })

  it("uses skill frontmatter description as the list preview", async () => {
    const root = await createTempDir()
    const skillDir = path.join(root, "pagespy-log-reader")
    const description = "Read, decode, and summarize PageSpy/o-spy frontend log JSON exports. Use this skill whenever the user mentions PageSpy, o-spy, pagespy.huolala.cn, page-spy-web, rrweb-event, frontend log JSON, web session replay logs, or asks AI to understand a PageSpy exported .json file. This skill helps decode zlib-compressed entries, separate console/network/storage/system/meta/rrweb events, identify user actions, API failures, sensitive tokens, and produce a concise debugging summary."
    await mkdir(skillDir, { recursive: true })
    await writeFile(
      path.join(skillDir, "SKILL.md"),
      [
        "---",
        "name: pagespy-log-reader",
        `description: ${description}`,
        "---",
        "",
        "# PageSpy Log Reader",
        "",
        "## Purpose",
      ].join("\n"),
    )

    const result = await scanSkillDirectories([root])

    expect(result.skills[0]?.preview).toBe(description)
  })

  it("uses ruleContent when preparing a rule draft", async () => {
    const root = await createTempDir()
    const filePath = path.join(root, "AGENTS.md")
    await writeFile(filePath, "# Whole File\n\nThis should not be published.")

    const draft = await prepareQuickPublishDraft({
      itemType: "rule",
      itemPath: filePath,
      itemName: "release-rule",
      ruleContent: "# Release Rule\n\nPublish this block.",
      metadata: { name: "release-rule" },
    })

    expect(draft).toEqual({
      itemType: "rule",
      itemPath: filePath,
      itemName: "release-rule",
      content: "# Release Rule\n\nPublish this block.",
      metadata: { name: "release-rule" },
    })
  })

  it("rejects oversized skill attachments before reading them into the draft", async () => {
    const root = await createTempDir()
    const skillDir = path.join(root, "release-helper")
    await mkdir(skillDir, { recursive: true })
    await writeFile(path.join(skillDir, "SKILL.md"), "# Release Helper\n")
    await writeFile(path.join(skillDir, "large.bin"), new Uint8Array((10 * 1024 * 1024) + 1))

    await expect(prepareQuickPublishDraft({
      itemType: "skill",
      itemPath: skillDir,
      itemName: "release-helper",
      metadata: {},
    })).rejects.toThrow("超过 10MB")
  })

  it("rejects sensitive skill attachment names before creating a draft", async () => {
    const root = await createTempDir()
    const skillDir = path.join(root, "release-helper")
    await mkdir(skillDir, { recursive: true })
    await writeFile(path.join(skillDir, "SKILL.md"), "# Release Helper\n")
    await writeFile(path.join(skillDir, "id_rsa"), "private key")

    await expect(prepareQuickPublishDraft({
      itemType: "skill",
      itemPath: skillDir,
      itemName: "release-helper",
      metadata: {},
    })).rejects.toThrow("敏感文件")
  })

  it("skips symlinked files when preparing a skill draft", async () => {
    const root = await createTempDir()
    const skillDir = path.join(root, "release-helper")
    const outsideFilePath = path.join(root, "secret.txt")
    await mkdir(skillDir, { recursive: true })
    await writeFile(path.join(skillDir, "SKILL.md"), "# Release Helper\n")
    await writeFile(path.join(skillDir, "notes.txt"), "notes")
    await writeFile(outsideFilePath, "secret")
    await symlink(outsideFilePath, path.join(skillDir, "linked-secret.txt"))

    const draft = await prepareQuickPublishDraft({
      itemType: "skill",
      itemPath: skillDir,
      itemName: "release-helper",
      metadata: {},
    })

    expect(draft.itemType).toBe("skill")
    if (draft.itemType !== "skill") return
    expect(draft.files.map((file) => file.originalName)).toEqual(["notes.txt"])
  })

  it("keeps the exact content for each Codex rule segment", async () => {
    const root = await createTempDir()
    const filePath = path.join(root, "AGENTS.md")
    await writeFile(
      filePath,
      [
        "<!-- synapse-rule:first:begin -->",
        "# First",
        "",
        "Only first.",
        "<!-- synapse-rule:first:end -->",
        "<!-- synapse-rule:second:begin -->",
        "# Second",
        "",
        "Only second.",
        "<!-- synapse-rule:second:end -->",
      ].join("\n"),
    )

    const items = await scanCodexRules(filePath)

    expect(items.find((item) => item.name === "first")?.content).toBe("# First\n\nOnly first.")
    expect(items.find((item) => item.name === "second")?.content).toBe("# Second\n\nOnly second.")
  })

  it("scans Codex rule segments for builtin rules with file-name-safe IDs", async () => {
    const root = await createTempDir()
    const filePath = path.join(root, "AGENTS.md")
    await writeFile(
      filePath,
      [
        "<!-- synapse-rule:builtin__rule__data-store-shortcut:begin -->",
        "Use sss.",
        "<!-- synapse-rule:builtin__rule__data-store-shortcut:end -->",
      ].join("\n"),
    )

    const items = await scanCodexRules(filePath)

    expect(items).toHaveLength(1)
    expect(items[0]).toMatchObject({
      name: "builtin__rule__data-store-shortcut",
      source: "synapse",
      synapseContentId: "builtin__rule__data-store-shortcut",
      content: "Use sss.",
    })
  })

  it("recognizes Cursor rules installed from Synapse by file name", async () => {
    const root = await createTempDir()
    const contentId = "abc123"
    await writeFile(
      path.join(root, `synapse_${contentId}.mdc`),
      "---\ndescription: Project rule\n---\n# Rule\n",
    )

    const items = await scanCursorRules(root)

    expect(items).toHaveLength(1)
    expect(items[0]).toMatchObject({
      source: "synapse",
      synapseContentId: contentId,
    })
  })

  it("uses rule frontmatter description as the list preview", async () => {
    const root = await createTempDir()
    await writeFile(
      path.join(root, "project.mdc"),
      "---\ndescription: Project rule summary\n---\n# Rule\n\nKeep this in the detail body.",
    )

    const items = await scanCursorRules(root)

    expect(items[0]?.preview).toBe("Project rule summary")
  })
})
