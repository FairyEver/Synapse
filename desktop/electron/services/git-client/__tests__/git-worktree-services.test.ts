import { describe, expect, it, vi } from "vitest"
import { createGitBranchService } from "../git-branch-service"
import { createGitCommitService } from "../git-commit-service"
import { createGitHistoryService } from "../git-history-service"
import { createGitStatusService } from "../git-status-service"
import { createGitSyncService } from "../git-sync-service"

const repository = {
  id: "repo-1",
  name: "Docs",
  localPath: "/repo",
  addedAt: "2026-06-17T10:00:00.000Z",
  lastOpenedAt: null,
}

describe("git worktree services", () => {
  it("reads status snapshot", async () => {
    const run = vi.fn().mockResolvedValue({
      stdout: "# branch.head main\n# branch.upstream origin/main\n# branch.ab +1 -0\n1 .M N... 100644 100644 100644 abc abc docs/a.md\n",
      stderr: "",
    })
    const service = createGitStatusService({ commandRunner: { run }, pathExists: async () => true })

    await expect(service.getSnapshot(repository)).resolves.toMatchObject({
      repositoryId: "repo-1",
      pathExists: true,
      isGitRepository: true,
      currentBranch: "main",
      ahead: 1,
      behind: 0,
    })
  })

  it("does not log normal status snapshots", async () => {
    const logger = createLoggerHarness()
    const run = vi.fn().mockResolvedValue({
      stdout: "# branch.head main\n# branch.upstream origin/main\n# branch.ab +0 -0\n",
      stderr: "",
    })
    const service = createGitStatusService({ commandRunner: { run }, logger, pathExists: async () => true })

    await service.getSnapshot(repository)

    expect(logger.info).not.toHaveBeenCalled()
    expect(logger.warn).not.toHaveBeenCalled()
    expect(logger.error).not.toHaveBeenCalled()
  })

  it("lists repository summaries without failing the whole batch", async () => {
    const run = vi.fn()
      .mockResolvedValueOnce({
        stdout: "# branch.head main\n# branch.upstream origin/main\n# branch.ab +0 -0\n",
        stderr: "",
      })
      .mockRejectedValueOnce(new Error("status failed"))
    const service = createGitStatusService({ commandRunner: { run }, pathExists: async () => true })

    await expect(service.listSummaries([
      repository,
      { ...repository, id: "repo-2", localPath: "/broken" },
    ])).resolves.toMatchObject([
      {
        repository: { id: "repo-1" },
        snapshot: { repositoryId: "repo-1", currentBranch: "main" },
        error: null,
      },
      {
        repository: { id: "repo-2" },
        snapshot: null,
        error: "status failed",
      },
    ])
  })

  it("loads text diff and marks binary diff", async () => {
    const textService = createGitStatusService({
      commandRunner: { run: vi.fn().mockResolvedValue({ stdout: "diff --git a/docs/a.md b/docs/a.md\n+hello\n", stderr: "" }) },
      pathExists: async () => true,
    })
    await expect(textService.getDiff(repository, { path: "docs/a.md", staged: false })).resolves.toEqual({
      path: "docs/a.md",
      originalPath: null,
      binary: false,
      text: "diff --git a/docs/a.md b/docs/a.md\n+hello\n",
    })

    const binaryService = createGitStatusService({
      commandRunner: { run: vi.fn().mockResolvedValue({ stdout: "Binary files a/logo.png and b/logo.png differ\n", stderr: "" }) },
      pathExists: async () => true,
    })
    await expect(binaryService.getDiff(repository, { path: "logo.png", staged: false })).resolves.toMatchObject({ binary: true })
  })

  it("commits selected files", async () => {
    const run = vi.fn().mockResolvedValue({ stdout: "", stderr: "" })
    const service = createGitCommitService({ commandRunner: { run }, now: () => new Date("2026-06-17T10:00:00.000Z") })

    await expect(service.commit(repository, { message: "更新文档", paths: ["docs/a.md"] })).resolves.toEqual({
      completedAt: "2026-06-17T10:00:00.000Z",
      message: "已提交选中文件。",
    })

    expect(run).toHaveBeenCalledWith(expect.objectContaining({
      args: ["add", "--", "docs/a.md"],
      cwd: "/repo",
      operation: "git.commit",
      operationId: expect.any(String),
    }))
    expect(run).toHaveBeenCalledWith(expect.objectContaining({
      args: ["commit", "-m", "更新文档"],
      cwd: "/repo",
      operation: "git.commit",
      operationId: expect.any(String),
    }))
  })

  it("syncs by fetch, pull fast-forward, then push", async () => {
    const run = vi.fn().mockResolvedValue({ stdout: "", stderr: "" })
    const getSnapshot = vi.fn()
      .mockResolvedValueOnce({ changes: [], behind: 2, ahead: 1 })
      .mockResolvedValueOnce({ changes: [], behind: 0, ahead: 1 })
    const service = createGitSyncService({ commandRunner: { run }, getSnapshot, now: () => new Date("2026-06-17T10:00:00.000Z") })

    await service.sync(repository)

    expect(run).toHaveBeenCalledWith(expect.objectContaining({
      args: ["fetch", "--prune"],
      cwd: "/repo",
      operation: "git.sync",
      operationId: expect.any(String),
      timeoutMs: 120000,
    }))
    expect(run).toHaveBeenCalledWith(expect.objectContaining({
      args: ["pull", "--ff-only"],
      cwd: "/repo",
      operation: "git.sync",
      operationId: expect.any(String),
      timeoutMs: 120000,
    }))
    expect(run).toHaveBeenCalledWith(expect.objectContaining({
      args: ["push"],
      cwd: "/repo",
      operation: "git.sync",
      operationId: expect.any(String),
      timeoutMs: 120000,
    }))
  })

  it("blocks sync when worktree has changes", async () => {
    const service = createGitSyncService({
      commandRunner: { run: vi.fn() },
      getSnapshot: vi.fn().mockResolvedValue({ changes: [{ path: "a.md" }], behind: 0, ahead: 0 }),
      now: () => new Date("2026-06-17T10:00:00.000Z"),
    })

    await expect(service.sync(repository)).rejects.toThrow("请先提交本地改动。")
  })

  it("lists and switches local branches", async () => {
    const run = vi.fn()
      .mockResolvedValueOnce({ stdout: "* main\n  docs-update\n", stderr: "" })
      .mockResolvedValueOnce({ stdout: "", stderr: "" })
      .mockResolvedValueOnce({ stdout: "", stderr: "" })
    const service = createGitBranchService({ commandRunner: { run }, getSnapshot: vi.fn().mockResolvedValue({ changes: [] }) })

    await expect(service.list(repository)).resolves.toEqual([
      { name: "main", current: true },
      { name: "docs-update", current: false },
    ])
    await service.checkout(repository, "docs-update")
    await service.create(repository, "new-docs")

    expect(run).toHaveBeenCalledWith(expect.objectContaining({
      args: ["checkout", "docs-update"],
      cwd: "/repo",
      operation: "git.checkout",
      operationId: expect.any(String),
    }))
    expect(run).toHaveBeenCalledWith(expect.objectContaining({
      args: ["checkout", "-b", "new-docs"],
      cwd: "/repo",
      operation: "git.branch.create",
      operationId: expect.any(String),
    }))
  })

  it("logs commit operation success with a stable operation id", async () => {
    const run = vi.fn().mockResolvedValue({ stdout: "", stderr: "" })
    const logger = createLoggerHarness()
    const service = createGitCommitService({
      commandRunner: { run },
      logger,
      now: () => new Date("2026-06-17T10:00:00.000Z"),
    })

    await service.commit(repository, { message: "更新文档", paths: ["docs/a.md"] })

    expect(logger.info).toHaveBeenCalledWith("Git operation started.", expect.objectContaining({
      operation: "git.commit",
      operationId: expect.any(String),
      selectedPathCount: 1,
    }))
    expect(logger.info).toHaveBeenCalledWith("Git operation completed.", expect.objectContaining({
      durationMs: expect.any(Number),
      operation: "git.commit",
      operationId: expect.any(String),
      selectedPathCount: 1,
    }))
  })

  it("logs failed sync stderr summary without secrets", async () => {
    const error = Object.assign(new Error("Authentication failed"), {
      exitCode: 128,
      stderr: "fatal: Authentication failed for https://user:secret@git.example.com/team/docs.git",
      stdout: "",
    })
    const run = vi.fn().mockRejectedValue(error)
    const logger = createLoggerHarness()
    const getSnapshot = vi.fn().mockResolvedValue({ changes: [], behind: 1, ahead: 0 })
    const service = createGitSyncService({ commandRunner: { run }, getSnapshot, logger })

    await expect(service.sync(repository)).rejects.toThrow("Authentication failed")

    expect(logger.error).toHaveBeenCalledWith("Git operation failed.", expect.objectContaining({
      errorCategory: "auth-failed",
      exitCode: 128,
      operation: "git.sync",
      operationId: expect.any(String),
      stderrSummary: expect.stringContaining("https://[redacted]@git.example.com/team/docs.git"),
    }))
    expect(JSON.stringify(logger.error.mock.calls)).not.toContain("user:secret")
  })

  it("reads current branch history and commit details", async () => {
    const run = vi.fn()
      .mockResolvedValueOnce({ stdout: "abc123\x1fa1b2c3d\x1f更新文档\x1f张三\x1fzhang@example.com\x1f2026-06-17T10:00:00+08:00\x1e", stderr: "" })
      .mockResolvedValueOnce({ stdout: "abc123\x1fa1b2c3d\x1f更新文档\x1f张三\x1fzhang@example.com\x1f2026-06-17T10:00:00+08:00\nM\tdocs/a.md\n", stderr: "" })
      .mockResolvedValueOnce({ stdout: "diff --git a/docs/a.md b/docs/a.md\n+hello\n", stderr: "" })
    const service = createGitHistoryService({ commandRunner: { run } })

    await expect(service.list(repository, { limit: 20, offset: 0 })).resolves.toHaveLength(1)
    await expect(service.getCommit(repository, "abc123")).resolves.toMatchObject({
      hash: "abc123",
      shortHash: "a1b2c3d",
      subject: "更新文档",
      files: [{ path: "docs/a.md", originalPath: null, status: "modified", staged: false, conflicted: false }],
      diff: "diff --git a/docs/a.md b/docs/a.md\n+hello\n",
    })
  })
})

function createLoggerHarness() {
  return {
    debug: vi.fn(),
    error: vi.fn(),
    info: vi.fn(),
    warn: vi.fn(),
  }
}
