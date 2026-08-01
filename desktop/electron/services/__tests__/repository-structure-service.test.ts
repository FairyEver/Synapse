import { access, mkdir, mkdtemp, readdir, writeFile } from "node:fs/promises"
import { tmpdir } from "node:os"
import path from "node:path"
import { beforeEach, describe, expect, it, vi } from "vitest"

type RenameFunction = typeof import("node:fs/promises").rename

const mocks = vi.hoisted(() => ({
  contentIndexService: {
    clearIndex: vi.fn(),
    rebuildIndex: vi.fn(),
  },
  logger: {
    error: vi.fn(),
    info: vi.fn(),
    warn: vi.fn(),
  },
  repositoryStore: {
    getRepositoryState: vi.fn(),
  },
  userProfileService: {
    clearRepoProfiles: vi.fn(),
  },
  commitRepositoryPaths: vi.fn(),
}))

const fsMocks = vi.hoisted(() => ({
  renameCalls: vi.fn(),
  renameImplementation: undefined as
    | undefined
    | ((actualRename: RenameFunction, oldPath: string, newPath: string) => Promise<void>),
}))

vi.mock("node:fs/promises", async (importOriginal) => {
  const actual = await importOriginal<typeof import("node:fs/promises")>()
  return {
    ...actual,
    rename: async (oldPath: string, newPath: string) => {
      fsMocks.renameCalls(oldPath, newPath)
      if (fsMocks.renameImplementation) {
        return fsMocks.renameImplementation(actual.rename, oldPath, newPath)
      }
      return actual.rename(oldPath, newPath)
    },
  }
})

vi.mock("../content-index-service", () => ({
  contentIndexService: mocks.contentIndexService,
}))

vi.mock("../log-store", () => ({
  createMainLogger: () => mocks.logger,
}))

vi.mock("../repository-store", () => ({
  repositoryStore: mocks.repositoryStore,
}))

vi.mock("../repository-git-mutation-service", () => ({
  commitRepositoryPaths: mocks.commitRepositoryPaths,
}))

vi.mock("../user-profile-service", () => ({
  userProfileService: mocks.userProfileService,
}))

vi.mock("../git-command", () => ({
  runGitTextCommand: vi.fn(),
}))

vi.mock("../pending-pushes-service", () => ({
  pendingPushesService: {
    enqueue: vi.fn(),
  },
}))

async function makeTempRepositoryPath(): Promise<string> {
  return mkdtemp(path.join(tmpdir(), "synapse-repository-structure-"))
}

