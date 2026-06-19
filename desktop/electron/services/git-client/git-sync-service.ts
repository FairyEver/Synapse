import type { SynapseGitOperationResult, SynapseGitRepository, SynapseGitRepositorySnapshot } from "../../../src/types/git"
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
  summarizeSnapshot,
} from "./git-logging"

type SyncDeps = {
  readonly commandRunner: Pick<GitClientCommandRunner, "run">
  readonly getSnapshot: (repository: SynapseGitRepository) => Promise<Pick<SynapseGitRepositorySnapshot, "changes" | "ahead" | "behind">>
  readonly logger?: Pick<StructuredLogger, "error" | "info" | "warn">
  readonly now?: () => Date
}

export function createGitSyncService(deps: SyncDeps) {
  const now = deps.now ?? (() => new Date())

  function result(message: string): SynapseGitOperationResult {
    return { completedAt: now().toISOString(), message }
  }

  return {
    async fetch(repository: SynapseGitRepository): Promise<SynapseGitOperationResult> {
      return runRemoteOperation("git.fetch", repository, async (operationId) => {
        await deps.commandRunner.run({
          cwd: repository.localPath,
          args: ["fetch", "--prune"],
          operation: "git.fetch",
          operationId,
          repoPath: repository.localPath,
          repositoryId: repository.id,
          timeoutMs: 120_000,
        })
        return result("已获取远程更新。")
      })
    },

    async pull(repository: SynapseGitRepository): Promise<SynapseGitOperationResult> {
      return runRemoteOperation("git.pull", repository, async (operationId) => {
        await deps.commandRunner.run({
          cwd: repository.localPath,
          args: ["pull", "--ff-only"],
          operation: "git.pull",
          operationId,
          repoPath: repository.localPath,
          repositoryId: repository.id,
          timeoutMs: 120_000,
        })
        return result("已拉取远程更新。")
      })
    },

    async push(repository: SynapseGitRepository): Promise<SynapseGitOperationResult> {
      return runRemoteOperation("git.push", repository, async (operationId) => {
        await deps.commandRunner.run({
          cwd: repository.localPath,
          args: ["push"],
          operation: "git.push",
          operationId,
          repoPath: repository.localPath,
          repositoryId: repository.id,
          timeoutMs: 120_000,
        })
        return result("已推送本地提交。")
      })
    },

    async sync(repository: SynapseGitRepository): Promise<SynapseGitOperationResult> {
      const operation = "git.sync"
      const operationId = createGitOperationId()
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

        await deps.commandRunner.run({
          cwd: repository.localPath,
          args: ["fetch", "--prune"],
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

  async function runRemoteOperation(
    operation: "git.fetch" | "git.pull" | "git.push",
    repository: SynapseGitRepository,
    action: (operationId: string) => Promise<SynapseGitOperationResult>,
  ): Promise<SynapseGitOperationResult> {
    const operationId = createGitOperationId()
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
