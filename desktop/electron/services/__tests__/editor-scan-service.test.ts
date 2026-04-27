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
import { prepareQuickPublishDraft } from "../editor-scan-service"

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
})
