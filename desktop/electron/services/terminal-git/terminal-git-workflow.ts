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
  fetchRemotes(input: { readonly cwd: string }): Promise<TerminalGitOutcome<TerminalGitSnapshot>>
  checkoutRemote(input: {
    readonly cwd: string
    readonly remote: string
    readonly branch: string
    readonly localBranch?: string
    readonly discardChanges?: boolean
  }): Promise<TerminalGitOutcome<TerminalGitSnapshot>>
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

  /**
   * 同步远端引用。**只 fetch，不碰本地分支、不 merge、不 push** —— 它服务的是
   * 「远端分支列表要最新的」这一件事，与「同步」（拉 + 推）不是同一件事，也不该
   * 因为用户想看列表就顺手把一个 merge 做了。
   *
   * 无远端时 `git fetch --all --prune` 退出码 0、不报错，所以这里不预先拦。
   */
  async function fetchRemotes(input: { readonly cwd: string }): Promise<TerminalGitOutcome<TerminalGitSnapshot>> {
    const required = await requireRepository(input.cwd)
    if ("rejected" in required) return required.rejected
    await run({
      cwd: input.cwd,
      args: ["fetch", "--all", "--prune"],
      operation: "terminal-git.remote-branch.fetch",
      timeoutMs: TERMINAL_GIT_REMOTE_TIMEOUT_MS,
    })
    return success(await deps.status.getSnapshot(input.cwd))
  }

  /**
   * 迁出一条远端分支：建一条跟踪它的本地分支并切过去，或者切到已有的同名分支。
   *
   * 与 `checkout` 同款的三条规矩：**已经在这条分支上就什么都不做**（带 `-f` 的一条会把
   * 改动丢掉却什么也没换到）、**脏工作区不替用户决定**、**丢弃只丢已跟踪文件的修改**。
   *
   * 与桌面端 `git-branch-service.ts` 的 `checkoutRemote` 是同一套规则，但那条绑
   * `repositoryId` 与「代码仓库」注册表，这里只认路径。
   */
  async function checkoutRemote(input: {
    readonly cwd: string
    readonly remote: string
    readonly branch: string
    readonly localBranch?: string
    readonly discardChanges?: boolean
  }): Promise<TerminalGitOutcome<TerminalGitSnapshot>> {
    const required = await requireRepository(input.cwd)
    if ("rejected" in required) return required.rejected
    const { snapshot } = required

    const remote = input.remote.trim()
    if (!remote) return failure("没有指定远端。")
    const remotes = await deps.commandRunner.run({
      cwd: input.cwd,
      args: ["remote"],
      operation: "terminal-git.checkout-remote.remotes",
      repoPath: input.cwd,
    })
    if (!remotes.stdout.split(/\r?\n/).map((value) => value.trim()).includes(remote)) {
      return failure(`远端不存在：${remote}。`)
    }

    const branch = await deps.validateBranchName(input.cwd, input.branch)
    if (!branch) return failure(`分支名称不合法：${input.branch}`)
    const remoteBranch = `${remote}/${branch}`
    const remoteRef = await deps.commandRunner.run({
      cwd: input.cwd,
      args: ["rev-parse", "--verify", "--quiet", `refs/remotes/${remoteBranch}`],
      acceptedExitCodes: [0, 1],
      operation: "terminal-git.checkout-remote.verify",
      repoPath: input.cwd,
    })
    if (!remoteRef.stdout.trim()) return failure(`远端分支不存在：${remoteBranch}。下拉刷新之后再试。`)

    /*
     * 这一步就是「要哪个本地名」的全部。回 `localBranchName` 是请手机推一页让用户填一个，
     * 而不是报一个错 —— 它不是失败，是一个问题。
     */
    const wanted = input.localBranch === undefined ? branch : input.localBranch.trim()
    const wantedName = await deps.validateBranchName(input.cwd, wanted)
    if (!wantedName) return failure(`分支名称不合法：${wanted}`, { needsDecision: "localBranchName" })
    const localRef = await deps.commandRunner.run({
      cwd: input.cwd,
      args: ["rev-parse", "--verify", "--quiet", `refs/heads/${wantedName}`],
      acceptedExitCodes: [0, 1],
      operation: "terminal-git.checkout-remote.local",
      repoPath: input.cwd,
    })
    const localExists = Boolean(localRef.stdout.trim())
    if (input.localBranch !== undefined) {
      // 用户点名的那个名字必须是一条**新**分支：重名就再问一个。
      if (localExists) {
        return failure(`本地已有 ${wantedName}，换一个名字。`, { needsDecision: "localBranchName" })
      }
    } else if (localExists) {
      // 同名分支已存在：只有它跟踪的正是这条远端分支时，才可以「就是它」。
      const upstream = await deps.commandRunner.run({
        cwd: input.cwd,
        args: ["for-each-ref", "--format=%(upstream:short)", `refs/heads/${wantedName}`],
        operation: "terminal-git.checkout-remote.upstream",
        repoPath: input.cwd,
      })
      const tracking = upstream.stdout.trim()
      if (tracking !== remoteBranch) {
        return failure(
          tracking ? `本地已有 ${wantedName}，它跟踪的是 ${tracking}。` : `本地已有 ${wantedName}，它没有上游。`,
          { needsDecision: "localBranchName" },
        )
      }
    }

    // 已经在这条分支上：什么都不做，也**不许走丢弃那条路** —— 那会把改动丢掉却什么也没换到。
    if (localExists && wantedName === snapshot.branch) {
      return success(snapshot, `已经在 ${wantedName} 上，没有做任何操作。`)
    }

    if (!input.discardChanges) {
      const dirty = dirtyDecision(snapshot)
      if (dirty) return dirty
    }

    await run({
      cwd: input.cwd,
      /*
       * 新建那条**必须显式 `--track`**：绝不能依赖 DWIM，`checkout -b <name>` 在没有起点时
       * 是「从当前 HEAD 建一条同名分支」，用户以为拿到了远端那条，实际拿到一条静静分叉的分支。
       * 丢弃那条不带 `--no-overwrite-ignore` —— 与既有 `checkout -f` 逐字一致。
       */
      args: localExists
        ? (input.discardChanges
            ? ["checkout", "-f", wantedName]
            : ["checkout", "--no-overwrite-ignore", wantedName])
        : (input.discardChanges
            ? ["checkout", "-f", "--no-overwrite-ignore", "-b", wantedName, "--track", remoteBranch]
            : ["checkout", "--no-overwrite-ignore", "-b", wantedName, "--track", remoteBranch]),
      operation: localExists ? "terminal-git.checkout-remote.switch" : "terminal-git.checkout-remote.create",
    })
    /*
     * 成功那句话由**电脑**说：只有它解析得出最终用的是哪个本地名（可能不是手机猜的那个）。
     * 手机那侧的 success 文案只是兜底。
     */
    return success(
      await deps.status.getSnapshot(input.cwd),
      localExists ? `已切换到 ${wantedName}。` : `已迁出 ${remoteBranch} 到 ${wantedName}。`,
    )
  }

  return { checkout, createBranch, commit, push, sync, fetchRemotes, checkoutRemote }
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
