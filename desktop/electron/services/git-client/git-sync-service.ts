import type {
  SynapseGitInitializationPlan,
  SynapseGitOperationResult,
  SynapseGitPushTarget,
  SynapseGitRepository,
  SynapseGitRepositorySnapshot,
} from "../../../src/types/git"
import type { StructuredLogger } from "../../runtime/logging"
import type { GitClientCommandRunner } from "./git-command-runner"
import { assertNoIgnoredPathCollisions } from "../git-working-tree-safety"
import {
  createGitOperationId,
  gitErrorMeta,
  logGitOperationBlocked,
  logGitOperationFailed,
  logGitOperationStarted,
  logGitOperationSucceeded,
  repositoryLogMeta,
  sanitizeRemoteUrl,
  summarizeSnapshot,
} from "./git-logging"

type SyncDeps = {
  readonly commandRunner: Pick<GitClientCommandRunner, "run">
  readonly getSnapshot: (repository: SynapseGitRepository) => Promise<Pick<SynapseGitRepositorySnapshot, "changeCount" | "changes" | "ahead" | "behind" | "currentBranch" | "hasCommits" | "trackingStatus">>
  readonly logger?: Pick<StructuredLogger, "error" | "info" | "warn">
  readonly now?: () => Date
}

type SyncOperationOptions = {
  readonly operationId?: string
  readonly signal?: AbortSignal
}

type InitializeRepositoryInput = {
  readonly branchName: string
  readonly kind: SynapseGitInitializationPlan["kind"]
  readonly message?: string
  readonly remoteName: string
}

