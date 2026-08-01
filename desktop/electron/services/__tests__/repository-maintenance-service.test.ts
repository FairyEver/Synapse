import { randomUUID } from "node:crypto"
import { access, mkdir, rm, writeFile } from "node:fs/promises"
import os from "node:os"
import path from "node:path"
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest"
import type { SynapseRepositoryConfig } from "../../../src/types/config"

const mocks = vi.hoisted(() => ({
  contentIndexService: {
    syncIndex: vi.fn(),
  },
  isGitRebaseInProgress: vi.fn(),
  pendingPushesService: {
    clear: vi.fn(),
    enqueue: vi.fn(),
    readState: vi.fn(),
  },
  repositoryStore: {
    getRepositoryState: vi.fn(),
  },
  runGitCommand: vi.fn(),
  withRepositoryCacheDatabase: vi.fn(),
}))

vi.mock("electron", () => ({
  app: {
    getName: () => "synapse-test",
    getPath: (which: string) => `/tmp/synapse-maintenance-test-${which}`,
    getVersion: () => "0.0.0-test",
    isPackaged: false,
  },
}))

vi.mock("../content-index-service", () => ({
  contentIndexService: mocks.contentIndexService,
}))

vi.mock("../git-command", () => ({
  isGitRebaseInProgress: mocks.isGitRebaseInProgress,
  runGitCommand: mocks.runGitCommand,
}))

vi.mock("../log-store", () => ({
  createMainLogger: () => ({
    debug: vi.fn(),
    error: vi.fn(),
    info: vi.fn(),
    warn: vi.fn(),
  }),
}))

vi.mock("../pending-pushes-service", () => ({
  pendingPushesService: mocks.pendingPushesService,
}))

vi.mock("../repository-cache-database", () => ({
  withRepositoryCacheDatabase: mocks.withRepositoryCacheDatabase,
}))

vi.mock("../repository-store", () => ({
  repositoryStore: mocks.repositoryStore,
}))

const tempRoots: string[] = []

async function createTempRoot(): Promise<string> {
  const root = path.join(os.tmpdir(), `synapse-maintenance-${randomUUID()}`)
  await mkdir(root, { recursive: true })
  tempRoots.push(root)
  return root
}

async function writeJson(filePath: string, value: unknown): Promise<void> {
  await writeFile(filePath, `${JSON.stringify(value, null, 2)}\n`, "utf8")
}

function createCacheDatabaseMock() {
  return {
    prepare: vi.fn(() => ({
      get: vi.fn(() => undefined),
      run: vi.fn(),
    })),
  }
}

describe("repositoryMaintenanceService", () => {
  beforeEach(() => {
    vi.clearAllMocks()
    mocks.contentIndexService.syncIndex.mockResolvedValue(undefined)
    mocks.isGitRebaseInProgress.mockResolvedValue(false)
    mocks.pendingPushesService.clear.mockResolvedValue(undefined)
    mocks.pendingPushesService.enqueue.mockResolvedValue(undefined)
    mocks.pendingPushesService.readState.mockResolvedValue({ count: 0, items: [] })
    mocks.runGitCommand.mockImplementation(async (input: { args: string[] }) => ({
      stdout: input.args[0] === "rev-parse" ? "commit-1\n" : "",
      stderr: "",
    }))
    mocks.withRepositoryCacheDatabase.mockImplementation(async (
      _repositoryUuid: string,
      callback: (database: ReturnType<typeof createCacheDatabaseMock>) => unknown,
    ) => callback(createCacheDatabaseMock()))
  })

  afterEach(async () => {
    await Promise.all(tempRoots.splice(0).map((root) => rm(root, { recursive: true, force: true })))
  })

  it("cleans old soft-deleted image icon content during maintenance", async () => {
    const root = await createTempRoot()
    const repository: SynapseRepositoryConfig = {
      uuid: "repo-1",
      name: "Repo",
      localPath: root,
      contentDirs: { prompt: "prompts" },
    }
    const contentDirectoryPath = path.join(root, "prompts", "prompt-image")
    const historyDirectoryPath = path.join(contentDirectoryPath, "history", "20250101000000Z__user__image")

    mocks.repositoryStore.getRepositoryState.mockResolvedValue({
      status: "ready",
      isGitRepository: true,
      gitRootPath: root,
    })
    mocks.pendingPushesService.readState.mockResolvedValue({ count: 1, items: [] })
    await mkdir(historyDirectoryPath, { recursive: true })
    await writeJson(path.join(historyDirectoryPath, "snapshot.json"), {
      schemaVersion: 1,
      title: "Image Prompt",
      description: "Description",
      category: "general",
      icon: "",
      iconBg: "",
      iconType: "image",
      iconImage: "icon.png",
      modifiedBy: "user",
      modifiedByDisplayName: "User",
      modifiedAt: "2025-01-01T00:00:00.000Z",
      deleted: true,
    })
    await writeFile(path.join(historyDirectoryPath, "main.md"), "# Prompt\n", "utf8")
    await writeJson(path.join(historyDirectoryPath, "attachments.json"), {
      schemaVersion: 1,
      files: [],
    })

    const { repositoryMaintenanceService } = await import("../repository-maintenance-service")
    const result = await repositoryMaintenanceService.runManualMaintenance(repository)

    await expect(access(contentDirectoryPath)).rejects.toMatchObject({ code: "ENOENT" })
    expect(result.compactedCount).toBe(1)
    expect(result.pendingPushCount).toBe(1)
    expect(result.message).toBe("整理了 1 条内容，已同步。")
    expect(mocks.pendingPushesService.clear).not.toHaveBeenCalled()
  })

  it("does not abort a rebase that existed before maintenance sync", async () => {
    const root = await createTempRoot()
    const repository: SynapseRepositoryConfig = {
      uuid: "repo-1",
      name: "Repo",
      localPath: root,
      contentDirs: {},
    }
    mocks.repositoryStore.getRepositoryState.mockResolvedValue({
      status: "ready",
      isGitRepository: true,
      gitRootPath: root,
    })
    mocks.isGitRebaseInProgress.mockResolvedValueOnce(true)

    const { repositoryMaintenanceService } = await import("../repository-maintenance-service")

    await expect(repositoryMaintenanceService.runManualMaintenance(repository))
      .rejects
      .toThrow("当前仓库正在进行 rebase")

    expect(mocks.runGitCommand).not.toHaveBeenCalledWith(expect.objectContaining({
      args: expect.arrayContaining(["-X"]),
    }))
    expect(mocks.runGitCommand).not.toHaveBeenCalledWith(expect.objectContaining({
      args: ["rebase", "--abort"],
    }))
  })
})
