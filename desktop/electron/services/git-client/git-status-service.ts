import type {
  SynapseGitDiffResult,
  SynapseGitRepository,
  SynapseGitRepositorySnapshot,
  SynapseGitRepositorySummary,
} from "../../../src/types/git"
import type { StructuredLogger } from "../../runtime/logging"
import type { GitClientCommandRunner } from "./git-command-runner"
import { assertRepositoryPath } from "./git-path-utils"
import {
  createGitOperationId,
  gitErrorMeta,
  logGitOperationFailed,
  repositoryLogMeta,
  summarizeChanges,
} from "./git-logging"
import { parseGitStatusPorcelainV2 } from "./git-status-parser"

type StatusDeps = {
  readonly commandRunner: Pick<GitClientCommandRunner, "run">
  readonly logger?: Pick<StructuredLogger, "error" | "warn">
  readonly pathExists: (filePath: string) => Promise<boolean>
}

function isNotGitRepository(error: unknown): boolean {
  return error instanceof Error && /not a git repository/i.test(error.message)
}

export function createGitStatusService(deps: StatusDeps) {
  return {
    async getSnapshot(repository: SynapseGitRepository): Promise<SynapseGitRepositorySnapshot> {
      if (!(await deps.pathExists(repository.localPath))) {
        deps.logger?.warn("Git repository path missing.", repositoryLogMeta(repository))
        return {
          repositoryId: repository.id,
          pathExists: false,
          isGitRepository: false,
          currentBranch: null,
          upstream: null,
          ahead: 0,
          behind: 0,
          hasConflicts: false,
          changes: [],
        }
      }

      const operation = "git.status"
      const operationId = createGitOperationId()
      const startedAt = performance.now()
      try {
        const result = await deps.commandRunner.run({
          cwd: repository.localPath,
          args: ["status", "--porcelain=v2", "--branch"],
          logFailure: false,
          operation,
          operationId,
          repoPath: repository.localPath,
          repositoryId: repository.id,
        })
        return {
          repositoryId: repository.id,
          pathExists: true,
          isGitRepository: true,
          ...parseGitStatusPorcelainV2(result.stdout),
        }
      } catch (error) {
        if (isNotGitRepository(error)) {
          deps.logger?.warn("Git repository status unavailable because path is not a Git repository.", {
            ...repositoryLogMeta(repository),
            operation,
            operationId,
          })
          return {
            repositoryId: repository.id,
            pathExists: true,
            isGitRepository: false,
            currentBranch: null,
            upstream: null,
            ahead: 0,
            behind: 0,
            hasConflicts: false,
            changes: [],
          }
        }
        logGitOperationFailed(deps.logger ?? noopLogger, {
          operation,
          operationId,
          repositoryId: repository.id,
          repoPath: repository.localPath,
          startedAt,
          error,
          extra: repositoryLogMeta(repository),
        })
        throw error
      }
    },

    async listSummaries(repositories: readonly SynapseGitRepository[]): Promise<SynapseGitRepositorySummary[]> {
      return Promise.all(repositories.map(async (repository) => {
        try {
          return {
            repository,
            snapshot: await this.getSnapshot(repository),
            error: null,
          }
        } catch (error) {
          deps.logger?.warn("Git repository summary failed.", {
            ...repositoryLogMeta(repository),
            operation: "git.status.summary",
            ...summarizeSummaryError(error),
          })
          return {
            repository,
            snapshot: null,
            error: error instanceof Error ? error.message : "读取仓库状态失败。",
          }
        }
      }))
    },

    async getDiff(
      repository: SynapseGitRepository,
      input: { readonly path: string; readonly originalPath?: string | null; readonly staged: boolean },
    ): Promise<SynapseGitDiffResult> {
      const operation = "git.diff"
      const operationId = createGitOperationId()
      const startedAt = performance.now()
      try {
        assertRepositoryPath(repository.localPath, input.path)
        const args = input.staged
          ? ["diff", "--staged", "--", input.path]
          : ["diff", "--", input.path]
        const result = await deps.commandRunner.run({
          cwd: repository.localPath,
          args,
          operation,
          operationId,
          repoPath: repository.localPath,
          repositoryId: repository.id,
        })
        const text = result.stdout
        return {
          path: input.path,
          originalPath: input.originalPath ?? null,
          binary: /^Binary files /m.test(text),
          text,
        }
      } catch (error) {
        logGitOperationFailed(deps.logger ?? noopLogger, {
          operation,
          operationId,
          repositoryId: repository.id,
          repoPath: repository.localPath,
          startedAt,
          error,
          extra: {
            ...repositoryLogMeta(repository),
            staged: input.staged,
            pathSample: input.path,
          },
        })
        throw error
      }
    },
  }
}

function summarizeSummaryError(error: unknown): Record<string, unknown> {
  if (error && typeof error === "object" && "changes" in error) {
    const changes = (error as { readonly changes?: unknown }).changes
    if (Array.isArray(changes)) return summarizeChanges(changes)
  }
  return {
    ...gitErrorMeta(error),
  }
}

const noopLogger = {
  error: () => undefined,
  warn: () => undefined,
}

export type GitStatusService = ReturnType<typeof createGitStatusService>
