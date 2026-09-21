import { getGitUserFacingFailure, type GitClientCommandRunner } from "../git-client/git-command-runner"
import type { TerminalGitBranchValidator, TerminalGitStatusReader } from "./terminal-git-status"
import {
  DETACHED_HEAD_MESSAGE,
  DIRTY_WORKING_TREE_MESSAGE,
  NOT_A_REPOSITORY_MESSAGE,
  TERMINAL_GIT_REMOTE_TIMEOUT_MS,
  failure,
  success,
  type TerminalGitOutcome,
  type TerminalGitSnapshot,
} from "./terminal-git-types"

export type TerminalGitWorkflow = {
  checkout(input: {
    readonly cwd: string
    /** true = 丢弃已跟踪文件的改动再切（`checkout -f`，**不删未跟踪文件**）。 */
    readonly discardChanges?: boolean
    readonly branch: string
  }): Promise<TerminalGitOutcome<TerminalGitSnapshot>>
  createBranch(input: {
    readonly cwd: string
    readonly branch: string
    readonly fromBranch?: string
  }): Promise<TerminalGitOutcome<TerminalGitSnapshot>>
  commit(input: { readonly cwd: string; readonly message: string }): Promise<TerminalGitOutcome<TerminalGitSnapshot>>
  push(input: { readonly cwd: string }): Promise<TerminalGitOutcome<TerminalGitSnapshot>>
  sync(input: { readonly cwd: string }): Promise<TerminalGitOutcome<TerminalGitSnapshot>>
}

