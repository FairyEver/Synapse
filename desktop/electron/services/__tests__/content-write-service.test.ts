import { randomUUID } from "node:crypto"
import { mkdir, readFile, rm, writeFile } from "node:fs/promises"
import os from "node:os"
import path from "node:path"
import { afterEach, describe, expect, it, vi } from "vitest"

const fsMockState = vi.hoisted(() => ({
  cleanupFailureParentPath: null as string | null,
  iconRenameFailureParentPath: null as string | null,
}))

vi.mock("node:fs/promises", async (importOriginal) => {
  const actual = await importOriginal<typeof import("node:fs/promises")>()
  const pathModule = await import("node:path")

  return {
    ...actual,
    rm: vi.fn(async (...args: Parameters<typeof actual.rm>) => {
      const [target] = args
      const targetPath = String(target)

      if (
        fsMockState.cleanupFailureParentPath
        && pathModule.dirname(targetPath) === fsMockState.cleanupFailureParentPath
        && pathModule.basename(targetPath).startsWith(".synapse-history-")
      ) {
        throw Object.assign(new Error("temporary cleanup locked"), { code: "EBUSY" })
      }

      return actual.rm(...args)
    }),
    rename: vi.fn(async (...args: Parameters<typeof actual.rename>) => {
      const [source, target] = args
      const sourcePath = String(source)
      const targetPath = String(target)

      if (
        fsMockState.iconRenameFailureParentPath
        && pathModule.dirname(sourcePath) === fsMockState.iconRenameFailureParentPath
        && pathModule.basename(sourcePath).startsWith(".synapse-icon-")
        && pathModule.basename(targetPath) === "icon.png"
      ) {
        throw Object.assign(new Error("icon target locked"), { code: "EACCES" })
      }

      return actual.rename(...args)
    }),
  }
})

vi.mock("electron", () => ({
  app: {
    getAppPath: () => "/tmp/synapse-content-write-test-app",
    getPath: (which: string) => `/tmp/synapse-content-write-test-${which}`,
    getName: () => "synapse-test",
    getVersion: () => "0.0.0-test",
    isPackaged: false,
  },
}))

import { createDefaultConfig } from "../../../src/lib/config"
import type { SynapseRepositoryConfig } from "../../../src/types/config"
import type {
  SynapseContentSnapshotRecord,
  SynapseContentType,
  SynapseCreateSkillPayload,
} from "../../../src/types/content"
import { configStore } from "../config-store"
import { attachmentsPoolService } from "../attachments-pool-service"
import {
  CONTENT_ATTACHMENTS_FILE_NAME,
  CONTENT_MAIN_FILE_NAME,
  CONTENT_META_FILE_NAME,
  HISTORY_DIRECTORY_NAME,
} from "../content-history-service"
import { contentWriteService } from "../content-write-service"
import { repositoryStore } from "../repository-store"

const tempRoots: string[] = []

async function createTempRoot(): Promise<string> {
  const root = path.join(os.tmpdir(), `synapse-content-write-${randomUUID()}`)
  await mkdir(root, { recursive: true })
  tempRoots.push(root)
  return root
}

async function writeJson(filePath: string, value: unknown): Promise<void> {
  await writeFile(filePath, `${JSON.stringify(value, null, 2)}\n`, "utf8")
}

async function writeContentFixture(
  root: string,
  options: {
    contentDir: string
    contentId: string
    contentType: SynapseContentType
    historyDirname: string
    snapshot?: Partial<SynapseContentSnapshotRecord>
  },
): Promise<void> {
  const contentPath = path.join(root, options.contentDir, options.contentId)
  const historyPath = path.join(contentPath, HISTORY_DIRECTORY_NAME, options.historyDirname)

  await mkdir(historyPath, { recursive: true })
  await writeJson(path.join(contentPath, CONTENT_META_FILE_NAME), {
    schemaVersion: 1,
    id: options.contentId,
    type: options.contentType,
    createdBy: "user",
    createdByDisplayName: "User",
    createdAt: "2026-05-19T00:00:00.000Z",
  })
  await writeJson(path.join(historyPath, "snapshot.json"), {
    schemaVersion: 1,
    title: "Content",
    name: "content",
    description: "Description",
    category: "test",
    icon: "wrench",
    iconBg: "default",
    iconType: "icon",
    modifiedBy: "user",
    modifiedByDisplayName: "User",
    modifiedAt: "2026-05-19T00:00:00.000Z",
    deleted: false,
    ...options.snapshot,
  })
  await writeFile(path.join(historyPath, CONTENT_MAIN_FILE_NAME), "# Content\n", "utf8")
  await writeJson(path.join(historyPath, CONTENT_ATTACHMENTS_FILE_NAME), {
    schemaVersion: 1,
    files: [],
  })
}

