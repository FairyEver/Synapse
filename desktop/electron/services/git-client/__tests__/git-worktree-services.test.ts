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

    expect(run).toHaveBeenCalledWith({ cwd: "/repo", args: ["add", "--", "docs/a.md"] })
    expect(run).toHaveBeenCalledWith({ cwd: "/repo", args: ["commit", "-m", "更新文档"] })
  })

  it("syncs by fetch, pull fast-forward, then push", async () => {
    const run = vi.fn().mockResolvedValue({ stdout: "", stderr: "" })
    const getSnapshot = vi.fn()
      .mockResolvedValueOnce({ changes: [], behind: 2, ahead: 1 })
      .mockResolvedValueOnce({ changes: [], behind: 0, ahead: 1 })
    const service = createGitSyncService({ commandRunner: { run }, getSnapshot, now: () => new Date("2026-06-17T10:00:00.000Z") })

    await service.sync(repository)

    expect(run).toHaveBeenCalledWith({ cwd: "/repo", args: ["fetch", "--prune"], timeoutMs: 120000 })
    expect(run).toHaveBeenCalledWith({ cwd: "/repo", args: ["pull", "--ff-only"], timeoutMs: 120000 })
    expect(run).toHaveBeenCalledWith({ cwd: "/repo", args: ["push"], timeoutMs: 120000 })
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

    expect(run).toHaveBeenCalledWith({ cwd: "/repo", args: ["checkout", "docs-update"] })
    expect(run).toHaveBeenCalledWith({ cwd: "/repo", args: ["checkout", "-b", "new-docs"] })
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
