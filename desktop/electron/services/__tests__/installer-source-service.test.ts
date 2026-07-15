import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises"
import os from "node:os"
import path from "node:path"
import { afterEach, describe, expect, it } from "vitest"
import { InstallerSourceService } from "../installer-source-service"
import { SKILL_RUNTIME_ENV_MAX_BYTES } from "../skill-env/file-policy"

const tempRoots: string[] = []

async function createTempDir(): Promise<string> {
  const root = await mkdtemp(path.join(os.tmpdir(), "synapse-installer-source-"))
  tempRoots.push(root)
  return root
}

afterEach(async () => {
  await Promise.all(tempRoots.splice(0).map((root) => rm(root, { force: true, recursive: true })))
})

describe("InstallerSourceService", () => {
  it("prepares a local Skill source from a root SKILL.md", async () => {
    const root = await createTempDir()
    await mkdir(path.join(root, "references"))
    await writeFile(path.join(root, "SKILL.md"), [
      "---",
      "name: release-helper",
      "description: Release checks",
      "---",
      "",
      "# Release Helper",
      "",
    ].join("\n"), "utf8")
    await writeFile(path.join(root, "references", "notes.md"), "# Notes\n", "utf8")

    const service = new InstallerSourceService()
    const source = await service.prepareLocalSkillSource({ sourceDirectoryPath: root })

    expect(source.kind).toBe("skill")
    expect(source.origin).toBe("local-directory")
    expect(source.name).toBe("release-helper")
    expect(source.description).toBe("Release checks")
    expect(source.sourceIdentity).toMatch(/^local-skill:[a-f0-9]{64}$/)
    expect(source.localSourceId).toBeTruthy()
  })

  it("includes a root .env.example in the local Skill draft", async () => {
    const root = await createTempDir()
    await writeFile(path.join(root, "SKILL.md"), "# Skill\n", "utf8")
    await writeFile(path.join(root, ".env.example"), "TOKEN=default\n", "utf8")

    const service = new InstallerSourceService()
    const source = await service.prepareLocalSkillSource({ sourceDirectoryPath: root })
    const stored = service.getLocalSkill(source.localSourceId!)

    expect(stored.draft.files.map((file) => file.originalName)).toContain(".env.example")
    await expect(service.readLocalSkillAttachmentText(source, ".env.example"))
      .resolves.toBe("TOKEN=default\n")
    await expect(service.readLocalSkillAttachmentText(source, "missing.txt"))
      .resolves.toBeNull()
  })

  it("rejects an oversized local .env.example before UTF-8 conversion", async () => {
    const root = await createTempDir()
    await writeFile(path.join(root, "SKILL.md"), "# Skill\n", "utf8")
    await writeFile(
      path.join(root, ".env.example"),
      "x".repeat(Number(SKILL_RUNTIME_ENV_MAX_BYTES) + 1),
      "utf8",
    )

    const service = new InstallerSourceService()
    const source = await service.prepareLocalSkillSource({ sourceDirectoryPath: root })

    await expect(service.readLocalSkillAttachmentText(source, ".env.example"))
      .rejects.toThrow("Skill .env 不能超过 1 MiB。")
  })

  it("rejects a local Skill source containing a root .env", async () => {
    const root = await createTempDir()
    await writeFile(path.join(root, "SKILL.md"), "# Skill\n", "utf8")
    await writeFile(path.join(root, ".env"), "TOKEN=secret\n", "utf8")

    const service = new InstallerSourceService()

    await expect(service.prepareLocalSkillSource({ sourceDirectoryPath: root }))
      .rejects.toThrow("Skill 源目录不能包含 .env，请只提交 .env.example。")
  })

  it("rejects local Skill directories without root SKILL.md", async () => {
    const root = await createTempDir()
    await writeFile(path.join(root, "README.md"), "# Readme only\n", "utf8")

    const service = new InstallerSourceService()

    await expect(service.prepareLocalSkillSource({ sourceDirectoryPath: root }))
      .rejects.toThrow("Skill 安装器需要根目录 SKILL.md。")
  })

  it("prepares an inline Rule source with normalized name", async () => {
    const service = new InstallerSourceService()
    const source = await service.prepareInlineRuleSource({
      name: "Team.Rule",
      body: "# Team Rule\nUse project conventions.",
    })

    expect(source.kind).toBe("rule")
    expect(source.origin).toBe("inline")
    expect(source.name).toBe("team.rule")
    expect(source.body).toBe("# Team Rule\nUse project conventions.")
    expect(source.sourceIdentity).toMatch(/^inline-rule:[a-f0-9]{64}$/)
    expect(source.inlineSourceId).toBeTruthy()
  })

  it("rejects invalid inline Rule names", async () => {
    const service = new InstallerSourceService()

    await expect(service.prepareInlineRuleSource({
      name: "Bad Name",
      body: "# Body",
    })).rejects.toThrow("只能使用小写字母、数字、连字符、点号；首尾必须是字母或数字。")
  })

  it("rejects empty inline Rule body", async () => {
    const service = new InstallerSourceService()

    await expect(service.prepareInlineRuleSource({
      name: "team.rule",
      body: "   ",
    })).rejects.toThrow("Rule 正文不能为空。")
  })
})
