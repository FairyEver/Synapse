import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises"
import os from "node:os"
import path from "node:path"
import { afterEach, describe, expect, it } from "vitest"
import { InstallerSourceService } from "../installer-source-service"

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
