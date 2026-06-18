import type {
  SynapseGitDiffResult,
  SynapseGitRepository,
  SynapseGitRepositorySnapshot,
  SynapseGitRepositorySummary,
} from "../../../src/types/git"
import { categorizeGitError } from "./git-command-runner"
import type { GitClientCommandRunner } from "./git-command-runner"
import {
  createGitLogger,
  gitFailureLogMeta,
  gitRepositoryLogMeta,
  gitSnapshotLogMeta,
  type GitLogger,
} from "./git-log-utils"
import { assertRepositoryPath } from "./git-path-utils"
import { parseGitStatusPorcelainV2 } from "./git-status-parser"

type StatusDeps = {
  readonly commandRunner: Pick<GitClientCommandRunner, "run">
  readonly logger?: GitLogger
  readonly pathExists: (filePath: string) => Promise<boolean>
}

const defaultLogger = createGitLogger("git.status")

function isNotGitRepository(error: unknown): boolean {
  return error instanceof Error && /not a git repository/i.test(error.message)
}

export function createGitStatusService(deps: StatusDeps) {
  const logger = deps.logger ?? defaultLogger
  return {
    async getSnapshot(repository: SynapseGitRepository): Promise<SynapseGitRepositorySnapshot> {
      if (!(await deps.pathExists(repository.localPath))) {
        logger.warn("Git repository path is missing.", {
          operation: "git.status",
          ...gitRepositoryLogMeta(repository),
        })
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

      try {
        const result = await deps.commandRunner.run({
          cwd: repository.localPath,
          args: ["status", "--porcelain=v2", "--branch"],
          logFailure: false,
          operation: "git.status",
        })
        const snapshot = {
          repositoryId: repository.id,
          pathExists: true,
          isGitRepository: true,
          ...parseGitStatusPorcelainV2(result.stdout),
        }
        if (snapshot.hasConflicts || snapshot.currentBranch === null) {
          logger.warn("Git repository status needs attention.", {
            operation: "git.status",
            ...gitRepositoryLogMeta(repository),
            ...gitSnapshotLogMeta(snapshot),
          })
        }
        return snapshot
      } catch (error) {
        if (isNotGitRepository(error)) {
          logger.warn("Git repository status read found a non-Git directory.", {
            operation: "git.status",
            ...gitRepositoryLogMeta(repository),
            ...gitFailureLogMeta(error, { category: "not-git-repository" }),
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
        logger.error("Git repository status read failed.", {
          operation: "git.status",
          ...gitRepositoryLogMeta(repository),
          ...gitFailureLogMeta(error, {
            category: categorizeGitError(error),
            includeOutput: true,
          }),
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
          logger.warn("Git repository summary read failed.", {
            operation: "git.status.summary",
            ...gitRepositoryLogMeta(repository),
            ...gitFailureLogMeta(error, {
              category: categorizeGitError(error),
              includeOutput: true,
            }),
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
      assertRepositoryPath(repository.localPath, input.path)
      const args = input.staged
        ? ["diff", "--staged", "--", input.path]
        : ["diff", "--", input.path]
      const result = await deps.commandRunner.run({ cwd: repository.localPath, args })
      const text = result.stdout
      return {
        path: input.path,
        originalPath: input.originalPath ?? null,
        binary: /^Binary files /m.test(text),
        text,
      }
    },
  }
}

export type GitStatusService = ReturnType<typeof createGitStatusService>
