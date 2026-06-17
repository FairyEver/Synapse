import type { SynapseGitOperationResult, SynapseGitRepository } from "../../../src/types/git"
import type { GitClientCommandRunner } from "./git-command-runner"
import { assertRepositoryPath } from "./git-path-utils"

type CommitDeps = {
  readonly commandRunner: Pick<GitClientCommandRunner, "run">
  readonly now?: () => Date
}

export function createGitCommitService(deps: CommitDeps) {
  const now = deps.now ?? (() => new Date())
  return {
    async commit(
      repository: SynapseGitRepository,
      input: { readonly message: string; readonly paths: readonly string[] },
    ): Promise<SynapseGitOperationResult> {
      const message = input.message.trim()
      if (!message) throw new Error("请输入提交说明。")
      if (input.paths.length === 0) throw new Error("请选择要提交的文件。")
      for (const filePath of input.paths) {
        assertRepositoryPath(repository.localPath, filePath)
      }
      await deps.commandRunner.run({ cwd: repository.localPath, args: ["add", "--", ...input.paths] })
      await deps.commandRunner.run({ cwd: repository.localPath, args: ["commit", "-m", message] })
      return {
        completedAt: now().toISOString(),
        message: "已提交选中文件。",
      }
    },
  }
}

export type GitCommitService = ReturnType<typeof createGitCommitService>
