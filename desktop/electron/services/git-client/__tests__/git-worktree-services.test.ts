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
      stdout: "# branch.head main\n# branch.ab +0 -0\nu UU N... 100644 100644 100644 100644 a b c docs/conflict.md\n",
      stderr: "",
    })
    const logger = { error: vi.fn(), warn: vi.fn() }
    const service = createGitStatusService({
      commandRunner: { run },
      logger,
      pathExists: async () => true,
      readStateDiagnostics: async () => ({
        indexLockExists: true,
        operationState: "merge",
      }),
    })

    await service.getSnapshot(repository)
    await service.getSnapshot(repository)

    expect(logger.warn).toHaveBeenCalledTimes(1)
    expect(logger.warn).toHaveBeenCalledWith("Git repository state anomaly detected.", expect.objectContaining({
      operation: "git.status",
      operationId: expect.any(String),
      repositoryId: "repo-1",
      repoPath: "[path redacted]/repo",
      anomalies: ["upstream-missing", "conflicts", "index-lock", "merge-in-progress"],
      branch: "main",
      changeCount: 1,
      conflictedCount: 1,
      diagnostics: expect.objectContaining({
        indexLockExists: true,
        operationState: "merge",
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

  it("limits concurrent two-layer change projections", async () => {
    const output = Buffer.from([
      "# branch.head main",
      ...Array.from({ length: 1_000 }, (_, index) => (
        `1 MM N... 100644 100644 100644 a b docs/file-${index}.md`
      )),
      "",
    ].join("\0"))
    let active = 0
    let peak = 0
    const refineTwoLayerChange = vi.fn(async () => {
      active += 1
      peak = Math.max(peak, active)
      await new Promise((resolve) => setTimeout(resolve, 0))
      active -= 1
      return true
    })
    const service = createGitStatusService({
      commandRunner: {
        run: vi.fn(async (input: { readonly onStdoutChunk?: (chunk: Uint8Array) => void }) => {
          input.onStdoutChunk?.(output)
          return { stdout: "", stderr: "" }
        }),
      },
      pathExists: async () => true,
      refineTwoLayerChange,
    })

    await expect(service.getSnapshot(repository)).resolves.toMatchObject({ changeCount: 1_000 })
    expect(refineTwoLayerChange).toHaveBeenCalledTimes(1_000)
    expect(peak).toBe(4)
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
      args: ["diff", "--no-index", "--no-ext-diff", "--", "/dev/null", "docs/new.md"],
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
    const cleanup = vi.fn().mockResolvedValue(undefined)
    const selections = {
      invalidate: vi.fn(),
      validate: vi.fn().mockResolvedValue({
        head: "abc123",
        paths: ["docs/a.md"],
      }),
    }
    const service = createGitCommitService({
      commandRunner: { run },
      createTemporaryIndex: async () => ({ path: "/tmp/synapse-index", cleanup }),
      logger,
      now: () => new Date("2026-06-17T10:00:00.000Z"),
      selections,
    })

    await expect(service.commit(repository, { message: "更新文档", selectionId: "selection-1" })).resolves.toEqual({
      completedAt: "2026-06-17T10:00:00.000Z",
      message: "已提交选中文件。",
    })

    expect(run).toHaveBeenCalledWith(expect.objectContaining({ cwd: "/repo", gitIndexFile: "/tmp/synapse-index", args: ["read-tree", "abc123"] }))
    expect(run).toHaveBeenCalledWith(expect.objectContaining({ cwd: "/repo", gitIndexFile: "/tmp/synapse-index", args: ["--literal-pathspecs", "add", "--all", "--", "docs/a.md"] }))
    expect(run).toHaveBeenCalledWith(expect.objectContaining({ cwd: "/repo", gitIndexFile: "/tmp/synapse-index", args: ["commit", "-m", "更新文档"] }))
    expect(run).toHaveBeenCalledWith(expect.objectContaining({ cwd: "/repo", args: ["--literal-pathspecs", "reset", "--mixed", "HEAD", "--", "docs/a.md"] }))
    expect(selections.validate).toHaveBeenCalledTimes(2)
    expect(selections.invalidate).toHaveBeenCalledWith("selection-1")
    expect(cleanup).toHaveBeenCalledOnce()
    const started = logger.info.mock.calls.find((call) => call[0] === "Git operation started.")?.[1] as { operationId?: string } | undefined
    const completed = logger.info.mock.calls.find((call) => call[0] === "Git operation completed.")?.[1] as { operationId?: string } | undefined
    expect(started?.operationId).toEqual(expect.any(String))
    expect(completed?.operationId).toBe(started?.operationId)
    expect(JSON.stringify(logger.info.mock.calls)).not.toContain("更新文档")
  })

  it("rejects a stale commit selection before creating a temporary index", async () => {
    const run = vi.fn()
    const service = createGitCommitService({
      commandRunner: { run },
      selections: {
        invalidate: vi.fn(),
        validate: vi.fn().mockRejectedValue(new Error("所选文件已发生变化，请重新审阅后再提交。")),
      },
    })

    await expect(service.commit(repository, { message: "更新文档", selectionId: "stale-selection" }))
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
    expect(run).toHaveBeenCalledWith(expect.objectContaining({ cwd: "/repo", args: ["merge", "--ff-only", "--no-overwrite-ignore", "@{u}"], timeoutMs: 120000 }))
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
    expect(run).toHaveBeenCalledWith(expect.objectContaining({ cwd: "/repo", args: ["merge", "--ff-only", "--no-overwrite-ignore", "@{u}"], timeoutMs: 120000 }))
    expect(run).not.toHaveBeenCalledWith(expect.objectContaining({ args: ["push"] }))
  })

  it("logs remote operation success with a lightweight snapshot summary", async () => {
    const run = vi.fn().mockResolvedValue({ stdout: "", stderr: "" })
    const logger = { error: vi.fn(), info: vi.fn(), warn: vi.fn() }
    const getSnapshot = vi.fn().mockResolvedValue({
      changes: [{ path: "docs/a.md", status: "modified" }],
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

  it("plans an empty remote as an initial commit push", async () => {
    const run = vi.fn().mockResolvedValue({ stdout: "", stderr: "" })
    const getSnapshot = vi.fn().mockResolvedValue({
      changes: [],
      changeCount: 0,
      behind: 0,
      ahead: 0,
      currentBranch: "main",
      hasCommits: false,
      trackingStatus: "untracked",
    })
    const service = createGitSyncService({ commandRunner: { run }, getSnapshot })

    await expect(service.inspectInitialization(repository, "origin")).resolves.toEqual({
      kind: "create-and-push",
      branchName: "main",
      remoteName: "origin",
    })
    expect(run).toHaveBeenCalledWith(expect.objectContaining({
      args: ["ls-remote", "--symref", "origin", "HEAD", "refs/heads/*"],
    }))
  })

  it("prefers the advertised remote HEAD when initializing", async () => {
    const run = vi.fn().mockResolvedValue({
      stdout: "ref: refs/heads/docs\tHEAD\nabc\tHEAD\nabc\trefs/heads/docs\ndef\trefs/heads/main\n",
      stderr: "",
    })
    const getSnapshot = vi.fn().mockResolvedValue({
      changes: [],
      changeCount: 0,
      behind: 0,
      ahead: 0,
      currentBranch: "main",
      hasCommits: false,
      trackingStatus: "untracked",
    })
    const service = createGitSyncService({ commandRunner: { run }, getSnapshot })

    await expect(service.inspectInitialization(repository, "origin")).resolves.toEqual({
      kind: "track-remote",
      branchName: "docs",
      remoteName: "origin",
    })
  })

  it("uses a sole remote branch and rejects ambiguous remote branches", async () => {
    const getSnapshot = vi.fn().mockResolvedValue({
      changes: [],
      changeCount: 0,
      behind: 0,
      ahead: 0,
      currentBranch: "main",
      hasCommits: false,
      trackingStatus: "untracked",
    })
    const run = vi.fn()
      .mockResolvedValueOnce({ stdout: "abc\trefs/heads/docs\n", stderr: "" })
      .mockResolvedValueOnce({ stdout: "abc\trefs/heads/docs\ndef\trefs/heads/main\n", stderr: "" })
    const service = createGitSyncService({ commandRunner: { run }, getSnapshot })

    await expect(service.inspectInitialization(repository, "origin")).resolves.toMatchObject({
      kind: "track-remote",
      branchName: "docs",
    })
    await expect(service.inspectInitialization(repository, "origin")).rejects.toThrow("远端默认分支不明确")
  })

  it("creates one empty commit and pushes it during initialization", async () => {
    const run = vi.fn().mockResolvedValue({ stdout: "", stderr: "" })
    const getSnapshot = vi.fn().mockResolvedValue({
      changes: [],
      changeCount: 0,
      behind: 0,
      ahead: 0,
      currentBranch: "main",
      hasCommits: false,
      trackingStatus: "untracked",
    })
    const service = createGitSyncService({ commandRunner: { run }, getSnapshot })

    await service.initialize(repository, {
      branchName: "main",
      kind: "create-and-push",
      message: "Initial commit",
      remoteName: "origin",
    })

    expect(run).toHaveBeenCalledWith(expect.objectContaining({ args: ["commit", "--allow-empty", "-m", "Initial commit"] }))
    expect(run).toHaveBeenCalledWith(expect.objectContaining({ args: ["push", "--set-upstream", "origin", "main"] }))
  })

  it("protects ignored files during remote initialization checkout", async () => {
    const run = vi.fn(async (input: { args: string[] }) => ({
      stdout: input.args[0] === "ls-remote"
        ? "ref: refs/heads/main\tHEAD\nabc\tHEAD\nabc\trefs/heads/main\n"
        : "",
      stderr: "",
    }))
    const getSnapshot = vi.fn().mockResolvedValue({
      changes: [], changeCount: 0, behind: 0, ahead: 0,
      currentBranch: "main", hasCommits: false, trackingStatus: "untracked",
    })
    const service = createGitSyncService({ commandRunner: { run }, getSnapshot })

    await service.initialize(repository, { kind: "track-remote", branchName: "main", remoteName: "origin" })

    expect(run).toHaveBeenCalledWith(expect.objectContaining({
      args: ["checkout", "--no-overwrite-ignore", "--track", "-b", "main", "origin/main"],
    }))
  })

  it("rechecks local and remote state before changing an uninitialized repository", async () => {
    const cleanSnapshot = {
      changes: [],
      changeCount: 0,
      behind: 0,
      ahead: 0,
      currentBranch: "main",
      hasCommits: false,
      trackingStatus: "untracked" as const,
    }
    const getSnapshot = vi.fn()
      .mockResolvedValueOnce(cleanSnapshot)
      .mockResolvedValueOnce({
        ...cleanSnapshot,
        changes: [{ path: "README.md", status: "untracked" }],
        changeCount: 1,
      })
    const run = vi.fn()
    const service = createGitSyncService({ commandRunner: { run }, getSnapshot })

    await expect(service.initialize(repository, {
      branchName: "main",
      kind: "create-and-push",
      message: "Initial commit",
      remoteName: "origin",
    })).rejects.toThrow("请先提交本地改动")
    expect(run).not.toHaveBeenCalled()
  })

  it("does not create another commit when retrying after the initial push failed", async () => {
    let hasCommits = false
    let pushAttempts = 0
    const getSnapshot = vi.fn().mockImplementation(async () => ({
      changes: [],
      changeCount: 0,
      behind: 0,
      ahead: 0,
      currentBranch: "main",
      hasCommits,
      trackingStatus: "untracked" as const,
    }))
    const run = vi.fn().mockImplementation(async (input: { args: string[] }) => {
      if (input.args[0] === "commit") hasCommits = true
      if (input.args[0] === "push" && pushAttempts++ === 0) throw new Error("network unavailable")
      return { stdout: "", stderr: "" }
    })
    const service = createGitSyncService({ commandRunner: { run }, getSnapshot })
    const input = {
      branchName: "main",
      kind: "create-and-push" as const,
      message: "Initial commit",
      remoteName: "origin",
    }

    await expect(service.initialize(repository, input)).rejects.toThrow("network unavailable")
    await expect(service.initialize(repository, input)).resolves.toMatchObject({ message: "已推送初始提交。" })

    expect(run.mock.calls.filter(([call]) => call.args[0] === "commit")).toHaveLength(1)
    expect(run.mock.calls.filter(([call]) => call.args[0] === "push")).toHaveLength(2)
  })

  it("rejects ordinary push before the first commit", async () => {
    const run = vi.fn()
    const getSnapshot = vi.fn().mockResolvedValue({
      changes: [],
      changeCount: 0,
      behind: 0,
      ahead: 0,
      currentBranch: "main",
      hasCommits: false,
      trackingStatus: "untracked",
    })
    const service = createGitSyncService({ commandRunner: { run }, getSnapshot })

    await expect(service.push(repository, "origin")).rejects.toThrow("仓库尚无提交")
    expect(run).not.toHaveBeenCalled()
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
    const run = vi.fn(async (input: { readonly args: readonly string[] }) => {
      if (input.args[0] === "symbolic-ref") return { stdout: "main\n", stderr: "" }
      if (input.args[0] === "for-each-ref") return { stdout: "main\ndocs-update\n", stderr: "" }
      if (input.args[0] === "check-ref-format") return { stdout: `${input.args.at(-1)}\n`, stderr: "" }
      return { stdout: "", stderr: "" }
    })
    const service = createGitBranchService({ commandRunner: { run }, getSnapshot: vi.fn().mockResolvedValue({ changes: [] }) })

    await expect(service.list(repository)).resolves.toEqual([
      { name: "main", current: true },
      { name: "docs-update", current: false },
    ])
    await service.checkout(repository, "docs-update")
    await service.create(repository, "new-docs")

    expect(run).toHaveBeenCalledWith(expect.objectContaining({ cwd: "/repo", args: ["checkout", "--no-overwrite-ignore", "docs-update"] }))
    expect(run).toHaveBeenCalledWith(expect.objectContaining({ cwd: "/repo", args: ["checkout", "-b", "new-docs"] }))
    expect(run).toHaveBeenCalledWith(expect.objectContaining({
      args: ["symbolic-ref", "--quiet", "--short", "HEAD"],
      acceptedExitCodes: [0, 1],
    }))
    expect(run).toHaveBeenCalledWith(expect.objectContaining({
      args: ["for-each-ref", "--format=%(refname:short)", "refs/heads"],
    }))
  })

  it("groups cached remote branches and excludes remote HEAD symbolic refs", async () => {
    const run = vi.fn(async (input: { readonly args: readonly string[] }) => ({
      stdout: input.args[0] === "remote"
        ? "origin\nupstream\n"
        : [
            "origin/HEAD\u0000refs/remotes/origin/main",
            "origin/main\u0000",
            "origin/docs/topic\u0000",
            "upstream/main\u0000",
          ].join("\n"),
      stderr: "",
    }))
    const service = createGitBranchService({ commandRunner: { run }, getSnapshot: vi.fn() })

    await expect(service.listRemote(repository)).resolves.toEqual([
      {
        remoteName: "origin",
        branches: [
          { name: "docs/topic", fullName: "origin/docs/topic" },
          { name: "main", fullName: "origin/main" },
        ],
      },
      {
        remoteName: "upstream",
        branches: [{ name: "main", fullName: "upstream/main" }],
      },
    ])
  })

  it("matches remote branches against the longest configured remote name", async () => {
    const run = vi.fn(async (input: { readonly args: readonly string[] }) => ({
      stdout: input.args[0] === "remote"
        ? "team\nteam/upstream\n"
        : "team/main\u0000\nteam/upstream/main\u0000",
      stderr: "",
    }))
    const service = createGitBranchService({ commandRunner: { run }, getSnapshot: vi.fn() })

    await expect(service.listRemote(repository)).resolves.toEqual([
      { remoteName: "team", branches: [{ name: "main", fullName: "team/main" }] },
      { remoteName: "team/upstream", branches: [{ name: "main", fullName: "team/upstream/main" }] },
    ])
  })

  it("fetches all remote branch caches only on explicit request", async () => {
    const run = vi.fn().mockResolvedValue({ stdout: "", stderr: "" })
    const service = createGitBranchService({ commandRunner: { run }, getSnapshot: vi.fn() })
    const controller = new AbortController()

    await service.fetchRemote(repository, { operationId: "fetch-remote-1", signal: controller.signal })

    expect(run).toHaveBeenCalledWith(expect.objectContaining({
      args: ["fetch", "--all", "--prune"],
      abortSignal: controller.signal,
      operationId: "fetch-remote-1",
    }))
  })

  it("creates a tracking branch when checking out a cached remote branch", async () => {
    const run = vi.fn(async (input: { readonly args: readonly string[] }) => {
      const args = input.args
      if (args[0] === "remote") return { stdout: "origin\nupstream\n", stderr: "" }
      if (args[0] === "check-ref-format") return { stdout: `${args.at(-1)}\n`, stderr: "" }
      if (args[0] === "rev-parse" && args.includes("refs/remotes/origin/docs/topic")) return { stdout: "abc\n", stderr: "" }
      if (args[0] === "rev-parse") return { stdout: "", stderr: "" }
      if (args[0] === "worktree") return { stdout: "", stderr: "" }
      return { stdout: "", stderr: "" }
    })
    const service = createGitBranchService({
      commandRunner: { run },
      getSnapshot: vi.fn().mockResolvedValue({ changeCount: 0, changes: [] }),
    })

    await expect(service.checkoutRemote(repository, {
      remoteName: "origin",
      branchName: "docs/topic",
      localBranchName: "docs/topic",
    })).resolves.toEqual({
      created: true,
      localBranchName: "docs/topic",
      remoteBranchName: "origin/docs/topic",
    })
    expect(run).toHaveBeenCalledWith(expect.objectContaining({
      args: ["checkout", "--no-overwrite-ignore", "-b", "docs/topic", "--track", "origin/docs/topic"],
    }))
  })

  it("switches an existing local branch when it already tracks the selected remote branch", async () => {
    const run = vi.fn(async (input: { readonly args: readonly string[] }) => {
      const args = input.args
      if (args[0] === "remote") return { stdout: "origin\n", stderr: "" }
      if (args[0] === "check-ref-format") return { stdout: `${args.at(-1)}\n`, stderr: "" }
      if (args[0] === "rev-parse") return { stdout: "abc\n", stderr: "" }
      if (args[0] === "for-each-ref") return { stdout: "origin/docs/topic\n", stderr: "" }
      if (args[0] === "symbolic-ref") return { stdout: "docs/topic\n", stderr: "" }
      if (args[0] === "worktree") return { stdout: "worktree /repo\nHEAD abc\nbranch refs/heads/docs/topic\n", stderr: "" }
      return { stdout: "", stderr: "" }
    })
    const service = createGitBranchService({
      commandRunner: { run },
      getSnapshot: vi.fn().mockResolvedValue({ changeCount: 0, changes: [] }),
    })

    await expect(service.checkoutRemote(repository, {
      remoteName: "origin",
      branchName: "docs/topic",
      localBranchName: "docs/topic",
    })).resolves.toEqual({
      created: false,
      localBranchName: "docs/topic",
      remoteBranchName: "origin/docs/topic",
    })
    expect(run).toHaveBeenCalledWith(expect.objectContaining({ args: ["checkout", "--no-overwrite-ignore", "docs/topic"] }))
  })

  it("uses Git native validation for remote and local branch names", async () => {
    const run = vi.fn(async (input: { readonly args: readonly string[] }) => (
      input.args[0] === "check-ref-format"
        ? { stdout: "", stderr: "fatal: invalid branch name" }
        : { stdout: "", stderr: "" }
    ))
    const service = createGitBranchService({
      commandRunner: { run },
      getSnapshot: vi.fn().mockResolvedValue({ changeCount: 0, changes: [] }),
    })

    await expect(service.checkoutRemote(repository, {
      remoteName: "origin",
      branchName: "bad..name",
      localBranchName: "topic",
    })).rejects.toThrow("分支名称不合法")
    expect(run).toHaveBeenCalledWith(expect.objectContaining({
      args: ["check-ref-format", "--branch", "bad..name"],
      acceptedExitCodes: [0, 1],
    }))
  })

  it("requires another local name when an existing branch tracks a different upstream", async () => {
    const run = vi.fn(async (input: { readonly args: readonly string[] }) => {
      const args = input.args
      if (args[0] === "remote") return { stdout: "origin\n", stderr: "" }
      if (args[0] === "check-ref-format") return { stdout: `${args.at(-1)}\n`, stderr: "" }
      if (args[0] === "rev-parse") return { stdout: "abc\n", stderr: "" }
      if (args[0] === "for-each-ref") return { stdout: "upstream/docs/topic\n", stderr: "" }
      if (args[0] === "worktree") return { stdout: "", stderr: "" }
      return { stdout: "", stderr: "" }
    })
    const service = createGitBranchService({
      commandRunner: { run },
      getSnapshot: vi.fn().mockResolvedValue({ changeCount: 0, changes: [] }),
    })

    await expect(service.checkoutRemote(repository, {
      remoteName: "origin",
      branchName: "docs/topic",
      localBranchName: "docs/topic",
    })).rejects.toThrow("其他本地名称")
  })

  it("blocks checkout when the local tracking branch is used by another worktree", async () => {
    const run = vi.fn(async (input: { readonly args: readonly string[] }) => {
      const args = input.args
      if (args[0] === "remote") return { stdout: "origin\n", stderr: "" }
      if (args[0] === "check-ref-format") return { stdout: `${args.at(-1)}\n`, stderr: "" }
      if (args[0] === "rev-parse") return { stdout: "abc\n", stderr: "" }
      if (args[0] === "for-each-ref") return { stdout: "origin/main\n", stderr: "" }
      if (args[0] === "worktree") return { stdout: "worktree /tmp/other\nHEAD abc\nbranch refs/heads/main\n", stderr: "" }
      return { stdout: "", stderr: "" }
    })
    const service = createGitBranchService({
      commandRunner: { run },
      getSnapshot: vi.fn().mockResolvedValue({ changeCount: 0, changes: [] }),
    })

    await expect(service.checkoutRemote(repository, {
      remoteName: "origin",
      branchName: "main",
      localBranchName: "main",
    })).rejects.toThrow("其他 Worktree")
  })

  it("reads current branch history and commit details", async () => {
    const hash = "a".repeat(40)
    const run = vi.fn()
      .mockResolvedValueOnce({ stdout: `${hash}\x1fa1b2c3d\x1f\x1f张三\x1fzhang@example.com\x1f2026-06-17T10:00:00+08:00\x1e`, stderr: "" })
      .mockResolvedValueOnce({ stdout: `${hash}\x1fa1b2c3d\x1f更新文档\x1f张三\x1fzhang@example.com\x1f2026-06-17T10:00:00+08:00\x1f${"b".repeat(40)}`, stderr: "" })
      .mockResolvedValueOnce({ stdout: `R100\0docs/旧 名称.md\0docs/新 名称.md\0M\0docs/中文.md\0`, stderr: "" })
      .mockResolvedValueOnce({ stdout: "diff --git a/docs/a.md b/docs/a.md\n+hello\n", stderr: "" })
    const service = createGitHistoryService({ commandRunner: { run } })

    await expect(service.list(repository, { limit: 20, offset: 0 })).resolves.toMatchObject([{ subject: "" }])
    await expect(service.getCommit(repository, hash)).resolves.toMatchObject({
      hash,
      shortHash: "a1b2c3d",
      subject: "更新文档",
      files: [
        { path: "docs/新 名称.md", originalPath: "docs/旧 名称.md", status: "renamed" },
        { path: "docs/中文.md", originalPath: null, status: "modified" },
      ],
      diff: "diff --git a/docs/a.md b/docs/a.md\n+hello\n",
      filesTruncated: false,
      diffTruncated: false,
      truncated: false,
    })
    expect(run).toHaveBeenNthCalledWith(3, expect.objectContaining({
      maxBufferBytes: 2 * 1024 * 1024,
      outputOverflow: "truncate",
    }))
    expect(run).toHaveBeenNthCalledWith(4, expect.objectContaining({
      maxBufferBytes: 2 * 1024 * 1024,
      outputOverflow: "truncate",
    }))
    expect(run).toHaveBeenNthCalledWith(3, expect.objectContaining({
      args: ["diff", "--name-status", "-z", "--find-renames", "b".repeat(40), hash],
    }))
  })

  it("rejects commit detail arguments that are not full object ids", async () => {
    const run = vi.fn()
    const service = createGitHistoryService({ commandRunner: { run } })

    await expect(service.getCommit(repository, "--output=/tmp/synapse-owned")).rejects.toThrow("提交标识不合法")
    expect(run).not.toHaveBeenCalled()
  })

  it("reads a root commit against the empty tree and keeps truncation flags independent", async () => {
    const hash = "a".repeat(40)
    const run = vi.fn()
      .mockResolvedValueOnce({
        stdout: `${hash}\x1fa1b2c3d\x1finitial\x1f张三\x1fzhang@example.com\x1f2026-06-17T10:00:00+08:00\x1f`,
        stderr: "",
      })
      .mockResolvedValueOnce({ stdout: "A\0README.md\0", stderr: "", stdoutTruncated: true })
      .mockResolvedValueOnce({ stdout: "diff --git a/README.md b/README.md\n+hello\n", stderr: "", stdoutTruncated: false })
    const service = createGitHistoryService({ commandRunner: { run } })

    await expect(service.getCommit(repository, hash)).resolves.toMatchObject({
      files: [{ path: "README.md", originalPath: null, status: "added" }],
      filesTruncated: true,
      diffTruncated: false,
      truncated: true,
    })
    expect(run).toHaveBeenNthCalledWith(2, expect.objectContaining({
      args: ["diff-tree", "--root", "--no-commit-id", "--name-status", "-z", "-r", "--find-renames", hash],
    }))
    expect(run).toHaveBeenNthCalledWith(3, expect.objectContaining({
      args: ["show", "--format=", "--patch", "--root", hash],
    }))
  })

  it("accepts the history pagination boundaries", async () => {
    const run = vi.fn().mockResolvedValue({ stdout: "", stderr: "" })
    const service = createGitHistoryService({ commandRunner: { run } })

    await expect(service.list(repository, { limit: 1, offset: Number.MAX_SAFE_INTEGER })).resolves.toEqual([])
    await expect(service.list(repository, { limit: 100, offset: 0 })).resolves.toEqual([])
    expect(run).toHaveBeenNthCalledWith(1, expect.objectContaining({
      args: expect.arrayContaining(["--max-count", "1", "--skip", String(Number.MAX_SAFE_INTEGER)]),
    }))
    expect(run).toHaveBeenNthCalledWith(2, expect.objectContaining({
      args: expect.arrayContaining(["--max-count", "100", "--skip", "0"]),
    }))
  })

  it("rejects unsafe history pagination before invoking Git", async () => {
    const run = vi.fn()
    const service = createGitHistoryService({ commandRunner: { run } })

    for (const input of [
      { limit: 0, offset: 0 },
      { limit: 101, offset: 0 },
      { limit: 1.5, offset: 0 },
      { limit: 20, offset: -1 },
      { limit: 20, offset: 0.5 },
      { limit: 20, offset: Number.MAX_SAFE_INTEGER + 1 },
    ]) {
      await expect(service.list(repository, input)).rejects.toThrow("分页参数不合法")
    }
    expect(run).not.toHaveBeenCalled()
  })
})
