import { describe, expect, it, vi } from "vitest"
import { devNull } from "node:os"
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

function statusAndDiffRunner(changeLine: string, diffText: string) {
  return vi.fn(async (input: { readonly args: readonly string[] }) => (
    input.args[0] === "status"
      ? { stdout: `# branch.head main\n${changeLine}\n`, stderr: "" }
      : { stdout: diffText, stderr: "", stdoutTruncated: false }
  ))
}

describe("git worktree services", () => {
  it("reads status snapshot", async () => {
    const output = Buffer.from([
      "# branch.head main",
      "# branch.upstream origin/main",
      "# branch.ab +1 -0",
      "1 .M N... 100644 100644 100644 abc abc docs/a.md",
      "",
    ].join("\0"))
    const run = vi.fn(async (input: { onStdoutChunk?: (chunk: Uint8Array) => void }) => {
      input.onStdoutChunk?.(output.subarray(0, 31))
      input.onStdoutChunk?.(output.subarray(31))
      return { stdout: "", stderr: "" }
    })
    const logger = { error: vi.fn(), warn: vi.fn() }
    const service = createGitStatusService({ commandRunner: { run }, logger, pathExists: async () => true })

    await expect(service.getSnapshot(repository)).resolves.toMatchObject({
      repositoryId: "repo-1",
      pathExists: true,
      isGitRepository: true,
      currentBranch: "main",
      ahead: 1,
      behind: 0,
      changeCount: 1,
      changesTruncated: false,
    })
    expect(logger.warn).not.toHaveBeenCalledWith("Git repository state anomaly detected.", expect.anything())
    expect(run).toHaveBeenCalledWith(expect.objectContaining({
      args: ["status", "--porcelain=v2", "-z", "--branch", "--untracked-files=all"],
      captureStdout: false,
      onStdoutChunk: expect.any(Function),
    }))
  })

  it("logs status anomalies once per unchanged repository state", async () => {
    const run = vi.fn().mockResolvedValue({
      stdout: "# branch.head main\n# branch.ab +0 -0\nu UU N... 100644 100644 100644 100644 a b c d docs/conflict.md\n",
      stderr: "",
    })
    const logger = { error: vi.fn(), warn: vi.fn() }
    const service = createGitStatusService({
      commandRunner: { run },
      logger,
      pathExists: async () => true,
      readStateDiagnostics: async () => ({
        cherryPickInProgress: false,
        indexLockExists: true,
        mergeInProgress: true,
        rebaseInProgress: false,
      }),
    })

    await service.getSnapshot(repository)
    await service.getSnapshot(repository)

    expect(logger.warn).toHaveBeenCalledTimes(1)
    expect(logger.warn).toHaveBeenCalledWith("Git repository state anomaly detected.", expect.objectContaining({
      operation: "git.status",
      operationId: expect.any(String),
      repositoryId: "repo-1",
      repoPath: "/repo",
      anomalies: ["upstream-missing", "conflicts", "index-lock", "merge-in-progress"],
      branch: "main",
      changeCount: 1,
      conflictedCount: 1,
      diagnostics: expect.objectContaining({
        indexLockExists: true,
        mergeInProgress: true,
      }),
    }))
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

  it("limits concurrent repository summary status probes", async () => {
    let active = 0
    let maxActive = 0
    const run = vi.fn(async () => {
      active += 1
      maxActive = Math.max(maxActive, active)
      await new Promise((resolve) => setTimeout(resolve, 0))
      active -= 1
      return {
        stdout: "# branch.head main\n# branch.upstream origin/main\n# branch.ab +0 -0\n",
        stderr: "",
      }
    })
    const repositories = Array.from({ length: 9 }, (_, index) => ({
      ...repository,
      id: `repo-${index + 1}`,
      localPath: `/repo-${index + 1}`,
    }))
    const service = createGitStatusService({ commandRunner: { run }, pathExists: async () => true })

    await expect(service.listSummaries(repositories)).resolves.toHaveLength(9)

    expect(maxActive).toBeLessThanOrEqual(4)
  })

  it("loads text diff and marks binary diff", async () => {
    const textService = createGitStatusService({
      commandRunner: { run: statusAndDiffRunner("1 .M N... 100644 100644 100644 abc abc docs/a.md", "diff --git a/docs/a.md b/docs/a.md\n+hello\n") },
      pathExists: async () => true,
    })
    await expect(textService.getDiff(repository, { path: "docs/a.md" })).resolves.toEqual({
      path: "docs/a.md",
      originalPath: null,
      binary: false,
      truncated: false,
      text: "diff --git a/docs/a.md b/docs/a.md\n+hello\n",
    })

    const binaryService = createGitStatusService({
      commandRunner: { run: statusAndDiffRunner("1 .M N... 100644 100644 100644 abc abc logo.png", "Binary files a/logo.png and b/logo.png differ\n") },
      pathExists: async () => true,
    })
    await expect(binaryService.getDiff(repository, { path: "logo.png" })).resolves.toMatchObject({ binary: true })
  })

  it("shows the complete working-tree diff for tracked files", async () => {
    const run = statusAndDiffRunner("1 .M N... 100644 100644 100644 abc abc docs/a.md", "diff")
    const service = createGitStatusService({ commandRunner: { run }, pathExists: async () => true })

    await service.getDiff(repository, { path: "docs/a.md" })

    expect(run).toHaveBeenCalledWith(expect.objectContaining({
      args: ["diff", "HEAD", "--", "docs/a.md"],
    }))
  })

  it("shows untracked files as additions", async () => {
    const run = statusAndDiffRunner("? docs/new.md", "diff")
    const service = createGitStatusService({ commandRunner: { run }, pathExists: async () => true })

    await service.getDiff(repository, { path: "docs/new.md" })

    expect(run).toHaveBeenCalledWith(expect.objectContaining({
      args: ["diff", "--no-index", "--no-ext-diff", "--", devNull, "docs/new.md"],
      acceptedExitCodes: [0, 1],
    }))
  })

  it("derives diff metadata from the current main-process snapshot", async () => {
    const run = vi.fn()
      .mockResolvedValueOnce({
        stdout: "# branch.head main\n2 R. N... 100644 100644 100644 abc abc R100 docs/new.md\tdocs/old.md\n",
        stderr: "",
      })
      .mockResolvedValueOnce({ stdout: "diff", stderr: "", stdoutTruncated: false })
    const service = createGitStatusService({ commandRunner: { run }, pathExists: async () => true })

    await service.getDiff(repository, { path: "docs/new.md" })

    expect(run).toHaveBeenLastCalledWith(expect.objectContaining({
      args: ["diff", "HEAD", "--", "docs/old.md", "docs/new.md"],
    }))
  })

  it("rejects diff paths that are not current worktree changes", async () => {
    const run = vi.fn().mockResolvedValue({
      stdout: "# branch.head main\n? docs/current.md\n",
      stderr: "",
    })
    const service = createGitStatusService({ commandRunner: { run }, pathExists: async () => true })

    await expect(service.getDiff(repository, { path: ".env" }))
      .rejects.toThrow("当前改动")
    expect(run).toHaveBeenCalledTimes(1)
  })

  it("commits selected files", async () => {
    const run = vi.fn().mockResolvedValue({ stdout: "", stderr: "" })
    const logger = { error: vi.fn(), info: vi.fn(), warn: vi.fn() }
    const service = createGitCommitService({
      commandRunner: { run },
      getSnapshot: vi.fn().mockResolvedValue({
        changes: [{ path: "docs/a.md", originalPath: null }],
      }),
      logger,
      now: () => new Date("2026-06-17T10:00:00.000Z"),
    })

    await expect(service.commit(repository, { message: "更新文档", paths: ["docs/a.md"] })).resolves.toEqual({
      completedAt: "2026-06-17T10:00:00.000Z",
      message: "已提交选中文件。",
    })

    expect(run).toHaveBeenCalledWith(expect.objectContaining({ cwd: "/repo", args: ["--literal-pathspecs", "add", "--", "docs/a.md"] }))
    expect(run).toHaveBeenCalledWith(expect.objectContaining({ cwd: "/repo", args: ["--literal-pathspecs", "commit", "--only", "-m", "更新文档", "--", "docs/a.md"] }))
    const started = logger.info.mock.calls.find((call) => call[0] === "Git operation started.")?.[1] as { operationId?: string } | undefined
    const completed = logger.info.mock.calls.find((call) => call[0] === "Git operation completed.")?.[1] as { operationId?: string } | undefined
    expect(started?.operationId).toEqual(expect.any(String))
    expect(completed?.operationId).toBe(started?.operationId)
    expect(JSON.stringify(logger.info.mock.calls)).not.toContain("更新文档")
  })

  it("rejects a stale commit selection before staging files", async () => {
    const run = vi.fn()
    const service = createGitCommitService({
      commandRunner: { run },
      getSnapshot: vi.fn().mockResolvedValue({
        changes: [{ path: "docs/current.md", originalPath: null }],
      }),
    })

    await expect(service.commit(repository, { message: "更新文档", paths: ["docs/stale.md"] }))
      .rejects.toThrow("所选文件已发生变化")
    expect(run).not.toHaveBeenCalled()
  })

  it("syncs a behind-only branch by fetch then fast-forward pull", async () => {
    const run = vi.fn().mockResolvedValue({ stdout: "", stderr: "" })
    const logger = { error: vi.fn(), info: vi.fn(), warn: vi.fn() }
    const getSnapshot = vi.fn()
      .mockResolvedValueOnce({ changes: [], behind: 2, ahead: 0 })
      .mockResolvedValueOnce({ changes: [], behind: 2, ahead: 0 })
      .mockResolvedValueOnce({ changes: [], behind: 0, ahead: 0 })
    const service = createGitSyncService({ commandRunner: { run }, getSnapshot, logger, now: () => new Date("2026-06-17T10:00:00.000Z") })

    await service.sync(repository)

    expect(run).toHaveBeenCalledWith(expect.objectContaining({ cwd: "/repo", args: ["fetch", "--prune"], timeoutMs: 120000 }))
    expect(run).toHaveBeenCalledWith(expect.objectContaining({ cwd: "/repo", args: ["pull", "--ff-only"], timeoutMs: 120000 }))
    expect(run).not.toHaveBeenCalledWith(expect.objectContaining({ args: ["push"] }))
    const started = logger.info.mock.calls.find((call) => call[0] === "Git operation started.")?.[1] as { operationId?: string } | undefined
    const completed = logger.info.mock.calls.find((call) => call[0] === "Git operation completed.")?.[1] as { operationId?: string } | undefined
    expect(completed?.operationId).toBe(started?.operationId)
  })

  it("blocks automatic sync when the local and upstream branches have diverged", async () => {
    const run = vi.fn()
    const service = createGitSyncService({
      commandRunner: { run },
      getSnapshot: vi.fn().mockResolvedValue({
        changes: [],
        behind: 1,
        ahead: 1,
        currentBranch: "main",
        trackingStatus: "tracked",
      }),
    })

    await expect(service.sync(repository)).rejects.toThrow("本地分支与上游分支已分叉")
    expect(run).not.toHaveBeenCalled()
  })

  it("blocks automatic sync when the configured upstream no longer exists", async () => {
    const run = vi.fn()
    const service = createGitSyncService({
      commandRunner: { run },
      getSnapshot: vi.fn().mockResolvedValue({
        changes: [],
        behind: 0,
        ahead: 0,
        currentBranch: "main",
        trackingStatus: "gone",
      }),
    })

    await expect(service.sync(repository)).rejects.toThrow("上游分支不存在")
    expect(run).not.toHaveBeenCalled()
  })

  it("blocks fast-forward pull for diverged and deleted upstream states", async () => {
    const run = vi.fn()
    const getSnapshot = vi.fn()
      .mockResolvedValueOnce({ changes: [], behind: 1, ahead: 1, currentBranch: "main", trackingStatus: "tracked" })
      .mockResolvedValueOnce({ changes: [], behind: 0, ahead: 0, currentBranch: "main", trackingStatus: "gone" })
    const service = createGitSyncService({ commandRunner: { run }, getSnapshot })

    await expect(service.pull(repository)).rejects.toThrow("本地分支与上游分支已分叉")
    await expect(service.pull(repository)).rejects.toThrow("上游分支不存在")
    expect(run).not.toHaveBeenCalled()
  })

  it("pulls remote commits discovered by fetch during sync", async () => {
    const run = vi.fn().mockResolvedValue({ stdout: "", stderr: "" })
    const logger = { error: vi.fn(), info: vi.fn(), warn: vi.fn() }
    const getSnapshot = vi.fn()
      .mockResolvedValueOnce({ changes: [], behind: 0, ahead: 0 })
      .mockResolvedValueOnce({ changes: [], behind: 1, ahead: 0 })
      .mockResolvedValueOnce({ changes: [], behind: 0, ahead: 0 })
    const service = createGitSyncService({ commandRunner: { run }, getSnapshot, logger, now: () => new Date("2026-06-17T10:00:00.000Z") })

    await service.sync(repository)

    expect(run).toHaveBeenCalledWith(expect.objectContaining({ cwd: "/repo", args: ["fetch", "--prune"], timeoutMs: 120000 }))
    expect(run).toHaveBeenCalledWith(expect.objectContaining({ cwd: "/repo", args: ["pull", "--ff-only"], timeoutMs: 120000 }))
    expect(run).not.toHaveBeenCalledWith(expect.objectContaining({ args: ["push"] }))
  })

  it("logs remote operation success with a lightweight snapshot summary", async () => {
    const run = vi.fn().mockResolvedValue({ stdout: "", stderr: "" })
    const logger = { error: vi.fn(), info: vi.fn(), warn: vi.fn() }
    const getSnapshot = vi.fn().mockResolvedValue({
      changes: [{ path: "docs/a.md", status: "modified", conflicted: false }],
      behind: 0,
      ahead: 1,
    })
    const service = createGitSyncService({ commandRunner: { run }, getSnapshot, logger, now: () => new Date("2026-06-17T10:00:00.000Z") })

    await service.push(repository)

    const started = logger.info.mock.calls.find((call) => call[0] === "Git operation started.")?.[1] as { operationId?: string } | undefined
    expect(logger.info).toHaveBeenCalledWith("Git operation completed.", expect.objectContaining({
      operation: "git.push",
      operationId: started?.operationId,
      snapshot: expect.objectContaining({
        ahead: 1,
        changeCount: 1,
        isDirty: true,
      }),
    }))
  })

  it("sets upstream on the first push of a local branch", async () => {
    const run = vi.fn().mockResolvedValue({ stdout: "", stderr: "" })
    const getSnapshot = vi.fn().mockResolvedValue({
      changes: [],
      behind: 0,
      ahead: 0,
      currentBranch: "feature",
      trackingStatus: "untracked",
    })
    const service = createGitSyncService({ commandRunner: { run }, getSnapshot })

    await service.push(repository, "origin")

    expect(run).toHaveBeenCalledWith(expect.objectContaining({
      args: ["push", "--set-upstream", "origin", "feature"],
    }))
  })

  it("lists push targets and marks the Git-configured default", async () => {
    const run = vi.fn()
      .mockResolvedValueOnce({ stdout: "origin\nbackup\n", stderr: "" })
      .mockResolvedValueOnce({ stdout: "ssh://git@example.com/team/docs.git\n", stderr: "" })
      .mockResolvedValueOnce({ stdout: "ssh://git@backup.example.com/team/docs.git\n", stderr: "" })
      .mockResolvedValueOnce({ stdout: "backup\n", stderr: "" })
    const getSnapshot = vi.fn().mockResolvedValue({
      changes: [],
      behind: 0,
      ahead: 0,
      currentBranch: "feature",
      trackingStatus: "untracked",
    })
    const service = createGitSyncService({ commandRunner: { run }, getSnapshot })

    await expect(service.listPushTargets(repository)).resolves.toEqual([
      { name: "origin", url: "ssh://example.com/team/docs.git", preferred: false },
      { name: "backup", url: "ssh://backup.example.com/team/docs.git", preferred: true },
    ])
  })

  it("prefers remote.pushDefault over branch.remote", async () => {
    const run = vi.fn()
      .mockResolvedValueOnce({ stdout: "origin\nfork\n", stderr: "" })
      .mockResolvedValueOnce({ stdout: "ssh://git@example.com/team/docs.git\n", stderr: "" })
      .mockResolvedValueOnce({ stdout: "ssh://git@fork.example.com/team/docs.git\n", stderr: "" })
      .mockResolvedValueOnce({ stdout: "", stderr: "" })
      .mockResolvedValueOnce({ stdout: "fork\n", stderr: "" })
    const getSnapshot = vi.fn().mockResolvedValue({
      changes: [],
      behind: 0,
      ahead: 0,
      currentBranch: "feature",
      trackingStatus: "untracked",
    })
    const service = createGitSyncService({ commandRunner: { run }, getSnapshot })

    await expect(service.listPushTargets(repository)).resolves.toEqual([
      { name: "origin", url: "ssh://example.com/team/docs.git", preferred: false },
      { name: "fork", url: "ssh://fork.example.com/team/docs.git", preferred: true },
    ])
    expect(run).not.toHaveBeenCalledWith(expect.objectContaining({
      args: ["config", "--get", "branch.feature.remote"],
    }))
  })

  it("blocks sync when worktree has changes", async () => {
    const logger = { error: vi.fn(), info: vi.fn(), warn: vi.fn() }
    const service = createGitSyncService({
      commandRunner: { run: vi.fn() },
      getSnapshot: vi.fn().mockResolvedValue({ changes: [{ path: "a.md" }], behind: 0, ahead: 0 }),
      logger,
      now: () => new Date("2026-06-17T10:00:00.000Z"),
    })

    await expect(service.sync(repository)).rejects.toThrow("请先提交本地改动。")
    expect(logger.warn).toHaveBeenCalledWith("Git operation blocked.", expect.objectContaining({
      operation: "git.sync",
      operationId: expect.any(String),
      reason: "working-tree-dirty",
    }))
    expect(logger.error).not.toHaveBeenCalled()
  })

  it("lists and switches local branches", async () => {
    const run = vi.fn()
      .mockResolvedValueOnce({ stdout: "main\n", stderr: "" })
      .mockResolvedValueOnce({ stdout: "main\ndocs-update\n", stderr: "" })
      .mockResolvedValueOnce({ stdout: "", stderr: "" })
      .mockResolvedValueOnce({ stdout: "", stderr: "" })
    const service = createGitBranchService({ commandRunner: { run }, getSnapshot: vi.fn().mockResolvedValue({ changes: [] }) })

    await expect(service.list(repository)).resolves.toEqual([
      { name: "main", current: true },
      { name: "docs-update", current: false },
    ])
    await service.checkout(repository, "docs-update")
    await service.create(repository, "new-docs")

    expect(run).toHaveBeenCalledWith(expect.objectContaining({ cwd: "/repo", args: ["checkout", "docs-update"] }))
    expect(run).toHaveBeenCalledWith(expect.objectContaining({ cwd: "/repo", args: ["checkout", "-b", "new-docs"] }))
    expect(run).toHaveBeenNthCalledWith(1, expect.objectContaining({
      args: ["symbolic-ref", "--quiet", "--short", "HEAD"],
      acceptedExitCodes: [0, 1],
    }))
    expect(run).toHaveBeenNthCalledWith(2, expect.objectContaining({
      args: ["for-each-ref", "--format=%(refname:short)", "refs/heads"],
    }))
  })

  it("reads current branch history and commit details", async () => {
    const hash = "a".repeat(40)
    const run = vi.fn()
      .mockResolvedValueOnce({ stdout: `${hash}\x1fa1b2c3d\x1f\x1f张三\x1fzhang@example.com\x1f2026-06-17T10:00:00+08:00\x1e`, stderr: "" })
      .mockResolvedValueOnce({ stdout: `${hash}\x1fa1b2c3d\x1f更新文档\x1f张三\x1fzhang@example.com\x1f2026-06-17T10:00:00+08:00\x1e\0R100\0docs/旧 名称.md\0docs/新 名称.md\0M\0docs/中文.md\0`, stderr: "" })
      .mockResolvedValueOnce({ stdout: "diff --git a/docs/a.md b/docs/a.md\n+hello\n", stderr: "" })
    const service = createGitHistoryService({ commandRunner: { run } })

    await expect(service.list(repository, { limit: 20, offset: 0 })).resolves.toMatchObject([{ subject: "" }])
    await expect(service.getCommit(repository, hash)).resolves.toMatchObject({
      hash,
      shortHash: "a1b2c3d",
      subject: "更新文档",
      files: [
        { path: "docs/新 名称.md", originalPath: "docs/旧 名称.md", status: "renamed", staged: false, conflicted: false },
        { path: "docs/中文.md", originalPath: null, status: "modified", staged: false, conflicted: false },
      ],
      diff: "diff --git a/docs/a.md b/docs/a.md\n+hello\n",
      filesTruncated: false,
      diffTruncated: false,
      truncated: false,
    })
    expect(run).toHaveBeenNthCalledWith(2, expect.objectContaining({
      maxBufferBytes: 2 * 1024 * 1024,
      outputOverflow: "truncate",
    }))
    expect(run).toHaveBeenNthCalledWith(3, expect.objectContaining({
      maxBufferBytes: 2 * 1024 * 1024,
      outputOverflow: "truncate",
    }))
    expect(run).toHaveBeenNthCalledWith(2, expect.objectContaining({
      args: ["show", "--name-status", "-z", "--find-renames", expect.any(String), "--date=iso-strict", hash],
    }))
  })

  it("rejects commit detail arguments that are not full object ids", async () => {
    const run = vi.fn()
    const service = createGitHistoryService({ commandRunner: { run } })

    await expect(service.getCommit(repository, "--output=/tmp/synapse-owned")).rejects.toThrow("提交标识不合法")
    expect(run).not.toHaveBeenCalled()
  })
})