export function createGitSyncService(deps: SyncDeps) {
  const now = deps.now ?? (() => new Date())

  function result(message: string): SynapseGitOperationResult {
    return { completedAt: now().toISOString(), message }
  }

  async function assertIntegrationSafe(
    repository: SynapseGitRepository,
    operation: string,
    operationId: string,
  ): Promise<void> {
    await assertNoIgnoredPathCollisions({
      target: "@{u}",
      run: (args, streamOptions) => deps.commandRunner.run({
        args,
        cwd: repository.localPath,
        ...streamOptions,
        operation,
        operationId,
        repoPath: repository.localPath,
        repositoryId: repository.id,
      }),
    })
  }

  async function mergeUpstream(
    repository: SynapseGitRepository,
    operation: string,
    operationId: string,
    options: SyncOperationOptions,
  ): Promise<void> {
    await assertIntegrationSafe(repository, operation, operationId)
    await deps.commandRunner.run({
      cwd: repository.localPath,
      args: ["merge", "--ff-only", "--no-overwrite-ignore", "@{u}"],
      abortSignal: options.signal,
      operation,
      operationId,
      repoPath: repository.localPath,
      repositoryId: repository.id,
      timeoutMs: 120_000,
    })
  }

  async function listPushTargets(repository: SynapseGitRepository): Promise<SynapseGitPushTarget[]> {
      const snapshot = await deps.getSnapshot(repository)
      if (!snapshot.currentBranch) return []
      const remotesResult = await deps.commandRunner.run({
        args: ["remote"],
        cwd: repository.localPath,
        operation: "git.pushTargets",
        repoPath: repository.localPath,
        repositoryId: repository.id,
      })
      const names = remotesResult.stdout.split(/\r?\n/).map((name) => name.trim()).filter(Boolean)
      const targets = await Promise.all(names.map(async (name) => {
        const result = await deps.commandRunner.run({
          args: ["remote", "get-url", "--push", name],
          cwd: repository.localPath,
          operation: "git.pushTargets",
          repoPath: repository.localPath,
          repositoryId: repository.id,
        })
        return { name, url: sanitizeRemoteUrl(result.stdout.trim()) }
      }))
      const branchPushRemote = await readOptionalConfig(`branch.${snapshot.currentBranch}.pushRemote`, repository)
      const remotePushDefault = branchPushRemote ? null : await readOptionalConfig("remote.pushDefault", repository)
      const branchRemote = branchPushRemote || remotePushDefault
        ? null
        : await readOptionalConfig(`branch.${snapshot.currentBranch}.remote`, repository)
      const preferredName = branchPushRemote
        ?? remotePushDefault
        ?? (branchRemote && branchRemote !== "." ? branchRemote : null)
        ?? (names.includes("origin") ? "origin" : names.length === 1 ? names[0] ?? null : null)
    return targets.map((target) => ({ ...target, preferred: target.name === preferredName }))
  }

  async function inspectInitialization(
    repository: SynapseGitRepository,
    remoteName?: string,
    options: SyncOperationOptions = {},
  ): Promise<SynapseGitInitializationPlan> {
    const operation = "git.inspectInitialization"
    const operationId = options.operationId ?? createGitOperationId()
    const snapshot = await deps.getSnapshot(repository)
    assertInitializationAllowed(snapshot)
    const selectedName = await resolvePushTargetName(repository, remoteName)
    const remote = await deps.commandRunner.run({
      args: ["ls-remote", "--symref", selectedName, "HEAD", "refs/heads/*"],
      abortSignal: options.signal,
      cwd: repository.localPath,
      operation,
      operationId,
      repoPath: repository.localPath,
      repositoryId: repository.id,
      timeoutMs: 120_000,
    })
    const remoteBranch = resolveRemoteBranch(remote.stdout)
    return remoteBranch
      ? { kind: "track-remote", branchName: remoteBranch, remoteName: selectedName }
      : { kind: "create-and-push", branchName: snapshot.currentBranch!, remoteName: selectedName }
  }

  async function pushCurrentBranch(
    repository: SynapseGitRepository,
    remoteName: string,
    branchName: string,
    operation: string,
    operationId: string,
    options: SyncOperationOptions,
  ): Promise<void> {
    await deps.commandRunner.run({
      args: ["push", "--set-upstream", remoteName, branchName],
      abortSignal: options.signal,
      cwd: repository.localPath,
      operation,
      operationId,
      repoPath: repository.localPath,
      repositoryId: repository.id,
      timeoutMs: 120_000,
    })
  }

  return {
    inspectInitialization,
    listPushTargets,

    async initialize(
      repository: SynapseGitRepository,
      input: InitializeRepositoryInput,
      options: SyncOperationOptions = {},
    ): Promise<SynapseGitOperationResult> {
      return runRemoteOperation("git.initialize", repository, options, async (operationId) => {
        const snapshot = await deps.getSnapshot(repository)
        if (snapshot.hasCommits !== false) {
          if (snapshot.trackingStatus === "tracked") return result("仓库已连接远端。")
          if (!snapshot.currentBranch || snapshot.trackingStatus === "detached") throw new Error("请先切换到本地分支。")
          await pushCurrentBranch(repository, input.remoteName, snapshot.currentBranch, "git.initialize", operationId, options)
          return result("已推送初始提交。")
        }

        const currentPlan = await inspectInitialization(repository, input.remoteName, { ...options, operationId })
        if (currentPlan.kind !== input.kind || currentPlan.branchName !== input.branchName) {
          throw new Error("远端状态已变化，请重新检查后继续。")
        }

        if (currentPlan.kind === "create-and-push") {
          const message = input.message?.trim()
          if (!message) throw new Error("请输入提交说明。")
          await deps.commandRunner.run({
            args: ["commit", "--allow-empty", "-m", message],
            abortSignal: options.signal,
            cwd: repository.localPath,
            operation: "git.initialize",
            operationId,
            repoPath: repository.localPath,
            repositoryId: repository.id,
          })
          await pushCurrentBranch(repository, input.remoteName, currentPlan.branchName, "git.initialize", operationId, options)
          return result("已初始化并推送仓库。")
        }

        await deps.commandRunner.run({
          args: ["check-ref-format", "--branch", currentPlan.branchName],
          abortSignal: options.signal,
          cwd: repository.localPath,
          operation: "git.initialize",
          operationId,
          repoPath: repository.localPath,
          repositoryId: repository.id,
        })
        await deps.commandRunner.run({
          args: ["fetch", "--prune", input.remoteName],
          abortSignal: options.signal,
          cwd: repository.localPath,
          operation: "git.initialize",
          operationId,
          repoPath: repository.localPath,
          repositoryId: repository.id,
          timeoutMs: 120_000,
        })
        await assertNoIgnoredPathCollisions({
          target: `${input.remoteName}/${currentPlan.branchName}`,
          run: (args, streamOptions) => deps.commandRunner.run({
            args,
            cwd: repository.localPath,
            ...streamOptions,
            operation: "git.initialize",
            operationId,
            repoPath: repository.localPath,
            repositoryId: repository.id,
          }),
        })
        const localBranch = await deps.commandRunner.run({
          acceptedExitCodes: [0, 1],
          args: ["rev-parse", "--verify", "--quiet", `refs/heads/${currentPlan.branchName}`],
          cwd: repository.localPath,
          operation: "git.initialize",
          operationId,
          repoPath: repository.localPath,
          repositoryId: repository.id,
        })
        if (localBranch.stdout.trim()) throw new Error("本地已有同名分支，请进入仓库选择分支。")
        await deps.commandRunner.run({
          args: ["checkout", "--track", "-b", currentPlan.branchName, `${input.remoteName}/${currentPlan.branchName}`],
          abortSignal: options.signal,
          cwd: repository.localPath,
          operation: "git.initialize",
          operationId,
          repoPath: repository.localPath,
          repositoryId: repository.id,
        })
        return result("已获取远端内容。")
      })
    },

    async fetch(repository: SynapseGitRepository, options: SyncOperationOptions = {}): Promise<SynapseGitOperationResult> {
      return runRemoteOperation("git.fetch", repository, options, async (operationId) => {
        await deps.commandRunner.run({
          cwd: repository.localPath,
          args: ["fetch", "--prune"],
          abortSignal: options.signal,
          operation: "git.fetch",
          operationId,
          repoPath: repository.localPath,
          repositoryId: repository.id,
          timeoutMs: 120_000,
        })
        return result("已获取远程更新。")
      })
    },

    async pull(repository: SynapseGitRepository, options: SyncOperationOptions = {}): Promise<SynapseGitOperationResult> {
      return runRemoteOperation("git.pull", repository, options, async (operationId) => {
        assertAutomaticIntegrationAllowed(await deps.getSnapshot(repository))
        await deps.commandRunner.run({
          cwd: repository.localPath,
          args: ["fetch", "--prune"],
          abortSignal: options.signal,
          operation: "git.pull",
          operationId,
          repoPath: repository.localPath,
          repositoryId: repository.id,
          timeoutMs: 120_000,
        })
        const afterFetch = await deps.getSnapshot(repository)
        assertAutomaticIntegrationAllowed(afterFetch)
        if (afterFetch.behind > 0) {
          await mergeUpstream(repository, "git.pull", operationId, options)
        }
        return result("已拉取远程更新。")
      })
    },

    async push(repository: SynapseGitRepository, remoteName?: string, options: SyncOperationOptions = {}): Promise<SynapseGitOperationResult> {
      return runRemoteOperation("git.push", repository, options, async (operationId) => {
        const snapshot = await deps.getSnapshot(repository)
        if (snapshot.hasCommits === false) throw new Error("仓库尚无提交，请先初始化仓库。")
        let args = ["push"]
        if (snapshot.trackingStatus === "detached") {
          throw new Error("请先切换到本地分支。")
        }
        if (snapshot.trackingStatus === "untracked") {
          if (!snapshot.currentBranch) throw new Error("请先切换到本地分支。")
          const targets = remoteName ? [] : await listPushTargets(repository)
          const selectedName = remoteName ?? (targets.length === 1 ? targets[0]?.name : undefined)
          if (!selectedName) {
            throw new Error(targets.length === 0 ? "仓库没有可推送的远端。" : "请选择推送远端。")
          }
          args = ["push", "--set-upstream", selectedName, snapshot.currentBranch]
        }
        await deps.commandRunner.run({
          cwd: repository.localPath,
          args,
          abortSignal: options.signal,
          operation: "git.push",
          operationId,
          repoPath: repository.localPath,
          repositoryId: repository.id,
          timeoutMs: 120_000,
        })
        return result("已推送本地提交。")
      })
    },

    async sync(repository: SynapseGitRepository, options: SyncOperationOptions = {}): Promise<SynapseGitOperationResult> {
      const operation = "git.sync"
      const operationId = options.operationId ?? createGitOperationId()
      const startedAt = performance.now()
      const baseMeta = repositoryLogMeta(repository)
      logGitOperationStarted(deps.logger ?? noopLogger, operation, operationId, baseMeta)
      try {
        const before = await deps.getSnapshot(repository)
        const beforeMeta = {
          ...baseMeta,
          before: summarizeSyncSnapshot(before),
        }
        if ((before.changeCount ?? before.changes.length) > 0) {
          logGitOperationBlocked(deps.logger ?? noopLogger, operation, operationId, "working-tree-dirty", beforeMeta)
          throw new Error("请先提交本地改动。")
        }
        if (before.trackingStatus === "detached") throw new Error("请先切换到本地分支。")
        if (before.trackingStatus === "untracked") throw new Error("请先执行首次推送并选择远端。")
        assertAutomaticIntegrationAllowed(before)

        await deps.commandRunner.run({
          cwd: repository.localPath,
          args: ["fetch", "--prune"],
          abortSignal: options.signal,
          operation,
          operationId,
          repoPath: repository.localPath,
          repositoryId: repository.id,
          timeoutMs: 120_000,
        })
        const afterFetch = await deps.getSnapshot(repository)
        assertAutomaticIntegrationAllowed(afterFetch)
        if (afterFetch.behind > 0) {
          await mergeUpstream(repository, operation, operationId, options)
        }
        const afterPull = afterFetch.behind > 0
          ? await deps.getSnapshot(repository)
          : afterFetch
        if (afterPull.behind > 0) {
          logGitOperationBlocked(deps.logger ?? noopLogger, operation, operationId, "remote-still-behind", {
            ...baseMeta,
            before: summarizeSyncSnapshot(before),
            afterPull: summarizeSyncSnapshot(afterPull),
          })
          throw new Error("远程仍有未拉取提交，请手动处理后重试。")
        }
        if (afterPull.ahead > 0) {
          await deps.commandRunner.run({
            cwd: repository.localPath,
            args: ["push"],
            abortSignal: options.signal,
            operation,
            operationId,
            repoPath: repository.localPath,
            repositoryId: repository.id,
            timeoutMs: 120_000,
          })
        }
        logGitOperationSucceeded(deps.logger ?? noopLogger, operation, operationId, startedAt, {
          ...baseMeta,
          before: summarizeSyncSnapshot(before),
          afterPull: summarizeSyncSnapshot(afterPull),
        })
        return result("已同步仓库。")
      } catch (error) {
        if (!isWorkingTreeDirtyBlock(error)) {
          logGitOperationFailed(deps.logger ?? noopLogger, {
            operation,
            operationId,
            repositoryId: repository.id,
            repoPath: repository.localPath,
            startedAt,
            error,
            extra: baseMeta,
          })
        }
        throw error
      }
    },
  }

  async function readOptionalConfig(key: string, repository: SynapseGitRepository): Promise<string | null> {
    const result = await deps.commandRunner.run({
      acceptedExitCodes: [0, 1],
      args: ["config", "--get", key],
      cwd: repository.localPath,
      operation: "git.pushTargets",
      repoPath: repository.localPath,
      repositoryId: repository.id,
    })
    return result.stdout.trim() || null
  }

  async function resolvePushTargetName(repository: SynapseGitRepository, remoteName?: string): Promise<string> {
    if (remoteName) return remoteName
    const targets = await listPushTargets(repository)
    if (targets.length === 1) return targets[0]!.name
    const preferred = targets.find((target) => target.preferred)
    if (preferred) return preferred.name
    throw new Error(targets.length === 0 ? "仓库没有可推送的远端。" : "请选择推送远端。")
  }

  async function runRemoteOperation(
    operation: "git.fetch" | "git.initialize" | "git.pull" | "git.push",
    repository: SynapseGitRepository,
    options: SyncOperationOptions,
    action: (operationId: string) => Promise<SynapseGitOperationResult>,
  ): Promise<SynapseGitOperationResult> {
    const operationId = options.operationId ?? createGitOperationId()
    const startedAt = performance.now()
    const meta = repositoryLogMeta(repository)
    logGitOperationStarted(deps.logger ?? noopLogger, operation, operationId, meta)
    try {
      const operationResult = await action(operationId)
      const snapshot = await readSnapshotSummaryForLog(repository, operation, operationId)
      logGitOperationSucceeded(deps.logger ?? noopLogger, operation, operationId, startedAt, {
        ...meta,
        ...(snapshot ? { snapshot } : {}),
      })
      return operationResult
    } catch (error) {
      logGitOperationFailed(deps.logger ?? noopLogger, {
        operation,
        operationId,
        repositoryId: repository.id,
        repoPath: repository.localPath,
        startedAt,
        error,
        extra: meta,
      })
      throw error
    }
  }

  async function readSnapshotSummaryForLog(
    repository: SynapseGitRepository,
    operation: string,
    operationId: string,
  ): Promise<Record<string, unknown> | null> {
    try {
      const snapshot = await deps.getSnapshot(repository)
      return summarizeSyncSnapshot(snapshot)
    } catch (error) {
      deps.logger?.warn("Git operation snapshot summary failed.", {
        ...repositoryLogMeta(repository),
        operation,
        operationId,
        ...gitErrorMeta(error),
      })
      return null
    }
  }
}

