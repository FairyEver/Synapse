import type { SynapseGitOperationResult, SynapseGitRepository, SynapseGitRepositorySnapshot } from "../../../src/types/git"
import { categorizeGitError } from "./git-command-runner"
import type { GitClientCommandRunner } from "./git-command-runner"
import {
  createGitLogger,
  createGitOperation,
  gitOperationBaseMeta,
  gitSnapshotLogMeta,
  logGitOperationFailure,
  logGitOperationStart,
  logGitOperationSuccess,
  type GitLogger,
} from "./git-log-utils"

type SyncDeps = {
  readonly commandRunner: Pick<GitClientCommandRunner, "run">
  readonly getSnapshot: (repository: SynapseGitRepository) => Promise<Pick<SynapseGitRepositorySnapshot, "changes" | "ahead" | "behind">>
  readonly logger?: GitLogger
  readonly now?: () => Date
}

const defaultLogger = createGitLogger("git.sync")

export function createGitSyncService(deps: SyncDeps) {
  const now = deps.now ?? (() => new Date())
  const logger = deps.logger ?? defaultLogger

  function result(message: string): SynapseGitOperationResult {
    return { completedAt: now().toISOString(), message }
  }

  async function runRemoteOperation(
    operationName: "git.fetch" | "git.pull" | "git.push",
    repository: SynapseGitRepository,
    args: readonly string[],
    message: string,
  ): Promise<SynapseGitOperationResult> {
    const operation = createGitOperation(operationName)
    logGitOperationStart(logger, "Git operation started.", operation, repository)
    try {
      await deps.commandRunner.run({
        cwd: repository.localPath,
        args,
        operation: operation.operation,
        operationId: operation.operationId,
        timeoutMs: 120_000,
      })
      const operationResult = result(message)
      logGitOperationSuccess(logger, "Git operation completed.", operation, repository)
      return operationResult
    } catch (error) {
      logGitOperationFailure(logger, "Git operation failed.", operation, error, repository, {
        errorCategory: categorizeGitError(error),
      })
      throw error
    }
  }

  return {
    async fetch(repository: SynapseGitRepository): Promise<SynapseGitOperationResult> {
      return runRemoteOperation("git.fetch", repository, ["fetch", "--prune"], "已获取远程更新。")
    },

    async pull(repository: SynapseGitRepository): Promise<SynapseGitOperationResult> {
      return runRemoteOperation("git.pull", repository, ["pull", "--ff-only"], "已拉取远程更新。")
    },

    async push(repository: SynapseGitRepository): Promise<SynapseGitOperationResult> {
      return runRemoteOperation("git.push", repository, ["push"], "已推送本地提交。")
    },

    async sync(repository: SynapseGitRepository): Promise<SynapseGitOperationResult> {
      const operation = createGitOperation("git.sync")
      logGitOperationStart(logger, "Git operation started.", operation, repository)
      try {
        const before = await deps.getSnapshot(repository)
        if (before.changes.length > 0) {
          logger.warn("Git operation blocked by dirty worktree.", {
            ...gitOperationBaseMeta(operation, repository),
            ...gitSnapshotLogMeta({
              ...before,
              currentBranch: null,
              hasConflicts: before.changes.some((change) => change.conflicted),
              isGitRepository: true,
              pathExists: true,
              upstream: null,
            }),
          })
          throw new Error("请先提交本地改动。")
        }

        await deps.commandRunner.run({
          cwd: repository.localPath,
          args: ["fetch", "--prune"],
          operation: operation.operation,
          operationId: operation.operationId,
          timeoutMs: 120_000,
        })
        if (before.behind > 0) {
          await deps.commandRunner.run({
            cwd: repository.localPath,
            args: ["pull", "--ff-only"],
            operation: operation.operation,
            operationId: operation.operationId,
            timeoutMs: 120_000,
          })
        }
        const afterPull = await deps.getSnapshot(repository)
        if (afterPull.ahead > 0) {
          await deps.commandRunner.run({
            cwd: repository.localPath,
            args: ["push"],
            operation: operation.operation,
            operationId: operation.operationId,
            timeoutMs: 120_000,
          })
        }
        const operationResult = result("已同步仓库。")
        logGitOperationSuccess(logger, "Git operation completed.", operation, repository, {
          before: {
            ahead: before.ahead,
            behind: before.behind,
            changeCount: before.changes.length,
          },
          afterPull: {
            ahead: afterPull.ahead,
            behind: afterPull.behind,
            changeCount: afterPull.changes.length,
          },
        })
        return operationResult
      } catch (error) {
        logGitOperationFailure(logger, "Git operation failed.", operation, error, repository, {
          errorCategory: categorizeGitError(error),
        })
        throw error
      }
    },
  }
}

export type GitSyncService = ReturnType<typeof createGitSyncService>