export function createTerminalGitWorkflow(deps: {
  readonly commandRunner: GitClientCommandRunner
  readonly status: TerminalGitStatusReader
  readonly validateBranchName: TerminalGitBranchValidator
}): TerminalGitWorkflow {
  async function run(input: {
    readonly cwd: string
    readonly args: readonly string[]
    readonly operation: string
    readonly timeoutMs?: number
  }): Promise<void> {
    await deps.commandRunner.run({
      cwd: input.cwd,
      args: [...input.args],
      operation: input.operation,
      repoPath: input.cwd,
      ...(input.timeoutMs === undefined ? {} : { timeoutMs: input.timeoutMs }),
    })
  }

  /**
   * 写动作的公共前置：不是仓库就直接拒绝，一行 git 都不再跑。
   *
   * 返回快照与 null 二选一：拿到了就说明是仓库，拿不到的那一半已经是给用户的回答。
   */
  async function requireRepository(cwd: string): Promise<{ snapshot: TerminalGitSnapshot } | { rejected: TerminalGitOutcome<never> }> {
    const snapshot = await deps.status.getSnapshot(cwd)
    if (!snapshot.isRepository) return { rejected: failure(NOT_A_REPOSITORY_MESSAGE) }
    return { snapshot }
  }

  /**
   * 脏工作区的口径：**不替用户决定**。
   *
   * 判定「脏」时未跟踪文件也算（沿用桌面端口径），但「丢弃」时不动它们，
   * 所以可能出现「它说有 3 个文件未提交，我选了丢弃，那 3 个文件还在」——
   * 这是有意为之：宁可多问一次，不可多删一个。
   */
  function dirtyDecision(snapshot: TerminalGitSnapshot): TerminalGitOutcome<never> | null {
    return snapshot.changeCount > 0
      ? failure(DIRTY_WORKING_TREE_MESSAGE, { needsDecision: "dirty" })
      : null
  }

  async function checkout(input: {
    readonly cwd: string
    readonly branch: string
    readonly discardChanges?: boolean
  }): Promise<TerminalGitOutcome<TerminalGitSnapshot>> {
    const required = await requireRepository(input.cwd)
    if ("rejected" in required) return required.rejected
    const { snapshot } = required
    const branch = await deps.validateBranchName(input.cwd, input.branch)
    if (!branch) return failure(`分支名称不合法：${input.branch}`)
    /*
     * 已经在这条分支上就什么都不做。这不是省事：带 `-f` 的一条「丢弃改动并切换」
     * 会把用户的改动丢掉却什么也没换到 —— 手机上点错一下就是不可逆的。
     */
    if (branch === snapshot.branch) return success(snapshot)
    if (!input.discardChanges) {
      const dirty = dirtyDecision(snapshot)
      if (dirty) return dirty
      await run({ cwd: input.cwd, args: ["checkout", branch], operation: "terminal-git.checkout" })
    } else {
      /*
       * 只丢已跟踪文件的修改：`checkout -f` 的语义，**不加 `clean`**。
       * 未跟踪的新文件可能是用户根本没想提交的草稿，删掉不可逆。
       */
      await run({ cwd: input.cwd, args: ["checkout", "-f", branch], operation: "terminal-git.checkout.discard" })
    }
    return success(await deps.status.getSnapshot(input.cwd))
  }

  async function createBranch(input: {
    readonly cwd: string
    readonly branch: string
    readonly fromBranch?: string
  }): Promise<TerminalGitOutcome<TerminalGitSnapshot>> {
    const required = await requireRepository(input.cwd)
    if ("rejected" in required) return required.rejected
    const dirty = dirtyDecision(required.snapshot)
    if (dirty) return dirty
    const branch = await deps.validateBranchName(input.cwd, input.branch)
    if (!branch) return failure(`分支名称不合法：${input.branch}`)
    const from = input.fromBranch === undefined ? null : await deps.validateBranchName(input.cwd, input.fromBranch)
    if (input.fromBranch !== undefined && !from) return failure(`分支名称不合法：${input.fromBranch}`)
    await run({
      cwd: input.cwd,
      args: from ? ["checkout", "-b", branch, from] : ["checkout", "-b", branch],
      operation: "terminal-git.branch.create",
    })
    return success(await deps.status.getSnapshot(input.cwd))
  }

  async function commit(input: {
    readonly cwd: string
    readonly message: string
  }): Promise<TerminalGitOutcome<TerminalGitSnapshot>> {
    const required = await requireRepository(input.cwd)
    if ("rejected" in required) return required.rejected
    const message = input.message.trim()
    if (!message) return failure("提交信息不能为空。")
    // 一律全量：`add -A` + commit，不挑文件。
    await run({ cwd: input.cwd, args: ["add", "-A"], operation: "terminal-git.commit.stage" })
    await run({ cwd: input.cwd, args: ["commit", "-m", message], operation: "terminal-git.commit" })
    return success(await deps.status.getSnapshot(input.cwd))
  }

  async function push(input: { readonly cwd: string }): Promise<TerminalGitOutcome<TerminalGitSnapshot>> {
    const required = await requireRepository(input.cwd)
    if ("rejected" in required) return required.rejected
    const { snapshot } = required
    if (!snapshot.branch) return failure(DETACHED_HEAD_MESSAGE)
    await run({
      cwd: input.cwd,
      args: snapshot.upstream
        ? ["push"]
        : ["push", "--set-upstream", "origin", snapshot.branch],
      operation: "terminal-git.push",
      timeoutMs: TERMINAL_GIT_REMOTE_TIMEOUT_MS,
    })
    return success(await deps.status.getSnapshot(input.cwd))
  }

  /**
   * 同步 = 拉取 + 推送，把本地和远端对齐。**快进式，因此永远不会产生冲突**：
   * 拉不动就整体失败并报「已分叉，请手动处理」，不要给它也写一套冲突处理。
   */
  async function sync(input: { readonly cwd: string }): Promise<TerminalGitOutcome<TerminalGitSnapshot>> {
    const required = await requireRepository(input.cwd)
    if ("rejected" in required) return required.rejected
    const before = required.snapshot
    const blocked = syncBlocker(before)
    if (blocked) return blocked

    await run({
      cwd: input.cwd,
      args: ["fetch", "--prune"],
      operation: "terminal-git.sync.fetch",
      timeoutMs: TERMINAL_GIT_REMOTE_TIMEOUT_MS,
    })
    const afterFetch = await deps.status.getSnapshot(input.cwd)
    const fetchBlocked = syncBlocker(afterFetch)
    if (fetchBlocked) return fetchBlocked
    if (afterFetch.behind > 0) {
      await run({
        cwd: input.cwd,
        args: ["merge", "--ff-only", "--no-overwrite-ignore", "@{u}"],
        operation: "terminal-git.sync.merge",
        timeoutMs: TERMINAL_GIT_REMOTE_TIMEOUT_MS,
      })
    }
    const afterPull = afterFetch.behind > 0 ? await deps.status.getSnapshot(input.cwd) : afterFetch
    if (afterPull.behind > 0) return failure("远程仍有未拉取提交，请手动处理后重试。")
    if (afterPull.ahead > 0) {
      await run({
        cwd: input.cwd,
        args: ["push"],
        operation: "terminal-git.sync.push",
        timeoutMs: TERMINAL_GIT_REMOTE_TIMEOUT_MS,
      })
    }
    return success(await deps.status.getSnapshot(input.cwd))
  }

  function syncBlocker(snapshot: TerminalGitSnapshot): TerminalGitOutcome<never> | null {
    if (snapshot.changeCount > 0) return failure(DIRTY_WORKING_TREE_MESSAGE)
    if (snapshot.branch === null) return failure(DETACHED_HEAD_MESSAGE)
    if (snapshot.upstream === null) return failure("这条分支还没有上游，请先执行首次推送。")
    if (snapshot.ahead > 0 && snapshot.behind > 0) {
      return failure("本地分支与上游分支已分叉，请使用外部 Git 工具处理后重试。")
    }
    return null
  }

  return { checkout, createBranch, commit, push, sync }
}

/**
 * 给用户看的失败原因：**先给原文**。
 *
 * `runGitCommand` 抛出来的 message 就是 git 自己的 stderr（拿不到才用 stdout、再不行才是兜底
 * 话术），这一层不改写、不翻译 —— 手机端要显示的是电脑返回的原文（`module-boundaries` 里
 * 「不得自己编造失败原因」那条）。只有连原文都没有时，才退回既有的用户话术。
 */
export function gitFailureMessage(error: unknown, fallback: string): string {
  const raw = error instanceof Error ? error.message.trim() : String(error).trim()
  if (raw) return raw
  const userFacing = getGitUserFacingFailure(error)
  return userFacing?.detail ?? userFacing?.message ?? fallback
}
