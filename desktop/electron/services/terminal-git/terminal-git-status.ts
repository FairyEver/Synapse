import { createReadStream } from "node:fs"
import { lstat } from "node:fs/promises"
import path from "node:path"

import type { GitClientCommandRunner } from "../git-client/git-command-runner"
import {
  createGitStatusPorcelainV2Parser,
  parseGitStatusPorcelainV2,
} from "../git-client/git-status-parser"
import {
  emptySnapshot,
  type TerminalGitBranch,
  type TerminalGitLineStats,
  type TerminalGitRemoteBranch,
  type TerminalGitSnapshot,
} from "./terminal-git-types"

const MAX_VISIBLE_STATUS_CHANGES = 10_000

export type TerminalGitStatusReader = {
  /** 是不是 Git 仓库。任何写动作之前都先问它一句 —— 不是仓库就一行命令都不该再跑。 */
  isRepository(cwd: string): Promise<boolean>
  getSnapshot(cwd: string): Promise<TerminalGitSnapshot>
  getLineStats(snapshot: TerminalGitSnapshot): Promise<TerminalGitLineStats>
  listBranches(cwd: string): Promise<readonly TerminalGitBranch[]>
  listRemoteBranches(cwd: string): Promise<readonly TerminalGitRemoteBranch[]>
}

function parseShortstat(output: string): TerminalGitLineStats {
  return {
    insertions: Number(output.match(/(\d+) insertions?\(\+\)/)?.[1] ?? 0),
    deletions: Number(output.match(/(\d+) deletions?\(-\)/)?.[1] ?? 0),
  }
}

async function countUntrackedLines(filePath: string): Promise<number> {
  const stat = await lstat(filePath)
  if (!stat.isFile()) return 0
  let lines = 0
  let lastByte = 10
  let hasContent = false
  for await (const chunk of createReadStream(filePath)) {
    if (chunk.includes(0)) return 0 // Git reports binary files without line counts.
    hasContent = true
    for (const byte of chunk) if (byte === 10) lines += 1
    lastByte = chunk[chunk.length - 1] ?? lastByte
  }
  return hasContent && lastByte !== 10 ? lines + 1 : lines
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

  async function getLineStats(snapshot: TerminalGitSnapshot): Promise<TerminalGitLineStats> {
    if (!snapshot.isRepository || snapshot.changeCount === 0) return { insertions: 0, deletions: 0 }
    const head = await deps.commandRunner.run({
      cwd: snapshot.cwd,
      args: ["rev-parse", "--verify", "HEAD"],
      acceptedExitCodes: [0, 128],
      logFailure: false,
      operation: "terminal-git.status.head",
      repoPath: snapshot.cwd,
    })
    const diffs = head.stdout.trim()
      ? [["diff", "--no-ext-diff", "--shortstat", "HEAD", "--"]]
      : [
          ["diff", "--no-ext-diff", "--shortstat", "--cached", "--"],
          ["diff", "--no-ext-diff", "--shortstat", "--"],
        ]
    let insertions = 0
    let deletions = 0
    for (const args of diffs) {
      const result = await deps.commandRunner.run({
        cwd: snapshot.cwd,
        args,
        logFailure: false,
        operation: "terminal-git.status.line-stats",
        repoPath: snapshot.cwd,
      })
      const stats = parseShortstat(result.stdout)
      insertions += stats.insertions
      deletions += stats.deletions
    }
    for (const change of snapshot.changes) {
      if (change.status !== "untracked") continue
      try {
        insertions += await countUntrackedLines(path.resolve(snapshot.cwd, change.path))
      } catch (error) {
        if ((error as NodeJS.ErrnoException).code !== "ENOENT") throw error
      }
    }
    return { insertions, deletions }
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

  /**
   * 列远端分支。
   *
   * **只读本地缓存的 `refs/remotes`，一行网络命令都不跑** —— 打开列表要快、要离线可用，
   * 要最新的话由 `fetchRemotes` 负责，那是另一个动作（也过另一套权限）。这条规矩与桌面端
   * 那套一致（`git-branch-service.ts` 的 `listRemote` 同样只读缓存）。
   */
  async function listRemoteBranches(cwd: string): Promise<readonly TerminalGitRemoteBranch[]> {
    const [remotes, refs] = await Promise.all([
      deps.commandRunner.run({
        cwd,
        args: ["remote"],
        operation: "terminal-git.remote-branch.remotes",
        repoPath: cwd,
      }),
      deps.commandRunner.run({
        cwd,
        args: ["for-each-ref", "--format=%(refname:strip=2)%00%(symref)", "refs/remotes"],
        operation: "terminal-git.remote-branch.list",
        repoPath: cwd,
      }),
    ])
    /*
     * 最长前缀优先：`team/fork` 必须先于 `team` 命中，否则 `team/fork/x` 会被拆成
     * remote=`team`、name=`fork/x`。规则与桌面端 `git-branch-service.ts` 的 `listRemote` 同款。
     */
    const remoteNames = remotes.stdout.split(/\r?\n/)
      .map((value) => value.trim())
      .filter(Boolean)
      .sort((left, right) => right.length - left.length)
    const branches: TerminalGitRemoteBranch[] = []
    for (const line of refs.stdout.split(/\r?\n/)) {
      const [fullName = "", symbolicTarget = ""] = line.split("\0")
      // 符号引用（`origin/HEAD -> origin/main`）与 `*/HEAD` 都不是一条分支。
      if (!fullName || symbolicTarget || fullName.endsWith("/HEAD")) continue
      const remote = remoteNames.find((candidate) => fullName.startsWith(`${candidate}/`))
      if (!remote) continue
      const name = fullName.slice(remote.length + 1)
      if (!name) continue
      branches.push({ remote, name })
    }
    return branches.sort((left, right) =>
      left.remote === right.remote
        ? left.name.localeCompare(right.name)
        : left.remote.localeCompare(right.remote))
  }

  return { isRepository, getSnapshot, getLineStats, listBranches, listRemoteBranches }
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