describe("RepositoryStructureService", () => {
  beforeEach(() => {
    vi.clearAllMocks()
    fsMocks.renameImplementation = undefined
    fsMocks.renameCalls.mockClear()
    mocks.repositoryStore.getRepositoryState.mockImplementation(async (repository) => ({
      gitRootPath: null,
      isGitRepository: false,
      localPath: repository.localPath,
      repositoryUuid: repository.uuid,
      status: "ready",
    }))
    mocks.commitRepositoryPaths.mockResolvedValue("commit-hash")
  })

  it("includes initialization preview entries when validating a non-Synapse directory", async () => {
    const { repositoryStructureService } = await import("../repository-structure-service")
    const localPath = await makeTempRepositoryPath()
    await writeFile(path.join(localPath, "notes.md"), "# Notes", "utf8")

    const result = await repositoryStructureService.validateDirectoryStructure(localPath)

    expect(result).toEqual(expect.objectContaining({
      initializationPreview: expect.objectContaining({
        isEmpty: false,
        nonGitEntries: ["notes.md"],
      }),
      isValid: false,
    }))
  })

  it("returns a deterministic initialization token when validating a non-Synapse directory", async () => {
    const { repositoryStructureService } = await import("../repository-structure-service")
    const localPath = await makeTempRepositoryPath()
    await writeFile(path.join(localPath, "notes.md"), "# Notes", "utf8")

    const first = await repositoryStructureService.validateDirectoryStructure(localPath)
    const second = await repositoryStructureService.validateDirectoryStructure(localPath)

    expect(first.initializationPreview.operationToken).toBeTruthy()
    expect(first.initializationPreview.operationToken).toBe(second.initializationPreview.operationToken)
    expect(first.initializationPreview.nonGitEntries).toEqual(["notes.md"])
    expect(first.initializationPreview.dangerFlags).toEqual([])
  })

  it("does not create missing content directories while validating", async () => {
    const { repositoryStructureService } = await import("../repository-structure-service")
    const localPath = await makeTempRepositoryPath()
    await mkdir(path.join(localPath, "system", "users"), { recursive: true })
    await mkdir(path.join(localPath, "system", "blobs"), { recursive: true })

    await repositoryStructureService.validateDirectoryStructure(localPath)

    await expect(access(path.join(localPath, "rules"))).rejects.toThrow()
    await expect(access(path.join(localPath, "skills"))).rejects.toThrow()
    await expect(access(path.join(localPath, "prompts"))).rejects.toThrow()
  })

  it("rejects Windows-unsafe local repository names before creating directories", async () => {
    const { repositoryStructureService } = await import("../repository-structure-service")
    const parentPath = await makeTempRepositoryPath()

    for (const name of ["CON", "aux.txt", "foo:bar", "report.", "report "]) {
      await expect(repositoryStructureService.createLocalRepository({
        name,
        parentPath,
      })).rejects.toThrow("本地仓库名称不能使用 Windows 非法文件名。")
    }

    await expect(readdir(parentPath)).resolves.toEqual([])
  })

  it("refuses to initialize a non-empty directory without a matching confirmation preview", async () => {
    const { repositoryStructureService } = await import("../repository-structure-service")
    const localPath = await makeTempRepositoryPath()
    const filePath = path.join(localPath, "notes.md")
    await writeFile(filePath, "# Notes", "utf8")

    await expect(repositoryStructureService.initializeStructure({
      contentDirs: {},
      localPath,
      name: "Repo",
      uuid: "repo-1",
    })).rejects.toThrow("确认")

    await expect(access(filePath)).resolves.toBeUndefined()
    expect(mocks.contentIndexService.clearIndex).not.toHaveBeenCalled()
  })

  it("moves non-empty directory contents into a backup before initialization", async () => {
    const { repositoryStructureService } = await import("../repository-structure-service")
    const localPath = await makeTempRepositoryPath()
    const filePath = path.join(localPath, "notes.md")
    await writeFile(filePath, "# Notes", "utf8")
    const preview = await repositoryStructureService.checkInitializationPreview({
      contentDirs: {},
      localPath,
      name: "Repo",
      uuid: "repo-1",
    })

    await expect(repositoryStructureService.initializeStructure({
      contentDirs: {},
      localPath,
      name: "Repo",
      uuid: "repo-1",
    }, {
      confirmedOperationToken: preview.operationToken,
    })).resolves.toEqual(expect.objectContaining({
      message: "初始化完成。",
    }))

    await expect(access(filePath)).rejects.toThrow()
    await expect(access(path.join(localPath, "rules", ".gitkeep"))).resolves.toBeUndefined()
    const entries = await readdir(localPath)
    const backupName = entries.find((entry) => entry.startsWith(".synapse-init-backup-"))
    expect(backupName).toBeTruthy()
    await expect(access(path.join(localPath, backupName!, "notes.md"))).resolves.toBeUndefined()
    expect(mocks.contentIndexService.clearIndex).toHaveBeenCalledTimes(1)
  })

  it("excludes initialization backups from git initialization commits", async () => {
    const { repositoryStructureService } = await import("../repository-structure-service")
    const localPath = await makeTempRepositoryPath()
    await writeFile(path.join(localPath, "notes.md"), "# Notes", "utf8")
    mocks.repositoryStore.getRepositoryState.mockImplementation(async (repository) => ({
      gitRootPath: repository.localPath,
      isGitRepository: true,
      localPath: repository.localPath,
      repositoryUuid: repository.uuid,
      status: "ready",
    }))
    const preview = await repositoryStructureService.checkInitializationPreview({
      contentDirs: {},
      localPath,
      name: "Repo",
      uuid: "repo-1",
    })

    await expect(repositoryStructureService.initializeStructure({
      contentDirs: {},
      localPath,
      name: "Repo",
      uuid: "repo-1",
    }, {
      confirmedOperationToken: preview.operationToken,
    })).resolves.toEqual(expect.objectContaining({
      message: "初始化完成。",
    }))

    expect(mocks.commitRepositoryPaths).toHaveBeenCalledWith(expect.objectContaining({
      gitRootPath: localPath,
      filePaths: expect.arrayContaining([
        path.join(localPath, "notes.md"),
        path.join(localPath, "rules", ".gitkeep"),
      ]),
    }))
    expect(mocks.commitRepositoryPaths.mock.calls[0]?.[0].filePaths)
      .not.toEqual(expect.arrayContaining([expect.stringContaining(".synapse-init-backup-")]))
  })

  it("restores backed up contents when initialization fails after scaffolding", async () => {
    const { repositoryStructureService } = await import("../repository-structure-service")
    const localPath = await makeTempRepositoryPath()
    const filePath = path.join(localPath, "notes.md")
    await writeFile(filePath, "# Notes", "utf8")
    const preview = await repositoryStructureService.checkInitializationPreview({
      contentDirs: {},
      localPath,
      name: "Repo",
      uuid: "repo-1",
    })
    mocks.contentIndexService.rebuildIndex.mockRejectedValueOnce(new Error("index failed"))

    await expect(repositoryStructureService.initializeStructure({
      contentDirs: {},
      localPath,
      name: "Repo",
      uuid: "repo-1",
    }, {
      confirmedOperationToken: preview.operationToken,
    })).rejects.toThrow("index failed")

    await expect(access(filePath)).resolves.toBeUndefined()
    await expect(access(path.join(localPath, "rules"))).rejects.toThrow()
    const entries = await readdir(localPath)
    expect(entries.some((entry) => entry.startsWith(".synapse-init-backup-"))).toBe(false)
    expect(mocks.logger.warn).toHaveBeenCalledWith(
      "Rolled back repository initialization backup after failure.",
      expect.objectContaining({
        backupName: expect.stringMatching(/^\.synapse-init-backup-/),
        repositoryUuid: "repo-1",
      }),
    )
  })

  it("restores already moved contents when backup move fails halfway", async () => {
    const { repositoryStructureService } = await import("../repository-structure-service")
    const localPath = await makeTempRepositoryPath()
    await writeFile(path.join(localPath, "first.md"), "# First", "utf8")
    await writeFile(path.join(localPath, "second.md"), "# Second", "utf8")
    const preview = await repositoryStructureService.checkInitializationPreview({
      contentDirs: {},
      localPath,
      name: "Repo",
      uuid: "repo-1",
    })
    let backupMoveCount = 0
    fsMocks.renameImplementation = async (actualRename, oldPath, newPath) => {
      if (path.basename(path.dirname(newPath)).startsWith(".synapse-init-backup-")) {
        backupMoveCount += 1
        if (backupMoveCount === 2) {
          throw new Error("rename failed")
        }
      }
      await actualRename(oldPath, newPath)
    }

    await expect(repositoryStructureService.initializeStructure({
      contentDirs: {},
      localPath,
      name: "Repo",
      uuid: "repo-1",
    }, {
      confirmedOperationToken: preview.operationToken,
    })).rejects.toThrow("备份旧目录内容失败")

    await expect(access(path.join(localPath, "first.md"))).resolves.toBeUndefined()
    await expect(access(path.join(localPath, "second.md"))).resolves.toBeUndefined()
    await expect(access(path.join(localPath, "rules"))).rejects.toThrow()
    const entries = await readdir(localPath)
    expect(entries.some((entry) => entry.startsWith(".synapse-init-backup-"))).toBe(false)
    expect(mocks.contentIndexService.clearIndex).not.toHaveBeenCalled()
  })

  it("rejects initialization when the confirmed token no longer matches current contents", async () => {
    const { repositoryStructureService } = await import("../repository-structure-service")
    const localPath = await makeTempRepositoryPath()
    await writeFile(path.join(localPath, "notes.md"), "# Notes", "utf8")
    const preview = await repositoryStructureService.checkInitializationPreview({
      contentDirs: {},
      localPath,
      name: "Repo",
      uuid: "repo-1",
    })
    await writeFile(path.join(localPath, "new.md"), "# New", "utf8")

    await expect(repositoryStructureService.initializeStructure({
      contentDirs: {},
      localPath,
      name: "Repo",
      uuid: "repo-1",
    }, {
      confirmedOperationToken: preview.operationToken,
    })).rejects.toThrow("目录内容已变化")

    await expect(access(path.join(localPath, "notes.md"))).resolves.toBeUndefined()
    await expect(access(path.join(localPath, "new.md"))).resolves.toBeUndefined()
  })

  it("rejects initialization for source-like directories", async () => {
    const { repositoryStructureService } = await import("../repository-structure-service")
    const localPath = await makeTempRepositoryPath()
    await writeFile(path.join(localPath, "package.json"), "{}\n", "utf8")
    const preview = await repositoryStructureService.checkInitializationPreview({
      contentDirs: {},
      localPath,
      name: "Repo",
      uuid: "repo-1",
    })

    expect(preview.dangerFlags).toContain("source-repository")
    await expect(repositoryStructureService.initializeStructure({
      contentDirs: {},
      localPath,
      name: "Repo",
      uuid: "repo-1",
    }, {
      confirmedOperationToken: preview.operationToken,
    })).rejects.toThrow("不能直接初始化")
  })
})
