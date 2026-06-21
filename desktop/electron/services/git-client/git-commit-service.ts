import type { SynapseGitOperationResult, SynapseGitRepository } from "../../../src/types/git"
import type { StructuredLogger } from "../../runtime/logging"
import type { GitClientCommandRunner } from "./git-command-runner"
import { assertRepositoryPath } from "./git-path-utils"
import {
  createGitOperationId,
  logGitOperationBlocked,
  logGitOperationFailed,
  logGitOperationStarted,
  logGitOperationSucceeded,
  repositoryLogMeta,
} from "./git-logging"

type CommitDeps = {
  readonly commandRunner: Pick<GitClientCommandRunner, "run">
  readonly logger?: Pick<StructuredLogger, "error" | "info" | "warn">
  readonly now?: () => Date
}

export function createGitCommitService(deps: CommitDeps) {
  const now = deps.now ?? (() => new Date())
  return {
    async commit(
      repository: SynapseGitRepository,
      input: { readonly message: string; readonly paths: readonly string[] },
    ): Promise<SynapseGitOperationResult> {
      const operation = "git.commit"
      const operationId = createGitOperationId()
      const startedAt = performance.now()
      const message = input.message.trim()
      const meta = {
        ...repositoryLogMeta(repository),
        pathCount: input.paths.length,
        pathSamples: input.paths.slice(0, 5),
        messageLength: message.length,
      }
      logGitOperationStarted(deps.logger ?? noopLogger, operation, operationId, meta)
      if (!message) {
        logGitOperationBlocked(deps.logger ?? noopLogger, operation, operationId, "empty-message", meta)
        throw new Error("请输入提交说明。")
      }
      if (input.paths.length === 0) {
        logGitOperationBlocked(deps.logger ?? noopLogger, operation, operationId, "empty-paths", meta)
        throw new Error("请选择要提交的文件。")
      }
      try {
        for (const filePath of input.paths) {
          assertRepositoryPath(repository.localPath, filePath)
        }
        await deps.commandRunner.run({
          cwd: repository.localPath,
          args: ["add", "--", ...input.paths],
          operation,
          operationId,
          repoPath: repository.localPath,
          repositoryId: repository.id,
        })
        await deps.commandRunner.run({
          cwd: repository.localPath,
          args: ["commit", "-m", message, "--", ...input.paths],
          operation,
          operationId,
          repoPath: repository.localPath,
          repositoryId: repository.id,
        })
        logGitOperationSucceeded(deps.logger ?? noopLogger, operation, operationId, startedAt, meta)
        return {
          completedAt: now().toISOString(),
          message: "已提交选中文件。",
        }
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
    },
  }
}

const noopLogger = {
  error: () => undefined,
  info: () => undefined,
  warn: () => undefined,
}

export type GitCommitService = ReturnType<typeof createGitCommitService>
