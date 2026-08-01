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
    expect(mocks.logger.warn).toHaveBeenCalledWith("Failed to determine ahead count after pull.", expect.objectContaining({
      operation: "repository.sync",
      operationId: expect.any(String),
      repositoryUuid: "repo-1",
      error: aheadError,
    }))
    expect(mocks.logger.error).not.toHaveBeenCalledWith(
      "Repository sync failed.",
      expect.anything(),
    )
  })

  it("uses raw git output to retry diverged pulls after failure formatting", async () => {
    const formattedDivergedError = Object.assign(
      new Error("仓库分支需要手动处理后再同步。"),
      { output: "fatal: Not possible to fast-forward, aborting." },
    )
    mocks.runGitCommand.mockImplementation(async (input: { args: string[] }) => {
      if (input.args[0] === "pull" && input.args.includes("--ff-only")) throw formattedDivergedError
      if (input.args[0] === "pull" && input.args.includes("--rebase")) return { stdout: "", stderr: "" }
      if (input.args[0] === "push") return { stdout: "", stderr: "" }
      throw new Error(`unexpected git command: ${input.args.join(" ")}`)
    })

    await expect(repositoryGitService.syncRepository(repository, vi.fn()))
      .resolves
      .toEqual(expect.objectContaining({
        operation: "sync",
        repository: readyGitState,
      }))

    expect(mocks.runGitCommand).toHaveBeenCalledWith(expect.objectContaining({
      args: ["pull", "--rebase", "--progress"],
    }))
    expect(mocks.runGitCommand).toHaveBeenCalledWith(expect.objectContaining({
      args: ["push", "--progress"],
    }))
  })

  it("does not abort a rebase that existed before diverged sync retry", async () => {
    const formattedDivergedError = Object.assign(
      new Error("仓库分支需要手动处理后再同步。"),
      { output: "fatal: Not possible to fast-forward, aborting." },
    )
    mocks.isGitRebaseInProgress.mockResolvedValueOnce(true)
    mocks.runGitCommand.mockImplementation(async (input: { args: string[] }) => {
      if (input.args[0] === "pull" && input.args.includes("--ff-only")) throw formattedDivergedError
      throw new Error(`unexpected git command: ${input.args.join(" ")}`)
    })

    await expect(repositoryGitService.syncRepository(repository, vi.fn()))
      .rejects
      .toThrow("当前仓库正在进行 rebase")

    expect(mocks.runGitCommand).not.toHaveBeenCalledWith(expect.objectContaining({
      args: ["pull", "--rebase", "--progress"],
    }))
    expect(mocks.runGitCommand).not.toHaveBeenCalledWith(expect.objectContaining({
      args: ["rebase", "--abort"],
    }))
  })

  it("logs failed repository git commands with operation diagnostics", async () => {
    const pullError = Object.assign(new Error("fatal: Authentication failed for https://user:secret@example.com/repo.git"), {
      exitCode: 128,
      stderr: "Authorization: Bearer raw.bearer.token\nfatal: token=raw-token",
      stdout: "",
      output: "Authorization: Bearer raw.bearer.token\nfatal: token=raw-token",
    })
    mocks.runGitCommand.mockRejectedValue(pullError)

    await expect(repositoryGitService.syncRepository(repository, vi.fn()))
      .rejects
      .toThrow("Authentication failed")

    expect(mocks.logger.error).toHaveBeenCalledWith("Repository Git command failed.", expect.objectContaining({
      operation: "repository.sync",
      operationId: expect.any(String),
      repositoryUuid: "repo-1",
      gitArgs: ["pull", "--ff-only", "--progress"],
      exitCode: 128,
      stderrPreview: expect.stringContaining("[redacted]"),
    }))
    const serialized = JSON.stringify(mocks.logger.error.mock.calls)
    expect(serialized).not.toContain("raw-token")
    expect(serialized).not.toContain("raw.bearer.token")
    expect(serialized).not.toContain("user:secret")
  })
})
