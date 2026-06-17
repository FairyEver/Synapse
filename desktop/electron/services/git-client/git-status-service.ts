import type { SynapseGitDiffResult, SynapseGitRepository, SynapseGitRepositorySnapshot } from "../../../src/types/git"
import type { GitClientCommandRunner } from "./git-command-runner"
import { assertRepositoryPath } from "./git-path-utils"
import { parseGitStatusPorcelainV2 } from "./git-status-parser"

type StatusDeps = {
  readonly commandRunner: Pick<GitClientCommandRunner, "run">
  readonly pathExists: (filePath: string) => Promise<boolean>
}

function isNotGitRepository(error: unknown): boolean {
  return error instanceof Error && /not a git repository/i.test(error.message)
}

export function createGitStatusService(deps: StatusDeps) {
  return {
    async getSnapshot(repository: SynapseGitRepository): Promise<SynapseGitRepositorySnapshot> {
      if (!(await deps.pathExists(repository.localPath))) {
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
        })
        return {
          repositoryId: repository.id,
          pathExists: true,
          isGitRepository: true,
          ...parseGitStatusPorcelainV2(result.stdout),
        }
      } catch (error) {
        if (isNotGitRepository(error)) {
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
        throw error
      }
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
