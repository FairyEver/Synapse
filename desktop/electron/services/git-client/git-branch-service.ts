import type { SynapseGitBranch, SynapseGitRepository, SynapseGitRepositorySnapshot } from "../../../src/types/git"
import { categorizeGitError } from "./git-command-runner"
import type { GitClientCommandRunner } from "./git-command-runner"
import {
  createGitLogger,
  createGitOperation,
  gitOperationBaseMeta,
  logGitOperationFailure,
  logGitOperationStart,
  logGitOperationSuccess,
  type GitLogger,
} from "./git-log-utils"

type BranchDeps = {
  readonly commandRunner: Pick<GitClientCommandRunner, "run">
  readonly getSnapshot: (repository: SynapseGitRepository) => Promise<Pick<SynapseGitRepositorySnapshot, "changes">>
  readonly logger?: GitLogger
}

const defaultLogger = createGitLogger("git.branch")

function assertBranchName(name: string): string {
  const trimmed = name.trim()
  if (!trimmed) throw new Error("请输入分支名称。")
  if (trimmed.startsWith("-") || trimmed.includes("..") || trimmed.includes(" ")) {
    throw new Error("分支名称不合法。")
  }
  return trimmed
}

export function createGitBranchService(deps: BranchDeps) {
  const logger = deps.logger ?? defaultLogger
  async function assertClean(repository: SynapseGitRepository): Promise<void> {
    const snapshot = await deps.getSnapshot(repository)
    if (snapshot.changes.length > 0) throw new Error("请先提交本地改动。")
  }

  return {
    async list(repository: SynapseGitRepository): Promise<SynapseGitBranch[]> {
      const result = await deps.commandRunner.run({ cwd: repository.localPath, args: ["branch", "--list"] })
      return result.stdout.split(/\r?\n/)
        .map((line) => line.trimEnd())
        .filter(Boolean)
        .map((line) => ({
          name: line.replace(/^\*\s*/, "").trim(),
          current: line.trimStart().startsWith("* "),
        }))
    },

    async checkout(repository: SynapseGitRepository, branchName: string): Promise<void> {
      const operation = createGitOperation("git.checkout")
      const branch = assertBranchName(branchName)
      logGitOperationStart(logger, "Git operation started.", operation, repository, { branch })
      try {
        await assertClean(repository)
        await deps.commandRunner.run({
          cwd: repository.localPath,
          args: ["checkout", branch],
          operation: operation.operation,
          operationId: operation.operationId,
        })
        logGitOperationSuccess(logger, "Git operation completed.", operation, repository, { branch })
      } catch (error) {
        if (error instanceof Error && /请先提交本地改动/.test(error.message)) {
          logger.warn("Git operation blocked by dirty worktree.", {
            ...gitOperationBaseMeta(operation, repository),
            branch,
          })
        }
        logGitOperationFailure(logger, "Git operation failed.", operation, error, repository, {
          branch,
          errorCategory: categorizeGitError(error),
        })
        throw error
      }
    },

    async create(repository: SynapseGitRepository, branchName: string): Promise<void> {
      const operation = createGitOperation("git.branch.create")
      const branch = assertBranchName(branchName)
      logGitOperationStart(logger, "Git operation started.", operation, repository, { branch })
      try {
        await assertClean(repository)
        await deps.commandRunner.run({
          cwd: repository.localPath,
          args: ["checkout", "-b", branch],
          operation: operation.operation,
          operationId: operation.operationId,
        })
        logGitOperationSuccess(logger, "Git operation completed.", operation, repository, { branch })
      } catch (error) {
        if (error instanceof Error && /请先提交本地改动/.test(error.message)) {
          logger.warn("Git operation blocked by dirty worktree.", {
            ...gitOperationBaseMeta(operation, repository),
            branch,
          })
        }
        logGitOperationFailure(logger, "Git operation failed.", operation, error, repository, {
          branch,
          errorCategory: categorizeGitError(error),
        })
        throw error
      }
    },
  }
}

export type GitBranchService = ReturnType<typeof createGitBranchService>
