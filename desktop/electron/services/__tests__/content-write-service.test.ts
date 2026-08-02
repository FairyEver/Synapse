import { randomUUID } from "node:crypto"
import { execFile } from "node:child_process"
import { mkdir, readFile, readdir, rm, writeFile } from "node:fs/promises"
import os from "node:os"
import path from "node:path"
import { promisify } from "node:util"
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
import { contentWriteTransactionService } from "../content-write-transaction-service"
import { contentSubmissionService } from "../content-submission-service"
import { commitRepositoryPaths } from "../repository-git-mutation-service"
import { repositoryStore } from "../repository-store"
import { userIdentityService } from "../user-identity-service"

const tempRoots: string[] = []
const execFileAsync = promisify(execFile)

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

async function initializeGitRepository(root: string): Promise<void> {
  await execFileAsync("git", ["-C", root, "init", "-q"])
  await execFileAsync("git", ["-C", root, "config", "user.name", "Test User"])
  await execFileAsync("git", ["-C", root, "config", "user.email", "test@example.com"])
  await execFileAsync("git", ["-C", root, "add", "."])
  await execFileAsync("git", ["-C", root, "commit", "--allow-empty", "-qm", "baseline"])
}

function mockGitRepository(repository: SynapseRepositoryConfig, root: string): void {
  const config = createDefaultConfig()
  config.activeRepoUuid = repository.uuid
  config.repositories = [repository]
  vi.spyOn(configStore, "load").mockResolvedValue(config)
  vi.spyOn(repositoryStore, "getRepositoryState").mockResolvedValue({
    repositoryUuid: repository.uuid,
    localPath: root,
    status: "ready",
    isGitRepository: true,
    gitRootPath: root,
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
    })).rejects.toThrow("Skill 发布内容不能包含运行时 .env 文件")
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
    })).rejects.toThrow("Skill 发布内容不能包含运行时 .env 文件")
    expect(writeAttachments).not.toHaveBeenCalled()
  })

  it("allows credential examples in Skill content and attachments", async () => {
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
    const secretValue = "synthetic-secret-value-12345678901234567890"
    const attachmentText = `Authorization: Bearer ${secretValue}`

    const result = contentWriteService.createSkill({
      title: "Skill",
      name: "skill",
      description: "Description",
      category: "test",
      icon: "wrench",
      iconBg: "default",
      iconType: "icon",
      iconImage: "",
      content: `https://example.test/hook?token=${secretValue}`,
      files: [{
        originalName: "scripts/example.mjs",
        size: attachmentText.length,
        bytes: new TextEncoder().encode(attachmentText),
      }],
    }, { displayName: "User", userId: "user" })

    await expect(result).resolves.toBeDefined()
    expect(writeAttachments).toHaveBeenCalled()
  })

  it("rolls back a created content directory and attachment pool writes", async () => {
    const root = await createTempRoot()
    await initializeGitRepository(root)
    const repository: SynapseRepositoryConfig = {
      uuid: randomUUID(),
      name: "Repo",
      localPath: root,
      contentDirs: { skill: "skills" },
    }
    mockGitRepository(repository, root)
    const bytes = new TextEncoder().encode("attachment")

    const result = await contentWriteService.createSkill({
      title: "Skill",
      name: "skill",
      description: "Description",
      category: "test",
      icon: "wrench",
      iconBg: "default",
      iconType: "icon",
      iconImage: "",
      content: "# Skill",
      files: [{ originalName: "asset.txt", size: bytes.byteLength, bytes }],
    }, { displayName: "User", userId: "user" })
    const createdContentPath = result.gitPaths[0]
    const createdAttachmentPath = result.gitPaths[1]

    await result.transaction.rollback()

    await expect(readFile(createdContentPath)).rejects.toMatchObject({ code: "ENOENT" })
    await expect(readFile(createdAttachmentPath)).rejects.toMatchObject({ code: "ENOENT" })
  })

  it("rolls back updated history, attachments, and an icon replacement", async () => {
    const root = await createTempRoot()
    const baseHistoryDirname = "20260519000000Z__user__abc123"
    await writeContentFixture(root, {
      contentDir: "skills",
      contentId: "skill-1",
      contentType: "skill",
      historyDirname: baseHistoryDirname,
      snapshot: { title: "Skill", name: "skill" },
    })
    const iconPath = path.join(root, "skills", "skill-1", "icon.png")
    await writeFile(iconPath, new Uint8Array([1, 2, 3]))
    await initializeGitRepository(root)
    const repository: SynapseRepositoryConfig = {
      uuid: randomUUID(),
      name: "Repo",
      localPath: root,
      contentDirs: { skill: "skills" },
    }
    mockGitRepository(repository, root)
    const bytes = new TextEncoder().encode("new attachment")

    const result = await contentWriteService.updateSkill({
      id: "skill-1",
      baseHistoryDirname,
      title: "Skill",
      name: "skill",
      description: "Description",
      category: "test",
      icon: "",
      iconBg: "",
      iconType: "image",
      iconImage: "icon.png",
      iconImageBytes: new Uint8Array([4, 5, 6]),
      content: "# Updated",
      files: [{ originalName: "asset.txt", size: bytes.byteLength, bytes }],
    }, { displayName: "User", userId: "user" })

    await result.transaction.rollback()

    expect(await readdir(path.join(root, "skills", "skill-1", HISTORY_DIRECTORY_NAME)))
      .toEqual([baseHistoryDirname])
    await expect(readFile(result.gitPaths[1])).rejects.toMatchObject({ code: "ENOENT" })
    expect(await readFile(iconPath)).toEqual(Buffer.from([1, 2, 3]))
  })

  it.each([
    ["deleteContent", false],
    ["restoreContent", true],
  ] as const)("rolls back history created by %s", async (method, deleted) => {
    const root = await createTempRoot()
    const baseHistoryDirname = "20260519000000Z__user__abc123"
    await writeContentFixture(root, {
      contentDir: "skills",
      contentId: "skill-1",
      contentType: "skill",
      historyDirname: baseHistoryDirname,
      snapshot: { title: "Skill", name: "skill", deleted },
    })
    await initializeGitRepository(root)
    const repository: SynapseRepositoryConfig = {
      uuid: randomUUID(),
      name: "Repo",
      localPath: root,
      contentDirs: { skill: "skills" },
    }
    mockGitRepository(repository, root)

    const result = await contentWriteService[method]("skill", "skill-1", {
      displayName: "User",
      userId: "user",
    })
    await result.transaction.rollback()

    expect(await readdir(path.join(root, "skills", "skill-1", HISTORY_DIRECTORY_NAME)))
      .toEqual([baseHistoryDirname])
  })

  it("restores a purged content directory on rollback", async () => {
    const root = await createTempRoot()
    const baseHistoryDirname = "20260519000000Z__user__abc123"
    await writeContentFixture(root, {
      contentDir: "skills",
      contentId: "skill-1",
      contentType: "skill",
      historyDirname: baseHistoryDirname,
      snapshot: { title: "Skill", name: "skill", deleted: true },
    })
    await initializeGitRepository(root)
    const repository: SynapseRepositoryConfig = {
      uuid: randomUUID(),
      name: "Repo",
      localPath: root,
      contentDirs: { skill: "skills" },
    }
    mockGitRepository(repository, root)
    const contentPath = path.join(root, "skills", "skill-1")

    const result = await contentWriteService.purgeContent("skill", "skill-1", {
      displayName: "User",
      userId: "user",
    })
    await expect(readdir(contentPath)).rejects.toMatchObject({ code: "ENOENT" })

    await result.transaction.rollback()

    await expect(readFile(path.join(contentPath, HISTORY_DIRECTORY_NAME, baseHistoryDirname, CONTENT_MAIN_FILE_NAME), "utf8"))
      .resolves.toBe("# Content\n")
  })

  it("finalizes recovery materials when restart detects the transaction commit", async () => {
    const root = await createTempRoot()
    await initializeGitRepository(root)
    const repository: SynapseRepositoryConfig = {
      uuid: randomUUID(),
      name: "Repo",
      localPath: root,
      contentDirs: { rule: "rules" },
    }
    mockGitRepository(repository, root)
    const result = await contentWriteService.createRule({
      title: "Rule",
      name: "rule",
      description: "Description",
      category: "test",
      icon: "wrench",
      iconBg: "default",
      iconType: "icon",
      iconImage: "",
      content: "# Rule",
    }, { displayName: "User", userId: "user" })
    await result.transaction.markCommitting()
    await commitRepositoryPaths({
      fallbackMessage: "commit failed",
      filePaths: result.gitPaths,
      gitRootPath: root,
      message: "create rule",
    })

    await contentWriteTransactionService.recover(repository.uuid, root)

    await expect(readFile(path.join(result.gitPaths[0], HISTORY_DIRECTORY_NAME, result.latestHistoryDirname, CONTENT_MAIN_FILE_NAME), "utf8"))
      .resolves.toBe("# Rule\n")
    await expect(contentWriteTransactionService.recover(repository.uuid, root)).resolves.toBeUndefined()
  })

  it("automatically rolls back a real create when the Git hook rejects commit", async () => {
    const root = await createTempRoot()
    await initializeGitRepository(root)
    const repository: SynapseRepositoryConfig = {
      uuid: randomUUID(),
      name: "Repo",
      localPath: root,
      contentDirs: { skill: "skills" },
    }
    mockGitRepository(repository, root)
    vi.spyOn(userIdentityService, "requireReadyRepoProfile").mockResolvedValue({
      displayName: "User",
      userId: "user",
    })
    const hookPath = path.join(root, ".git", "hooks", "pre-commit")
    await writeFile(hookPath, "#!/bin/sh\nexit 1\n", { encoding: "utf8", mode: 0o755 })
    const bytes = new TextEncoder().encode("attachment")

    await expect(contentSubmissionService.createSkill({
      title: "Skill",
      name: "skill",
      description: "Description",
      category: "test",
      icon: "wrench",
      iconBg: "default",
      iconType: "icon",
      iconImage: "",
      content: "# Skill",
      files: [{ originalName: "asset.txt", size: bytes.byteLength, bytes }],
    })).rejects.toThrow()

    const status = await execFileAsync("git", ["-C", root, "status", "--porcelain"])
    expect(status.stdout).toBe("")
  })
})
