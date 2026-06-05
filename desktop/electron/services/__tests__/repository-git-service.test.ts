import { beforeEach, describe, expect, it, vi } from "vitest"
import type { SynapseRepositoryConfig } from "../../../src/types/config"
import { repositoryGitService } from "../repository-git-service"

const mocks = vi.hoisted(() => ({
  logger: {
    error: vi.fn(),
    info: vi.fn(),
    warn: vi.fn(),
  },
  repositoryLockManager: {
    acquire: vi.fn(),
  },
  repositoryStore: {
    getRepositoryState: vi.fn(),
  },
  runGitCommand: vi.fn(),
  isGitRebaseInProgress: vi.fn(),
}))

vi.mock("../git-command", () => ({
  isGitRebaseInProgress: mocks.isGitRebaseInProgress,
  runGitCommand: mocks.runGitCommand,
}))

vi.mock("../log-store", () => ({
  createMainLogger: () => mocks.logger,
}))

vi.mock("../repository-lock-manager", () => ({
  repositoryLockManager: mocks.repositoryLockManager,
}))

vi.mock("../repository-store", () => ({
  repositoryStore: mocks.repositoryStore,
}))

const repository: SynapseRepositoryConfig = {
  uuid: "repo-1",
  name: "Repo",
  localPath: "/repo",
  contentDirs: {},
}

const readyGitState = {
  status: "ready",
  isGitRepository: true,
  localPath: "/repo",
} as const

describe("repositoryGitService", () => {
  beforeEach(() => {
    vi.clearAllMocks()
    mocks.repositoryLockManager.acquire.mockResolvedValue(vi.fn())
    mocks.repositoryStore.getRepositoryState.mockResolvedValue(readyGitState)
  })

  it("keeps sync successful when ahead count fails after a successful pull", async () => {
    const aheadError = new Error("fatal: no upstream configured")
    mocks.runGitCommand.mockImplementation(async (input: { args: string[] }) => {
      if (input.args[0] === "pull") return { stdout: "", stderr: "" }
      if (input.args[0] === "rev-list") throw aheadError
      throw new Error(`unexpected git command: ${input.args.join(" ")}`)
    })

    await expect(repositoryGitService.syncRepository(repository, vi.fn()))
      .resolves
      .toEqual(expect.objectContaining({
        operation: "sync",
        repository: readyGitState,
      }))

    expect(mocks.runGitCommand).not.toHaveBeenCalledWith(expect.objectContaining({
      args: ["push", "--progress"],
    }))
    expect(mocks.logger.warn).toHaveBeenCalledWith("Failed to determine ahead count after pull.", {
      repositoryUuid: "repo-1",
      error: aheadError,
    })
    expect(mocks.logger.error).not.toHaveBeenCalledWith(
      "Repository sync failed.",
      expect.anything(),
    )
  })
})
