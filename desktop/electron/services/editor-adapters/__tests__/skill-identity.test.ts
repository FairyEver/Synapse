import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises"
import os from "node:os"
import path from "node:path"
import { afterEach, describe, expect, it, vi } from "vitest"
import { checkSkillNameConflict, resolveSkillTargetPath, SYNAPSE_SKILL_ID_FILE_NAME } from "../skill-identity"

const tempDirs: string[] = []

async function createTempDir(): Promise<string> {
  const dir = await mkdtemp(path.join(os.tmpdir(), "synapse-skill-identity-"))
  tempDirs.push(dir)
  return dir
}

afterEach(async () => {
  vi.restoreAllMocks()
  await Promise.all(tempDirs.splice(0).map((dir) => rm(dir, { recursive: true, force: true })))
})

describe("checkSkillNameConflict", () => {
  it("treats a corrupt skill identity file as a controlled target conflict", async () => {
    const parentDirectoryPath = await createTempDir()
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
    const parentDirectoryPath = await createTempDir()
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
})

describe("resolveSkillTargetPath", () => {
  it("keeps the existing Skill directory when Windows paths differ only by case", async () => {
    vi.spyOn(process, "platform", "get").mockReturnValue("win32")
    const parentDirectoryPath = await createTempDir()
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