async function writeRuleFixture(root: string, historyDirname: string): Promise<void> {
  await writeContentFixture(root, {
    contentDir: "rules",
    contentId: "rule-1",
    contentType: "rule",
    historyDirname,
    snapshot: {
      title: "Rule",
      name: "rule",
    },
  })
}

describe("contentWriteService", () => {
  afterEach(async () => {
    fsMockState.cleanupFailureParentPath = null
    fsMockState.iconRenameFailureParentPath = null
    vi.restoreAllMocks()
    await Promise.all(tempRoots.splice(0).map((root) => rm(root, { recursive: true, force: true })))
  })

  it("keeps an updated rule committed when temporary history cleanup fails after rename", async () => {
    const root = await createTempRoot()
    const baseHistoryDirname = "20260519000000Z__user__abc123"
    const repository: SynapseRepositoryConfig = {
      uuid: "repo-1",
      name: "Repo",
      localPath: root,
      contentDirs: { rule: "rules" },
    }
    const config = createDefaultConfig()
    config.activeRepoUuid = repository.uuid
    config.repositories = [repository]

    await writeRuleFixture(root, baseHistoryDirname)
    vi.spyOn(configStore, "load").mockResolvedValue(config)
    vi.spyOn(repositoryStore, "getRepositoryState").mockResolvedValue({
      repositoryUuid: repository.uuid,
      localPath: root,
      status: "ready",
      isGitRepository: false,
      gitRootPath: null,
    })
    fsMockState.cleanupFailureParentPath = path.join(root, "rules", "rule-1", HISTORY_DIRECTORY_NAME)

    const result = await contentWriteService.updateRule(
      {
        id: "rule-1",
        baseHistoryDirname,
        title: "Rule",
        name: "rule",
        description: "Description",
        category: "test",
        icon: "wrench",
        iconBg: "default",
        iconType: "icon",
        iconImage: "",
        content: "# Updated",
      },
      { displayName: "User", userId: "user" },
    )

    await expect(readFile(path.join(result.gitPaths[0], CONTENT_MAIN_FILE_NAME), "utf8"))
      .resolves.toBe("# Updated\n")
  })

  it("rejects an image icon update when replacing the final icon file fails", async () => {
    const root = await createTempRoot()
    const baseHistoryDirname = "20260519000000Z__user__abc123"
    const repository: SynapseRepositoryConfig = {
      uuid: "repo-1",
      name: "Repo",
      localPath: root,
      contentDirs: { rule: "rules" },
    }
    const config = createDefaultConfig()
    config.activeRepoUuid = repository.uuid
    config.repositories = [repository]

    await writeRuleFixture(root, baseHistoryDirname)
    await writeFile(path.join(root, "rules", "rule-1", "icon.png"), new Uint8Array([1, 2, 3]))
    vi.spyOn(configStore, "load").mockResolvedValue(config)
    vi.spyOn(repositoryStore, "getRepositoryState").mockResolvedValue({
      repositoryUuid: repository.uuid,
      localPath: root,
      status: "ready",
      isGitRepository: false,
      gitRootPath: null,
    })
    fsMockState.iconRenameFailureParentPath = path.join(root, "rules", "rule-1")

    await expect(contentWriteService.updateRule(
      {
        id: "rule-1",
        baseHistoryDirname,
        title: "Rule",
        name: "rule",
        description: "Description",
        category: "test",
        icon: "",
        iconBg: "",
        iconType: "image",
        iconImage: "icon.png",
        iconImageBytes: new Uint8Array([4, 5, 6]),
        content: "# Updated",
      },
      { displayName: "User", userId: "user" },
    )).rejects.toThrow("图标图片保存失败")
    await expect(readFile(path.join(root, "rules", "rule-1", "icon.png")))
      .resolves.toEqual(Buffer.from([1, 2, 3]))
  })

  it("preserves skill usage and image icon metadata when deleting content", async () => {
    const root = await createTempRoot()
    const baseHistoryDirname = "20260519000000Z__user__abc123"
    const repository: SynapseRepositoryConfig = {
      uuid: "repo-1",
      name: "Repo",
      localPath: root,
      contentDirs: { skill: "skills" },
    }
    const config = createDefaultConfig()
    config.activeRepoUuid = repository.uuid
    config.repositories = [repository]

    await writeContentFixture(root, {
      contentDir: "skills",
      contentId: "skill-1",
      contentType: "skill",
      historyDirname: baseHistoryDirname,
      snapshot: {
        title: "Skill",
        name: "skill",
        usage: "Use it carefully.",
        icon: "",
        iconBg: "",
        iconType: "image",
        iconImage: "icon.png",
      },
    })
    vi.spyOn(configStore, "load").mockResolvedValue(config)
    vi.spyOn(repositoryStore, "getRepositoryState").mockResolvedValue({
      repositoryUuid: repository.uuid,
      localPath: root,
      status: "ready",
      isGitRepository: false,
      gitRootPath: null,
    })

    const result = await contentWriteService.deleteContent("skill", "skill-1", {
      displayName: "User",
      userId: "user",
    })

    const snapshot = JSON.parse(
      await readFile(path.join(root, "skills", "skill-1", HISTORY_DIRECTORY_NAME, result.latestHistoryDirname, "snapshot.json"), "utf8"),
    ) as SynapseContentSnapshotRecord
    expect(snapshot).toMatchObject({
      deleted: true,
      usage: "Use it carefully.",
      iconType: "image",
      iconImage: "icon.png",
    })
  })

  it("preserves skill usage and image icon metadata when restoring content", async () => {
    const root = await createTempRoot()
    const baseHistoryDirname = "20260519000000Z__user__abc123"
    const repository: SynapseRepositoryConfig = {
      uuid: "repo-1",
      name: "Repo",
      localPath: root,
      contentDirs: { skill: "skills" },
    }
    const config = createDefaultConfig()
    config.activeRepoUuid = repository.uuid
    config.repositories = [repository]

    await writeContentFixture(root, {
      contentDir: "skills",
      contentId: "skill-1",
      contentType: "skill",
      historyDirname: baseHistoryDirname,
      snapshot: {
        title: "Skill",
        name: "skill",
        usage: "Use it carefully.",
        icon: "",
        iconBg: "",
        iconType: "image",
        iconImage: "icon.png",
        deleted: true,
      },
    })
    vi.spyOn(configStore, "load").mockResolvedValue(config)
    vi.spyOn(repositoryStore, "getRepositoryState").mockResolvedValue({
      repositoryUuid: repository.uuid,
      localPath: root,
      status: "ready",
      isGitRepository: false,
      gitRootPath: null,
    })

    const result = await contentWriteService.restoreContent("skill", "skill-1", {
      displayName: "User",
      userId: "user",
    })

    const snapshot = JSON.parse(
      await readFile(path.join(root, "skills", "skill-1", HISTORY_DIRECTORY_NAME, result.latestHistoryDirname, "snapshot.json"), "utf8"),
    ) as SynapseContentSnapshotRecord
    expect(snapshot).toMatchObject({
      deleted: false,
      usage: "Use it carefully.",
      iconType: "image",
      iconImage: "icon.png",
    })
  })

  it("refuses to purge content that is no longer deleted", async () => {
    const root = await createTempRoot()
    const historyDirname = "20260519000000Z__user__abc123"
    const repository: SynapseRepositoryConfig = {
      uuid: "repo-1",
      name: "Repo",
      localPath: root,
      contentDirs: { skill: "skills" },
    }
    const config = createDefaultConfig()
    config.activeRepoUuid = repository.uuid
    config.repositories = [repository]

    await writeContentFixture(root, {
      contentDir: "skills",
      contentId: "skill-1",
      contentType: "skill",
      historyDirname,
      snapshot: {
        title: "Skill",
        name: "skill",
        deleted: false,
      },
    })
    vi.spyOn(configStore, "load").mockResolvedValue(config)
    vi.spyOn(repositoryStore, "getRepositoryState").mockResolvedValue({
      repositoryUuid: repository.uuid,
      localPath: root,
      status: "ready",
      isGitRepository: false,
      gitRootPath: null,
    })

    await expect(contentWriteService.purgeContent("skill", "skill-1", {
      displayName: "User",
      userId: "user",
    })).rejects.toThrow("只能永久删除已删除的 技能 内容。")
    await expect(readFile(path.join(root, "skills", "skill-1", HISTORY_DIRECTORY_NAME, historyDirname, CONTENT_MAIN_FILE_NAME), "utf8"))
      .resolves.toBe("# Content\n")
  })

  it("rejects skill attachments with case-only duplicate paths before writing content", async () => {
    const root = await createTempRoot()
    const repository: SynapseRepositoryConfig = {
      uuid: "repo-1",
      name: "Repo",
      localPath: root,
      contentDirs: { skill: "skills" },
    }
    const config = createDefaultConfig()
    config.activeRepoUuid = repository.uuid
    config.repositories = [repository]

    vi.spyOn(configStore, "load").mockResolvedValue(config)
    vi.spyOn(repositoryStore, "getRepositoryState").mockResolvedValue({
      repositoryUuid: repository.uuid,
      localPath: root,
      status: "ready",
      isGitRepository: false,
      gitRootPath: null,
    })

    const payload: SynapseCreateSkillPayload = {
      title: "Skill",
      name: "skill",
      description: "Description",
      category: "test",
      icon: "wrench",
      iconBg: "default",
      iconType: "icon",
      iconImage: "",
      content: "# Skill",
      files: [
        { originalName: "assets/Readme.md", size: 1, bytes: new Uint8Array([1]) },
        { originalName: "assets/readme.md", size: 1, bytes: new Uint8Array([2]) },
      ],
    }

    await expect(contentWriteService.createSkill(payload, {
      displayName: "User",
      userId: "user",
    })).rejects.toThrow("附件文件名重复：assets/readme.md")
  })

  it("rejects a runtime .env attachment before writing attachments", async () => {
    const root = await createTempRoot()
    const repository: SynapseRepositoryConfig = {
      uuid: "repo-1",
      name: "Repo",
      localPath: root,
      contentDirs: { skill: "skills" },
    }
    const config = createDefaultConfig()
    config.activeRepoUuid = repository.uuid
    config.repositories = [repository]

    vi.spyOn(configStore, "load").mockResolvedValue(config)
    vi.spyOn(repositoryStore, "getRepositoryState").mockResolvedValue({
      repositoryUuid: repository.uuid,
      localPath: root,
      status: "ready",
      isGitRepository: false,
      gitRootPath: null,
    })
    const writeAttachments = vi.spyOn(attachmentsPoolService, "writeAttachments")
    const payload: SynapseCreateSkillPayload = {
      title: "Skill",
      name: "skill",
      description: "Description",
      category: "test",
      icon: "wrench",
      iconBg: "default",
      iconType: "icon",
      iconImage: "",
      content: "# Skill",
      files: [
        { originalName: ".ENV", size: 12, bytes: new TextEncoder().encode("TOKEN=secret") },
      ],
    }

    await expect(contentWriteService.createSkill(payload, {
      displayName: "User",
      userId: "user",
    })).rejects.toThrow("Skill 源目录不能包含 .env，请只提交 .env.example。")
    expect(writeAttachments).not.toHaveBeenCalled()
  })

  it("rejects a runtime .env attachment before updating attachments", async () => {
    const root = await createTempRoot()
    const baseHistoryDirname = "20260519000000Z__user__abc123"
    const repository: SynapseRepositoryConfig = {
      uuid: "repo-1",
      name: "Repo",
      localPath: root,
      contentDirs: { skill: "skills" },
    }
    const config = createDefaultConfig()
    config.activeRepoUuid = repository.uuid
    config.repositories = [repository]

    await writeContentFixture(root, {
      contentDir: "skills",
      contentId: "skill-1",
      contentType: "skill",
      historyDirname: baseHistoryDirname,
      snapshot: { title: "Skill", name: "skill" },
    })
    vi.spyOn(configStore, "load").mockResolvedValue(config)
    vi.spyOn(repositoryStore, "getRepositoryState").mockResolvedValue({
      repositoryUuid: repository.uuid,
      localPath: root,
      status: "ready",
      isGitRepository: false,
      gitRootPath: null,
    })
    const writeAttachments = vi.spyOn(attachmentsPoolService, "writeAttachments")

    await expect(contentWriteService.updateSkill({
      id: "skill-1",
      baseHistoryDirname,
      title: "Skill",
      name: "skill",
      description: "Description",
      category: "test",
      icon: "wrench",
      iconBg: "default",
      iconType: "icon",
      iconImage: "",
      content: "# Skill",
      files: [
        { originalName: ".EnV", size: 12, bytes: new TextEncoder().encode("TOKEN=secret") },
      ],
    }, {
      displayName: "User",
      userId: "user",
    })).rejects.toThrow("Skill 源目录不能包含 .env，请只提交 .env.example。")
    expect(writeAttachments).not.toHaveBeenCalled()
  })
})
