import { access, mkdtemp, writeFile } from "node:fs/promises"
import { tmpdir } from "node:os"
import path from "node:path"
import { beforeEach, describe, expect, it, vi } from "vitest"

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
}))

vi.mock("../content-index-service", () => ({
  contentIndexService: mocks.contentIndexService,
}))

vi.mock("../log-store", () => ({
  createMainLogger: () => mocks.logger,
}))

vi.mock("../repository-store", () => ({
  repositoryStore: mocks.repositoryStore,
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
    mocks.repositoryStore.getRepositoryState.mockImplementation(async (repository) => ({
      gitRootPath: null,
      isGitRepository: false,
      localPath: repository.localPath,
      repositoryUuid: repository.uuid,
      status: "ready",
    }))
  })

  it("includes initialization preview entries when validating a non-Synapse directory", async () => {
    const { repositoryStructureService } = await import("../repository-structure-service")
    const localPath = await makeTempRepositoryPath()
    await writeFile(path.join(localPath, "notes.md"), "# Notes", "utf8")

    const result = await repositoryStructureService.validateDirectoryStructure(localPath)

    expect(result).toEqual(expect.objectContaining({
      initializationPreview: {
        isEmpty: false,
        nonGitEntries: ["notes.md"],
      },
      isValid: false,
    }))
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

  it("initializes a non-empty directory after the confirmed preview matches current entries", async () => {
    const { repositoryStructureService } = await import("../repository-structure-service")
    const localPath = await makeTempRepositoryPath()
    const filePath = path.join(localPath, "notes.md")
    await writeFile(filePath, "# Notes", "utf8")

    await expect(repositoryStructureService.initializeStructure({
      contentDirs: {},
      localPath,
      name: "Repo",
      uuid: "repo-1",
    }, {
      confirmedNonGitEntries: ["notes.md"],
    })).resolves.toEqual(expect.objectContaining({
      message: "初始化完成。",
    }))

    await expect(access(filePath)).rejects.toThrow()
    await expect(access(path.join(localPath, "rules", ".gitkeep"))).resolves.toBeUndefined()
    expect(mocks.contentIndexService.clearIndex).toHaveBeenCalledTimes(1)
  })
})
