import type { SynapseGitOperationResult, SynapseGitRepository, SynapseGitRepositorySnapshot } from "../../../src/types/git"
import type { GitClientCommandRunner } from "./git-command-runner"

type SyncDeps = {
  readonly commandRunner: Pick<GitClientCommandRunner, "run">
  readonly getSnapshot: (repository: SynapseGitRepository) => Promise<Pick<SynapseGitRepositorySnapshot, "changes" | "ahead" | "behind">>
  readonly now?: () => Date
}

export function createGitSyncService(deps: SyncDeps) {
  const now = deps.now ?? (() => new Date())

  function result(message: string): SynapseGitOperationResult {
    return { completedAt: now().toISOString(), message }
  }

  return {
    async fetch(repository: SynapseGitRepository): Promise<SynapseGitOperationResult> {
      await deps.commandRunner.run({ cwd: repository.localPath, args: ["fetch", "--prune"], timeoutMs: 120_000 })
      return result("已获取远程更新。")
    },

    async pull(repository: SynapseGitRepository): Promise<SynapseGitOperationResult> {
      await deps.commandRunner.run({ cwd: repository.localPath, args: ["pull", "--ff-only"], timeoutMs: 120_000 })
      return result("已拉取远程更新。")
    },

    async push(repository: SynapseGitRepository): Promise<SynapseGitOperationResult> {
      await deps.commandRunner.run({ cwd: repository.localPath, args: ["push"], timeoutMs: 120_000 })
      return result("已推送本地提交。")
    },

    async sync(repository: SynapseGitRepository): Promise<SynapseGitOperationResult> {
      const before = await deps.getSnapshot(repository)
      if (before.changes.length > 0) throw new Error("请先提交本地改动。")

      await deps.commandRunner.run({ cwd: repository.localPath, args: ["fetch", "--prune"], timeoutMs: 120_000 })
      if (before.behind > 0) {
        await deps.commandRunner.run({ cwd: repository.localPath, args: ["pull", "--ff-only"], timeoutMs: 120_000 })
      }
      const afterPull = await deps.getSnapshot(repository)
      if (afterPull.ahead > 0) {
        await deps.commandRunner.run({ cwd: repository.localPath, args: ["push"], timeoutMs: 120_000 })
      }
      return result("已同步仓库。")
    },
  }
}

export type GitSyncService = ReturnType<typeof createGitSyncService>
