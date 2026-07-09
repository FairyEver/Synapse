import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises"
import os from "node:os"
import path from "node:path"
import { afterEach, describe, expect, it, vi } from "vitest"
import {
  checkSkillNameConflict,
  findSkillDirectoryByContentId,
  resolveSkillTargetPath,
  SYNAPSE_SKILL_ID_FILE_NAME,
} from "../skill-identity"

const tempRoots: string[] = []

async function createSkillDirectoryWithId(parentPath: string, name: string, id: string): Promise<string> {
  const skillPath = path.join(parentPath, name)
  await mkdir(skillPath, { recursive: true })
  await writeFile(path.join(skillPath, ".synapse.json"), JSON.stringify({ id }), "utf8")
  return skillPath
}

async function createTempRoot(): Promise<string> {
  const root = await mkdtemp(path.join(os.tmpdir(), "synapse-skill-identity-"))
  tempRoots.push(root)
  return root
}

afterEach(async () => {
  vi.restoreAllMocks()
  await Promise.all(tempRoots.splice(0).map((root) => rm(root, { force: true, recursive: true })))
})

describe("checkSkillNameConflict", () => {
  it("treats a corrupt skill identity file as a controlled target conflict", async () => {
    const parentDirectoryPath = await createTempRoot()
    const skillDirectoryPath = path.join(parentDirectoryPath, "review-helper")
    await mkdir(skillDirectoryPath, { recursive: true })
    await writeFile(path.join(skillDirectoryPath, SYNAPSE_SKILL_ID_FILE_NAME), "{bad json")

    const result = await checkSkillNameConflict(parentDirectoryPath, "review-helper", "skill-1")

    expect(result).toEqual({
      hasConflict: true,
      existingContentId: "unknown",
      existingPath: skillDirectoryPath,
    })
  })

  it("treats an invalid skill id as a controlled target conflict", async () => {
    const parentDirectoryPath = await createTempRoot()
    const skillDirectoryPath = path.join(parentDirectoryPath, "review-helper")
    await mkdir(skillDirectoryPath, { recursive: true })
    await writeFile(path.join(skillDirectoryPath, SYNAPSE_SKILL_ID_FILE_NAME), JSON.stringify({ id: 42 }))

    const result = await checkSkillNameConflict(parentDirectoryPath, "review-helper", "skill-1")

    expect(result).toEqual({
      hasConflict: true,
      existingContentId: "unknown",
      existingPath: skillDirectoryPath,
    })
  })

  it("treats the built-in Synapse Skill legacy id as the current Synapse Skill id", async () => {
    const root = await createTempRoot()
    await createSkillDirectoryWithId(root, "synapse-skill", "builtin__skill__synapse-skill")

    await expect(findSkillDirectoryByContentId(root, "synapse-skill"))
      .resolves.toBe(path.join(root, "synapse-skill"))
    await expect(checkSkillNameConflict(root, "synapse-skill", "synapse-skill"))
      .resolves.toEqual({ hasConflict: false, ownedTargetExists: true, targetExists: true })
  })

  it("keeps unrelated same-name Skill directories as conflicts", async () => {
    const root = await createTempRoot()
    await createSkillDirectoryWithId(root, "synapse-skill", "another-skill")

    await expect(checkSkillNameConflict(root, "synapse-skill", "synapse-skill"))
      .resolves.toEqual({
        existingContentId: "another-skill",
        existingPath: path.join(root, "synapse-skill"),
        hasConflict: true,
      })
  })
})

describe("resolveSkillTargetPath", () => {
  it("keeps the existing Skill directory when Windows paths differ only by case", async () => {
    vi.spyOn(process, "platform", "get").mockReturnValue("win32")
    const parentDirectoryPath = await createTempRoot()
    const skillDirectoryPath = path.join(parentDirectoryPath, "ReviewHelper")
    await mkdir(skillDirectoryPath, { recursive: true })
    await writeFile(path.join(skillDirectoryPath, SYNAPSE_SKILL_ID_FILE_NAME), JSON.stringify({ id: "skill-1" }))

    await expect(resolveSkillTargetPath({
      parentDirectoryPath,
      contentId: "skill-1",
      slug: "reviewhelper",
    })).resolves.toBe(skillDirectoryPath)
  })
})
