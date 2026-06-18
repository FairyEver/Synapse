import type { SynapseGitOperationResult, SynapseGitRepository } from "../../../src/types/git"
import { categorizeGitError } from "./git-command-runner"
import type { GitClientCommandRunner } from "./git-command-runner"
import {
  createGitLogger,
  createGitOperation,
  logGitOperationFailure,
  logGitOperationStart,
  logGitOperationSuccess,
  type GitLogger,
} from "./git-log-utils"
import { assertRepositoryPath } from "./git-path-utils"

type CommitDeps = {
  readonly commandRunner: Pick<GitClientCommandRunner, "run">
  readonly logger?: GitLogger
  readonly now?: () => Date
}

const defaultLogger = createGitLogger("git.commit")

export function createGitCommitService(deps: CommitDeps) {
  const now = deps.now ?? (() => new Date())
  const logger = deps.logger ?? defaultLogger
  return {
    async commit(
      repository: SynapseGitRepository,
      input: { readonly message: string; readonly paths: readonly string[] },
    ): Promise<SynapseGitOperationResult> {
      const operation = createGitOperation("git.commit")
      const message = input.message.trim()
      if (!message) throw new Error("请输入提交说明。")
      if (input.paths.length === 0) throw new Error("请选择要提交的文件。")
      for (const filePath of input.paths) {
        assertRepositoryPath(repository.localPath, filePath)
      }

      logGitOperationStart(logger, "Git operation started.", operation, repository, {
        selectedPathCount: input.paths.length,
      })

      try {
        await deps.commandRunner.run({
          cwd: repository.localPath,
          args: ["add", "--", ...input.paths],
          operation: operation.operation,
          operationId: operation.operationId,
        })
        await deps.commandRunner.run({
          cwd: repository.localPath,
          args: ["commit", "-m", message],
          operation: operation.operation,
          operationId: operation.operationId,
        })
        const result = {
          completedAt: now().toISOString(),
          message: "已提交选中文件。",
        }
        logGitOperationSuccess(logger, "Git operation completed.", operation, repository, {
          selectedPathCount: input.paths.length,
        })
        return result
      } catch (error) {
        logGitOperationFailure(logger, "Git operation failed.", operation, error, repository, {
          errorCategory: categorizeGitError(error),
          selectedPathCount: input.paths.length,
        })
        throw error
      }
    },
  }
}

export type GitCommitService = ReturnType<typeof createGitCommitService>
