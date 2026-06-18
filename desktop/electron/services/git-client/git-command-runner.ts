import type { SynapseGitErrorCategory } from "../../../src/types/git"
import { runGitCommand, type GitCommandResult } from "../git-command"
import { createGitOperationId, gitErrorMeta, summarizeGitArgs } from "./git-logging"

type GitClientRunInput = {
  readonly cwd: string
  readonly args: readonly string[]
  readonly fallbackMessage?: string
  readonly logFailure?: boolean
  readonly operation?: string
  readonly operationId?: string
  readonly repoPath?: string
  readonly repositoryId?: string
  readonly timeoutMs?: number
}

type GitCommandFunction = typeof runGitCommand
type GitCommandRunnerLogger = {
  error(message: string, meta?: unknown): void
}

export function categorizeGitError(error: unknown): SynapseGitErrorCategory {
  const message = error instanceof Error ? error.message : String(error)
  if (/no available git|no git command|ENOENT|没有可用的 git|git 命令/i.test(message)) return "git-missing"
  if (/authentication failed|permission denied|could not read username|access denied|认证失败/i.test(message)) return "auth-failed"
  if (/could not resolve host|failed to connect|network|timed out|timeout|超时/i.test(message)) return "network-failed"
  if (/not a git repository/i.test(message)) return "not-git-repository"
  if (/local changes would be overwritten|working tree|uncommitted changes|未提交/i.test(message)) return "working-tree-dirty"
  if (/non-fast-forward|fetch first|rejected/i.test(message)) return "non-fast-forward"
  if (/conflict|merge conflict|CONFLICT/i.test(message)) return "conflict"
  return "unknown"
}

export function createGitClientCommandRunner(deps: {
  readonly logger?: GitCommandRunnerLogger
  readonly runGitCommand?: GitCommandFunction
} = {}) {
  const command = deps.runGitCommand ?? runGitCommand
  return {
    async run(input: GitClientRunInput): Promise<GitCommandResult> {
      const startedAt = performance.now()
      const operation = input.operation ?? `git.${input.args[0] ?? "command"}`
      const operationId = input.operationId ?? createGitOperationId()
      try {
        return await command({
          args: [...input.args],
          cwd: input.cwd,
          fallbackMessage: input.fallbackMessage ?? "Git 操作失败。",
          timeoutMessage: "Git 操作超时。",
          timeoutMs: input.timeoutMs ?? 60_000,
        })
      } catch (error) {
        if (input.logFailure !== false) {
          deps.logger?.error("Git command failed.", {
            operation,
            operationId,
            ...(input.repositoryId ? { repositoryId: input.repositoryId } : {}),
            repoPath: input.repoPath ?? input.cwd,
            cwd: input.cwd,
            gitArgs: summarizeGitArgs(input.args),
            durationMs: Math.max(0, Math.round(performance.now() - startedAt)),
            ...gitErrorMeta(error),
          })
        }
        throw error
      }
    },
  }
}

export type GitClientCommandRunner = ReturnType<typeof createGitClientCommandRunner>
export type { GitClientRunInput }
