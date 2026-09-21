import type { GitClientCommandRunner } from "../git-client/git-command-runner"
import {
  createGitStatusPorcelainV2Parser,
  parseGitStatusPorcelainV2,
} from "../git-client/git-status-parser"
import { emptySnapshot, type TerminalGitBranch, type TerminalGitSnapshot } from "./terminal-git-types"

const MAX_VISIBLE_STATUS_CHANGES = 10_000

export type TerminalGitStatusReader = {
  /** 是不是 Git 仓库。任何写动作之前都先问它一句 —— 不是仓库就一行命令都不该再跑。 */
  isRepository(cwd: string): Promise<boolean>
  getSnapshot(cwd: string): Promise<TerminalGitSnapshot>
  listBranches(cwd: string): Promise<readonly TerminalGitBranch[]>
}

export function createTerminalGitStatusReader(deps: {
  readonly commandRunner: GitClientCommandRunner
}): TerminalGitStatusReader {
  /**
   * 用 `rev-parse --show-toplevel` 而不是自己去找 `.git`：只有 git 自己知道
   * 子目录、worktree、submodule 和 `GIT_DIR` 的规则，复刻一份迟早会与它分叉。
   * 128 是 git 对「不是仓库」的退出码，这里不当作错误。
   */
  async function isRepository(cwd: string): Promise<boolean> {
    try {
      const result = await deps.commandRunner.run({
        cwd,
        args: ["rev-parse", "--show-toplevel"],
        acceptedExitCodes: [0, 128],
        logFailure: false,
        operation: "terminal-git.repository.detect",
        repoPath: cwd,
      })
      return result.stdout.trim().length > 0
    } catch {
      // 目录都进不去（不存在、没权限）：对调用方来说与「不是仓库」是同一件事。
      return false
    }
  }

  async function getSnapshot(cwd: string): Promise<TerminalGitSnapshot> {
    if (!(await isRepository(cwd))) return emptySnapshot(cwd)
    const parser = createGitStatusPorcelainV2Parser({ maxChanges: MAX_VISIBLE_STATUS_CHANGES })
    let sawChunk = false
    const result = await deps.commandRunner.run({
      cwd,
      args: ["status", "--porcelain=v2", "-z", "--branch", "--untracked-files=all"],
      captureStdout: false,
      logFailure: false,
      onStdoutChunk: (chunk) => {
        sawChunk = true
        parser.push(chunk)
      },
      operation: "terminal-git.status",
      repoPath: cwd,
    })
    const parsed = sawChunk ? parser.finish() : parseGitStatusPorcelainV2(result.stdout)
    const detachedSha = parsed.currentBranch === null && parsed.hasCommits
      ? await shortHeadSha(cwd)
      : null
    return {
      cwd,
      isRepository: true,
      branch: parsed.currentBranch,
      detachedSha,
      upstream: parsed.upstream,
      ahead: parsed.ahead,
      behind: parsed.behind,
      changeCount: parsed.changeCount,
      hasConflicts: parsed.hasConflicts,
      changes: parsed.changes,
    }
  }

  async function shortHeadSha(cwd: string): Promise<string | null> {
    try {
      const result = await deps.commandRunner.run({
        cwd,
        args: ["rev-parse", "--short", "HEAD"],
        acceptedExitCodes: [0, 128],
        logFailure: false,
        operation: "terminal-git.status.detached-sha",
        repoPath: cwd,
      })
      return result.stdout.trim() || null
    } catch {
      // 游离 sha 是显示用的细节，读不到就不显示。
      return null
    }
  }

  async function listBranches(cwd: string): Promise<readonly TerminalGitBranch[]> {
    const current = await deps.commandRunner.run({
      cwd,
      args: ["symbolic-ref", "--quiet", "--short", "HEAD"],
      acceptedExitCodes: [0, 1],
      logFailure: false,
      operation: "terminal-git.branch.current",
      repoPath: cwd,
    })
    const branches = await deps.commandRunner.run({
      cwd,
      args: ["for-each-ref", "--format=%(refname:short)", "refs/heads"],
      operation: "terminal-git.branch.list",
      repoPath: cwd,
    })
    const currentBranch = current.stdout.trim()
    return branches.stdout
      .split(/\r?\n/)
      .map((line) => line.trim())
      .filter(Boolean)
      .map((name) => ({ name, current: name === currentBranch }))
  }

  return { isRepository, getSnapshot, listBranches }
}

/**
 * 分支名用 git 自己的 `check-ref-format` 校验，不在这一层复刻一套规则 ——
 * 复刻了就一定会与电脑分叉（`../x`、`a b`、`-x`、空串都在这里被挡住）。
 */
export type TerminalGitBranchValidator = (cwd: string, branch: string) => Promise<string | null>

export function createTerminalGitBranchValidator(deps: {
  readonly commandRunner: GitClientCommandRunner
}): TerminalGitBranchValidator {
  return async (cwd, branch) => {
    const name = branch.trim()
    if (!name) return null
    try {
      const result = await deps.commandRunner.run({
        cwd,
        // `check-ref-format --branch a b` 这类输入会让 git 直接 128 退出，那是「不合法」，
        // 不是一次命令失败 —— 别让一个非法分支名变成一条异常。
        acceptedExitCodes: [0, 1, 128],
        args: ["check-ref-format", "--branch", name],
        logFailure: false,
        operation: "terminal-git.branch.validate",
        repoPath: cwd,
      })
      return result.stdout.trim() === name ? name : null
    } catch {
      return null
    }
  }
}
