import type { SynapseGitBranch, SynapseGitRepository, SynapseGitRepositorySnapshot } from "../../../src/types/git"
import type { StructuredLogger } from "../../runtime/logging"
import type { GitClientCommandRunner } from "./git-command-runner"
import {
  createGitOperationId,
  logGitOperationBlocked,
  logGitOperationFailed,
  logGitOperationStarted,
  logGitOperationSucceeded,
  repositoryLogMeta,
} from "./git-logging"

type BranchDeps = {
  readonly commandRunner: Pick<GitClientCommandRunner, "run">
  readonly getSnapshot: (repository: SynapseGitRepository) => Promise<Pick<SynapseGitRepositorySnapshot, "changes">>
  readonly logger?: Pick<StructuredLogger, "error" | "info" | "warn">
}

type BranchOperationOptions = {
  readonly operationId?: string
  readonly signal?: AbortSignal
}

function assertBranchName(name: string): string {
  const trimmed = name.trim()
  if (!trimmed) throw new Error("请输入分支名称。")
  if (trimmed.startsWith("-") || trimmed.includes("..") || trimmed.includes(" ")) {
    throw new Error("分支名称不合法。")
  }
  return trimmed
}

export function createGitBranchService(deps: BranchDeps) {
  async function assertClean(repository: SynapseGitRepository, operation: string, operationId: string): Promise<void> {
    const snapshot = await deps.getSnapshot(repository)
    if (snapshot.changes.length > 0) {
      logGitOperationBlocked(deps.logger ?? noopLogger, operation, operationId, "working-tree-dirty", {
        ...repositoryLogMeta(repository),
        changeCount: snapshot.changes.length,
      })
      throw new Error("请先提交本地改动。")
    }
  }

  return {
    async list(repository: SynapseGitRepository): Promise<SynapseGitBranch[]> {
      const operation = "git.branch.list"
      const operationId = createGitOperationId()
      const result = await deps.commandRunner.run({
        cwd: repository.localPath,
        args: ["branch", "--list"],
        operation,
        operationId,
        repoPath: repository.localPath,
        repositoryId: repository.id,
      })
      return result.stdout.split(/\r?\n/)
        .map((line) => line.trimEnd())
        .filter(Boolean)
        .map((line) => ({
          name: line.replace(/^\*\s*/, "").trim(),
          current: line.trimStart().startsWith("* "),
        }))
    },

    async checkout(repository: SynapseGitRepository, branchName: string, options: BranchOperationOptions = {}): Promise<void> {
      const operation = "git.checkout"
      const operationId = options.operationId ?? createGitOperationId()
      const startedAt = performance.now()
      const meta = { ...repositoryLogMeta(repository), branch: branchName }
      logGitOperationStarted(deps.logger ?? noopLogger, operation, operationId, meta)
      try {
        await assertClean(repository, operation, operationId)
        await deps.commandRunner.run({
          cwd: repository.localPath,
          args: ["checkout", assertBranchName(branchName)],
          abortSignal: options.signal,
          operation,
          operationId,
          repoPath: repository.localPath,
          repositoryId: repository.id,
        })
        logGitOperationSucceeded(deps.logger ?? noopLogger, operation, operationId, startedAt, meta)
      } catch (error) {
        if (!isWorkingTreeDirtyBlock(error)) {
          logGitOperationFailed(deps.logger ?? noopLogger, {
            operation,
            operationId,
            repositoryId: repository.id,
            repoPath: repository.localPath,
            startedAt,
            error,
            extra: meta,
          })
        }
        throw error
      }
    },

    async create(repository: SynapseGitRepository, branchName: string, options: BranchOperationOptions = {}): Promise<void> {
      const operation = "git.branch.create"
      const operationId = options.operationId ?? createGitOperationId()
      const startedAt = performance.now()
      const meta = { ...repositoryLogMeta(repository), branch: branchName }
      logGitOperationStarted(deps.logger ?? noopLogger, operation, operationId, meta)
      try {
        await assertClean(repository, operation, operationId)
        await deps.commandRunner.run({
          cwd: repository.localPath,
          args: ["checkout", "-b", assertBranchName(branchName)],
          abortSignal: options.signal,
          operation,
          operationId,
          repoPath: repository.localPath,
          repositoryId: repository.id,
        })
        logGitOperationSucceeded(deps.logger ?? noopLogger, operation, operationId, startedAt, meta)
      } catch (error) {
        if (!isWorkingTreeDirtyBlock(error)) {
          logGitOperationFailed(deps.logger ?? noopLogger, {
            operation,
            operationId,
            repositoryId: repository.id,
            repoPath: repository.localPath,
            startedAt,
            error,
            extra: meta,
          })
        }
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

function isWorkingTreeDirtyBlock(error: unknown): boolean {
  return error instanceof Error && error.message === "请先提交本地改动。"
}

export type GitBranchService = ReturnType<typeof createGitBranchService>