function summarizeSyncSnapshot(snapshot: Pick<SynapseGitRepositorySnapshot, "changeCount" | "changes" | "ahead" | "behind">): Record<string, unknown> {
  return summarizeSnapshot({
    currentBranch: null,
    upstream: null,
    hasConflicts: snapshot.changes.some((change) => change.status === "conflicted"),
    ...snapshot,
  })
}

function assertAutomaticIntegrationAllowed(
  snapshot: Pick<SynapseGitRepositorySnapshot, "ahead" | "behind" | "trackingStatus">,
): void {
  if (snapshot.trackingStatus === "gone") {
    throw new Error("上游分支不存在，请重新推送或调整上游后重试。")
  }
  if (snapshot.ahead > 0 && snapshot.behind > 0) {
    throw new Error("本地分支与上游分支已分叉，请使用外部 Git 工具处理后重试。")
  }
}

function assertInitializationAllowed(
  snapshot: Pick<SynapseGitRepositorySnapshot, "changeCount" | "changes" | "currentBranch" | "hasCommits" | "trackingStatus">,
): void {
  if (snapshot.hasCommits !== false) throw new Error("仓库已有提交，无需初始化。")
  if (!snapshot.currentBranch || snapshot.trackingStatus === "detached") throw new Error("请先切换到本地分支。")
  if ((snapshot.changeCount ?? snapshot.changes.length) > 0) throw new Error("请先提交本地改动。")
}

function resolveRemoteBranch(output: string): string | null {
  let defaultBranch: string | null = null
  const branches = new Set<string>()
  for (const line of output.split(/\r?\n/)) {
    const [value, refName] = line.split("\t")
    if (refName === "HEAD" && value?.startsWith("ref: refs/heads/")) {
      defaultBranch = value.slice("ref: refs/heads/".length).trim() || null
      continue
    }
    if (refName?.startsWith("refs/heads/")) {
      const branchName = refName.slice("refs/heads/".length).trim()
      if (branchName) branches.add(branchName)
    }
  }
  if (defaultBranch && branches.has(defaultBranch)) return defaultBranch
  if (branches.size === 0) return null
  if (branches.size === 1) return [...branches][0] ?? null
  throw new Error("远端默认分支不明确，请进入仓库选择远端分支。")
}

const noopLogger = {
  error: () => undefined,
  info: () => undefined,
  warn: () => undefined,
}

function isWorkingTreeDirtyBlock(error: unknown): boolean {
  return error instanceof Error && error.message === "请先提交本地改动。"
}

export type GitSyncService = ReturnType<typeof createGitSyncService>
