import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises"
import os from "node:os"
import path from "node:path"
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest"
import type { SynapseSkillDetail } from "../../../src/types/content"

const mocks = vi.hoisted(() => ({
  copyAttachmentToPath: vi.fn(async () => true),
  createZipArchive: vi.fn(async (_sourceDirectoryPath: string, outputFilePath: string) => {
    await writeFile(outputFilePath, "zip-by-runtime-archive", "utf8")
  }),
  getDetail: vi.fn(),
  getRepositoryState: vi.fn(async () => ({ gitRootPath: "/repo-root" })),
  loadConfig: vi.fn(async () => ({
    activeRepoUuid: "repo-1",
    repositories: [{
      uuid: "repo-1",
      name: "Repo",
      localPath: "/repo",
      contentDirs: {},
    }],
  })),
}))

vi.mock("electron", () => ({
  app: {
    getAppPath: () => "/tmp/synapse-content-download-test-app",
    getPath: (which: string) => `/tmp/synapse-content-download-test-${which}`,
    getName: () => "synapse-test",
    getVersion: () => "0.0.0-test",
    isPackaged: false,
  },
}))

vi.mock("../../runtime/archive", () => ({
  createZipArchive: mocks.createZipArchive,
}))

vi.mock("../content-service", () => ({
  contentService: {
    getContent: vi.fn(),
    getDetail: mocks.getDetail,
  },
}))

vi.mock("../attachments-pool-service", () => ({
  attachmentsPoolService: {
    copyAttachmentToPath: mocks.copyAttachmentToPath,
  },
}))

vi.mock("../config-store", () => ({
  configStore: {
    load: mocks.loadConfig,
  },
}))

vi.mock("../repository-store", () => ({
  repositoryStore: {
    getRepositoryState: mocks.getRepositoryState,
  },
}))

import { contentDownloadService } from "../content-download-service"

const tempRoots: string[] = []

async function createTempRoot(): Promise<string> {
  const root = await mkdtemp(path.join(os.tmpdir(), "synapse-content-download-"))
  tempRoots.push(root)
  return root
}

function createSkillDetail(id: string): SynapseSkillDetail {
  return {
    attachmentCount: 0,
    attachments: [],
    category: "test",
    content: "# Test Skill\n",
    createdAt: "2026-04-28T00:00:00.000Z",
    createdBy: "user",
    createdByDisplayName: "User",
    deleted: false,
    description: "",
    icon: "",
    iconBg: "",
    id,
    latestHistoryDirname: "current",
    modifiedAt: "2026-04-28T00:00:00.000Z",
    modifiedBy: "user",
    modifiedByDisplayName: "User",
    name: "test-skill",
    source: "builtin",
    title: "Test Skill",
    type: "skill",
  }
}

describe("ContentDownloadService", () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  afterEach(async () => {
    await Promise.all(tempRoots.splice(0).map((root) => rm(root, { recursive: true, force: true })))
  })

  it("delegates skill archives to the timeout-protected runtime archive helper", async () => {
    const root = await createTempRoot()
    const targetPath = path.join(root, "skill.zip")
    mocks.getDetail.mockResolvedValue(createSkillDetail("skill-1"))

    await contentDownloadService.downloadSkill("skill-1", targetPath)

    expect(mocks.createZipArchive).toHaveBeenCalledWith(
      expect.stringMatching(/skill-1$/),
      expect.stringMatching(/download\.zip$/),
      expect.objectContaining({
        messages: expect.objectContaining({
          missingTool: "当前系统缺少导出 Skill 压缩包所需的工具，暂时不能下载 Skill。",
          failed: "导出 Skill 压缩包失败，请稍后重试。",
        }),
      }),
    )
    expect(await readFile(targetPath, "utf8")).toBe("zip-by-runtime-archive")
  })

  it("rejects repository skill downloads when an attachment cannot be copied", async () => {
    const root = await createTempRoot()
    const targetPath = path.join(root, "skill.zip")
    mocks.copyAttachmentToPath.mockResolvedValue(false)
    mocks.getDetail.mockResolvedValue({
      ...createSkillDetail("skill-1"),
      attachmentCount: 1,
      attachments: [{
        originalName: "references/guide.md",
        sha256: "a".repeat(64),
        size: 5,
      }],
      source: "repository",
    })

    await expect(contentDownloadService.downloadSkill("skill-1", targetPath))
      .rejects.toThrow("Skill 附件复制失败：references/guide.md")

    expect(mocks.createZipArchive).not.toHaveBeenCalled()
    await expect(readFile(targetPath, "utf8")).rejects.toThrow()
  })
})
