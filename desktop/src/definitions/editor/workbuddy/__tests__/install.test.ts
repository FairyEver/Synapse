import { mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises"
import os from "node:os"
import path from "node:path"
import { afterEach, describe, expect, it } from "vitest"

import type { PrepareSkillDirectoryContext } from "../../../main-types"
import { installStrategy } from "../install"
import { scanStrategy } from "../scan"

const tempRoots: string[] = []

afterEach(async () => {
  await Promise.all(tempRoots.splice(0).map((root) => rm(root, { force: true, recursive: true })))
})

describe("WorkBuddy Skill installation", () => {
  it("writes a WorkBuddy-compatible Skill directory", async () => {
    const root = await mkdtemp(path.join(os.tmpdir(), "synapse-workbuddy-install-"))
    tempRoots.push(root)
    const stagingDirectoryPath = path.join(root, "staging")
    await mkdir(stagingDirectoryPath)
    const context: PrepareSkillDirectoryContext = {
      copyAttachment: async (attachment, targetPath) => {
        await mkdir(path.dirname(targetPath), { recursive: true })
        await writeFile(targetPath, attachment.originalName === "scripts/run.js" ? "export {}\n" : "", "utf8")
      },
      detail: {
        attachmentCount: 1,
        attachments: [
          { originalName: "scripts/run.js", sha256: "a".repeat(64), size: 10 },
        ],
        category: "general",
        content: "# WorkBuddy Skill\n",
        createdAt: "2026-01-01T00:00:00.000Z",
        createdBy: "user-1",
        createdByDisplayName: "User",
        deleted: false,
        description: "WorkBuddy Skill",
        icon: "file",
        iconBg: "muted",
        id: "workbuddy-skill",
        latestHistoryDirname: "20260806000000",
        modifiedAt: "2026-08-06T00:00:00.000Z",
        modifiedBy: "user-1",
        modifiedByDisplayName: "User",
        name: "workbuddy-skill",
        title: "WorkBuddy Skill",
        type: "skill",
      },
      payload: {
        contentId: "workbuddy-skill",
        contentType: "skill",
        editorId: "workbuddy",
        scope: "global",
      },
      repositoryRootPath: root,
      stagingDirectoryPath,
      targetPath: path.join(root, "skills", "workbuddy-skill"),
      writeTextFile: async (targetPath, content) => {
        await mkdir(path.dirname(targetPath), { recursive: true })
        await writeFile(targetPath, content, "utf8")
      },
    }

    await installStrategy.prepareSkillDirectory!(context)

    await expect(readFile(path.join(stagingDirectoryPath, "SKILL.md"), "utf8"))
      .resolves.toBe("---\nname: workbuddy-skill\ndescription: WorkBuddy Skill\n---\n\n# WorkBuddy Skill\n")
    await expect(readFile(path.join(stagingDirectoryPath, ".synapse.json"), "utf8"))
      .resolves.toBe(JSON.stringify({
        id: "workbuddy-skill",
        repositoryVersion: "20260806000000",
      }, null, 2))
    await expect(readFile(path.join(stagingDirectoryPath, "scripts", "run.js"), "utf8"))
      .resolves.toBe("export {}\n")
  })

  it("does not expose Rule scanning or installation", async () => {
    await expect(scanStrategy.scanRules("/unused")).resolves.toEqual([])
    await expect(installStrategy.prepareRuleFileContent({} as never))
      .rejects.toThrow("WorkBuddy 暂不支持 Rule 安装。")
  })
})
