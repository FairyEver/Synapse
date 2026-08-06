import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises"
import os from "node:os"
import path from "node:path"
import { afterEach, describe, expect, it, vi } from "vitest"

import { workbuddyAdapter } from "../adapter"

const tempRoots: string[] = []

async function createTempHome(): Promise<string> {
  const root = await mkdtemp(path.join(os.tmpdir(), "synapse-workbuddy-adapter-"))
  tempRoots.push(root)
  vi.spyOn(os, "homedir").mockReturnValue(root)
  return root
}

const skillContext = {
  contentId: "workbuddy-skill",
  contentType: "skill" as const,
  skillName: "workbuddy-skill",
  skillTitle: "WorkBuddy Skill",
}

afterEach(async () => {
  vi.restoreAllMocks()
  await Promise.all(tempRoots.splice(0).map((root) => rm(root, { force: true, recursive: true })))
})

describe("WorkBuddy editor adapter", () => {
  it("resolves the default global Skill directory", async () => {
    const home = await createTempHome()

    expect(workbuddyAdapter.resolveGlobalDirectoryPaths()).toEqual({
      rulesPath: null,
      skillsPath: path.join(home, ".workbuddy", "skills"),
    })
    expect(workbuddyAdapter.getScanPathConfig()).toMatchObject({
      globalRulesPath: null,
      globalSkillsPath: path.join(home, ".workbuddy", "skills"),
      rulesSupported: false,
      detectionDir: path.join(home, ".workbuddy"),
    })
  })

  it("reports a missing WorkBuddy user directory as unavailable", async () => {
    await createTempHome()

    await expect(workbuddyAdapter.resolveGlobalTarget(skillContext)).resolves.toMatchObject({
      status: "unavailable",
      targetPath: null,
    })
  })

  it("resolves fresh and Synapse-owned global Skills", async () => {
    const home = await createTempHome()
    const workbuddyHome = path.join(home, ".workbuddy")
    const targetPath = path.join(workbuddyHome, "skills", "workbuddy-skill")
    await mkdir(workbuddyHome, { recursive: true })

    await expect(workbuddyAdapter.resolveGlobalTarget(skillContext)).resolves.toMatchObject({
      status: "ready",
      targetPath,
      targetExists: false,
    })

    await mkdir(targetPath, { recursive: true })
    await writeFile(path.join(targetPath, ".synapse.json"), JSON.stringify({ id: "workbuddy-skill" }))

    await expect(workbuddyAdapter.resolveGlobalTarget(skillContext)).resolves.toMatchObject({
      status: "ready",
      targetPath,
      targetExists: true,
      ownedTargetExists: true,
    })
  })

  it("reports an external same-name global Skill as a conflict", async () => {
    const home = await createTempHome()
    const targetPath = path.join(home, ".workbuddy", "skills", "workbuddy-skill")
    await mkdir(targetPath, { recursive: true })
    await writeFile(path.join(targetPath, "SKILL.md"), "# External Skill\n")

    await expect(workbuddyAdapter.resolveGlobalTarget(skillContext)).resolves.toMatchObject({
      status: "conflict",
      targetPath,
      conflictContentId: "unknown",
    })
  })

  it("resolves project Skills only when the project exists", async () => {
    const home = await createTempHome()
    const projectPath = path.join(home, "project")

    await expect(workbuddyAdapter.resolveProjectTarget(projectPath, skillContext)).resolves.toMatchObject({
      status: "unavailable",
      targetPath: null,
    })

    await mkdir(projectPath)

    await expect(workbuddyAdapter.resolveProjectTarget(projectPath, skillContext)).resolves.toMatchObject({
      status: "ready",
      targetPath: path.join(projectPath, ".workbuddy", "skills", "workbuddy-skill"),
      targetExists: false,
    })
  })

  it("rejects unsupported content types", async () => {
    await createTempHome()

    await expect(workbuddyAdapter.resolveGlobalTarget({
      contentId: "rule-id",
      contentType: "rule",
    })).rejects.toThrow("WorkBuddy 暂不支持 rule 类型。")
  })
})
