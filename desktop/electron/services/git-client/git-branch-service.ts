import type { SynapseGitBranch, SynapseGitRepository, SynapseGitRepositorySnapshot } from "../../../src/types/git"
import type { GitClientCommandRunner } from "./git-command-runner"

type BranchDeps = {
  readonly commandRunner: Pick<GitClientCommandRunner, "run">
  readonly getSnapshot: (repository: SynapseGitRepository) => Promise<Pick<SynapseGitRepositorySnapshot, "changes">>
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
      await assertClean(repository)
      await deps.commandRunner.run({ cwd: repository.localPath, args: ["checkout", assertBranchName(branchName)] })
    },

    async create(repository: SynapseGitRepository, branchName: string): Promise<void> {
      await assertClean(repository)
      await deps.commandRunner.run({ cwd: repository.localPath, args: ["checkout", "-b", assertBranchName(branchName)] })
    },
  }
}

export type GitBranchService = ReturnType<typeof createGitBranchService>
