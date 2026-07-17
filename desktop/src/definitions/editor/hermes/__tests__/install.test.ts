import { mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises"
import os from "node:os"
import path from "node:path"
import { afterEach, describe, expect, it } from "vitest"

import type { PrepareSkillDirectoryContext } from "../../../main-types"
import { materializeSkillEnv } from "../../../../../electron/services/skill-env/skill-env-materializer"
import { installStrategy } from "../install"

const tempRoots: string[] = []

async function createTempRoot(): Promise<string> {
  const root = await mkdtemp(path.join(os.tmpdir(), "synapse-hermes-skill-install-"))
  tempRoots.push(root)
  return root
}

afterEach(async () => {
  await Promise.all(tempRoots.splice(0).map((root) => rm(root, { force: true, recursive: true })))
})

describe("Hermes Skill installation", () => {
  it("uses the shared Skill layout and writes scanner-compatible metadata", async () => {
    const root = await createTempRoot()
    const stagingDirectoryPath = path.join(root, "staging")
    const existingTargetDirectoryPath = path.join(root, "existing")
    await Promise.all([
      mkdir(stagingDirectoryPath, { recursive: true }),
      mkdir(existingTargetDirectoryPath, { recursive: true }),
    ])
    const attachmentContent = new Map([
      [".env.example", "TOKEN=\n"],
      ["scripts/run.js", "export {}\n"],
    ])
    const context: PrepareSkillDirectoryContext = {
      copyAttachment: async (attachment, targetPath) => {
        await mkdir(path.dirname(targetPath), { recursive: true })
        await writeFile(targetPath, attachmentContent.get(attachment.originalName) ?? "", "utf8")
      },
      detail: {
        attachmentCount: 2,
        attachments: [
          { originalName: ".env.example", sha256: "a".repeat(64), size: 7 },
          { originalName: "scripts/run.js", sha256: "b".repeat(64), size: 10 },
        ],
        category: "general",
        content: "# Hermes Skill\n",
        createdAt: "2026-01-01T00:00:00.000Z",
        createdBy: "user-1",
        createdByDisplayName: "User",
        deleted: false,
        description: "Hermes Skill",
        icon: "file",
        iconBg: "muted",
        id: "hermes-skill",
        latestHistoryDirname: "20260710000000",
        modifiedAt: "2026-07-10T00:00:00.000Z",
        modifiedBy: "user-1",
        modifiedByDisplayName: "User",
        name: "hermes-skill",
        title: "Hermes Skill",
        type: "skill",
        sourceFingerprint: "sha256:current",
      } as PrepareSkillDirectoryContext["detail"] & { sourceFingerprint: string },
      payload: {
        contentId: "hermes-skill",
        contentType: "skill",
        editorId: "hermes",
        scope: "global",
      },
      repositoryRootPath: root,
      stagingDirectoryPath,
      targetPath: path.join(root, "skills", "hermes-skill"),
      writeTextFile: async (targetPath, content) => {
        await mkdir(path.dirname(targetPath), { recursive: true })
        await writeFile(targetPath, content, "utf8")
      },
    }

    await installStrategy.prepareSkillDirectory!(context)
    await materializeSkillEnv({
      stagingDirectoryPath,
      existingTargetDirectoryPath,
      values: { TOKEN: "confirmed" },
    })

    await expect(readFile(path.join(stagingDirectoryPath, ".env.example"), "utf8"))
      .resolves.toBe("TOKEN=\n")
    await expect(readFile(path.join(stagingDirectoryPath, ".env"), "utf8"))
      .resolves.toBe("TOKEN=\"confirmed\"\n")
    await expect(readFile(path.join(stagingDirectoryPath, ".synapse.json"), "utf8"))
      .resolves.toBe(JSON.stringify({
        id: "hermes-skill",
        repositoryVersion: "20260710000000",
        sourceFingerprint: "sha256:current",
      }, null, 2))
    await expect(readFile(path.join(stagingDirectoryPath, "SKILL.md"), "utf8"))
      .resolves.toBe("---\nname: hermes-skill\ndescription: Hermes Skill\n---\n\n# Hermes Skill\n")
    await expect(readFile(path.join(stagingDirectoryPath, "scripts", "run.js"), "utf8"))
      .resolves.toBe("export {}\n")
  })
})
