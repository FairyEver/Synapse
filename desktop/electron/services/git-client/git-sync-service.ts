import type { SynapseGitOperationResult, SynapseGitPushTarget, SynapseGitRepository, SynapseGitRepositorySnapshot } from "../../../src/types/git"
import type { StructuredLogger } from "../../runtime/logging"
import type { GitClientCommandRunner } from "./git-command-runner"
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
  readonly getSnapshot: (repository: SynapseGitRepository) => Promise<Pick<SynapseGitRepositorySnapshot, "changes" | "ahead" | "behind" | "currentBranch" | "trackingStatus">>
  readonly logger?: Pick<StructuredLogger, "error" | "info" | "warn">
  readonly now?: () => Date
}

type SyncOperationOptions = {
  readonly operationId?: string
  readonly signal?: AbortSignal
}

export function createGitSyncService(deps: SyncDeps) {
  const now = deps.now ?? (() => new Date())

  function result(message: string): SynapseGitOperationResult {
    return { completedAt: now().toISOString(), message }
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

  return {
    listPushTargets,

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
        await deps.commandRunner.run({
          cwd: repository.localPath,
          args: ["pull", "--ff-only"],
          abortSignal: options.signal,
          operation: "git.pull",
          operationId,
          repoPath: repository.localPath,
          repositoryId: repository.id,
          timeoutMs: 120_000,
        })
        return result("已拉取远程更新。")
      })
    },

    async push(repository: SynapseGitRepository, remoteName?: string, options: SyncOperationOptions = {}): Promise<SynapseGitOperationResult> {
      return runRemoteOperation("git.push", repository, options, async (operationId) => {
        const snapshot = await deps.getSnapshot(repository)
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
        if (before.changes.length > 0) {
          logGitOperationBlocked(deps.logger ?? noopLogger, operation, operationId, "working-tree-dirty", beforeMeta)
          throw new Error("请先提交本地改动。")
        }
        if (before.trackingStatus === "detached") throw new Error("请先切换到本地分支。")
        if (before.trackingStatus === "untracked") throw new Error("请先执行首次推送并选择远端。")

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
        if (afterFetch.behind > 0) {
          await deps.commandRunner.run({
            cwd: repository.localPath,
            args: ["pull", "--ff-only"],
            abortSignal: options.signal,
            operation,
            operationId,
            repoPath: repository.localPath,
            repositoryId: repository.id,
            timeoutMs: 120_000,
          })
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

  async function runRemoteOperation(
    operation: "git.fetch" | "git.pull" | "git.push",
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

function summarizeSyncSnapshot(snapshot: Pick<SynapseGitRepositorySnapshot, "changes" | "ahead" | "behind">): Record<string, unknown> {
  return summarizeSnapshot({
    currentBranch: null,
    upstream: null,
    hasConflicts: snapshot.changes.some((change) => change.conflicted),
    ...snapshot,
  })
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
