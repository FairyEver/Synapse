import { mkdtemp, rm } from "node:fs/promises"
import path from "node:path"
import type { SynapseGitOperationResult, SynapseGitRepository } from "../../../src/types/git"
import type { StructuredLogger } from "../../runtime/logging"
import type { GitChangeSelectionService } from "./git-change-selection-service"
import type { GitClientCommandRunner } from "./git-command-runner"
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
  readonly createTemporaryIndex?: (repository: SynapseGitRepository) => Promise<{
    readonly path: string
    readonly cleanup: () => Promise<void>
  }>
  readonly selections: Pick<GitChangeSelectionService, "invalidate" | "validate">
  readonly logger?: Pick<StructuredLogger, "error" | "info" | "warn">
  readonly now?: () => Date
}

type CommitOptions = {
  readonly operationId?: string
  readonly signal?: AbortSignal
}

export function createGitCommitService(deps: CommitDeps) {
  const now = deps.now ?? (() => new Date())
  const createTemporaryIndex = deps.createTemporaryIndex ?? (async (repository: SynapseGitRepository) => {
    const indexResult = await deps.commandRunner.run({
      args: ["rev-parse", "--git-path", "index"],
      cwd: repository.localPath,
      fallbackMessage: "无法准备安全提交事务。",
      operation: "git.commit",
      repoPath: repository.localPath,
      repositoryId: repository.id,
    })
    const indexPath = path.isAbsolute(indexResult.stdout.trim())
      ? indexResult.stdout.trim()
      : path.resolve(repository.localPath, indexResult.stdout.trim())
    const directory = await mkdtemp(path.join(path.dirname(indexPath), "synapse-index-"))
    return {
      path: path.join(directory, "index"),
      cleanup: () => rm(directory, { force: true, recursive: true }),
    }
  })
  return {
    async commit(
      repository: SynapseGitRepository,
      input: { readonly message: string; readonly selectionId: string },
      options: CommitOptions = {},
    ): Promise<SynapseGitOperationResult> {
      const operation = "git.commit"
      const operationId = options.operationId ?? createGitOperationId()
      const startedAt = performance.now()
      const message = input.message.trim()
      const meta = {
        ...repositoryLogMeta(repository),
        selectionId: input.selectionId,
        messageLength: message.length,
      }
      logGitOperationStarted(deps.logger ?? noopLogger, operation, operationId, meta)
      if (!message) {
        logGitOperationBlocked(deps.logger ?? noopLogger, operation, operationId, "empty-message", meta)
        throw new Error("请输入提交说明。")
      }

      let temporaryIndex: Awaited<ReturnType<typeof createTemporaryIndex>> | null = null
      try {
        const selection = await deps.selections.validate(repository, input.selectionId)
        temporaryIndex = await createTemporaryIndex(repository)
        await deps.commandRunner.run({
          args: selection.head ? ["read-tree", selection.head] : ["read-tree", "--empty"],
          cwd: repository.localPath,
          gitIndexFile: temporaryIndex.path,
          operation,
          operationId,
          repoPath: repository.localPath,
          repositoryId: repository.id,
        })
        await deps.commandRunner.run({
          args: ["--literal-pathspecs", "add", "--all", "--", ...selection.paths],
          abortSignal: options.signal,
          cwd: repository.localPath,
          gitIndexFile: temporaryIndex.path,
          operation,
          operationId,
          repoPath: repository.localPath,
          repositoryId: repository.id,
        })

        await deps.selections.validate(repository, input.selectionId)
        await deps.commandRunner.run({
          args: ["commit", "-m", message],
          abortSignal: options.signal,
          cwd: repository.localPath,
          gitIndexFile: temporaryIndex.path,
          operation,
          operationId,
          repoPath: repository.localPath,
          repositoryId: repository.id,
        })
        deps.selections.invalidate(input.selectionId)
        try {
          await deps.commandRunner.run({
            args: ["--literal-pathspecs", "reset", "--mixed", "HEAD", "--", ...selection.paths],
            cwd: repository.localPath,
            fallbackMessage: "提交已创建，但无法校正所选文件的暂存状态，请在 Git 工具中检查暂存区。",
            operation,
            operationId,
            repoPath: repository.localPath,
            repositoryId: repository.id,
          })
        } catch {
          throw new Error("提交已创建，但无法校正所选文件的暂存状态，请在 Git 工具中检查暂存区。")
        }
        logGitOperationSucceeded(deps.logger ?? noopLogger, operation, operationId, startedAt, {
          ...meta,
          pathCount: selection.paths.length,
        })
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
      } finally {
        if (temporaryIndex) {
          try {
            await temporaryIndex.cleanup()
          } catch (error) {
            deps.logger?.warn("Failed to clean temporary Git index.", {
              operation,
              operationId,
              repositoryId: repository.id,
              error: error instanceof Error ? error.message : String(error),
            })
          }
        }
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
