import { describe, expect, it, vi } from "vitest"
import path from "node:path"
import type { PrepareSkillDirectoryContext } from "../../main-types"
import { writeSynapseSkillDirectory } from "../shared-skill-directory"

function createContext(): {
  context: PrepareSkillDirectoryContext
  writeTextFile: ReturnType<typeof vi.fn>
} {
  const writeTextFile = vi.fn(async () => undefined)

  return {
    context: {
      copyAttachment: vi.fn(),
      detail: {
        attachmentCount: 0,
        attachments: [],
        category: "general",
        content: "# Review\n",
        createdAt: "2026-01-01T00:00:00.000Z",
        createdBy: "user-1",
        createdByDisplayName: "User",
        deleted: false,
        description: "Review carefully.",
        icon: "file",
        iconBg: "muted",
        id: "skill-1",
        latestHistoryDirname: "20260521010101",
        modifiedAt: "2026-05-21T01:01:01.000Z",
        modifiedBy: "user-1",
        modifiedByDisplayName: "User",
        name: "review",
        title: "Review",
        type: "skill",
      },
      payload: {
        contentId: "skill-1",
        contentType: "skill",
        editorId: "codex",
        scope: "global",
      },
      repositoryRootPath: "/repo",
      stagingDirectoryPath: "/tmp/staging",
      targetPath: "/tmp/skills/review",
      writeTextFile,
    },
    writeTextFile,
  }
}

describe("writeSynapseSkillDirectory", () => {
  it("writes the installed repository version into .synapse.json", async () => {
    const { context, writeTextFile } = createContext()

    await writeSynapseSkillDirectory(context)

    expect(writeTextFile).toHaveBeenCalledWith(
      path.join("/tmp/staging", ".synapse.json"),
      JSON.stringify({
        id: "skill-1",
        repositoryVersion: "20260521010101",
      }, null, 2),
    )
  })

  it("writes the source fingerprint into .synapse.json when available", async () => {
    const { context, writeTextFile } = createContext()
    context.detail = {
      ...context.detail,
      sourceFingerprint: "sha256:current",
    } as typeof context.detail & { sourceFingerprint: string }

    await writeSynapseSkillDirectory(context)

    expect(writeTextFile).toHaveBeenCalledWith(
      path.join("/tmp/staging", ".synapse.json"),
      JSON.stringify({
        id: "skill-1",
        repositoryVersion: "20260521010101",
        sourceFingerprint: "sha256:current",
      }, null, 2),
    )
  })

  it("rejects attachments that would overwrite generated install files", async () => {
    const { context } = createContext()
    context.detail.attachments = [
      { originalName: "SKILL.md", sha256: "sha-skill", size: 10 },
      { originalName: ".synapse.json", sha256: "sha-meta", size: 10 },
    ]

    await expect(writeSynapseSkillDirectory(context))
      .rejects.toThrow("附件路径不能使用 Skill 安装保留文件：SKILL.md")
    expect(context.copyAttachment).not.toHaveBeenCalled()
  })
})
