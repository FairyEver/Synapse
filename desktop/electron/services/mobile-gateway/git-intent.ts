import { MOBILE_FRAME_LIMITS } from "@synapse/shared/mobile-live-constants"
import type {
  MobileGitAction,
  MobileGitBranch,
  MobileGitConflict,
  MobileGitMergeDirection,
  MobileGitRemoteBranch,
  MobileIntentResult,
} from "@synapse/shared" with { "resolution-mode": "import" }

import type { TerminalService } from "../../../app-capabilities/terminal/main/service"
import type { PermissionAction } from "../../runtime/security/permission-guard"
import type { TerminalGitService } from "../terminal-git/terminal-git-service"
import type { TerminalGitOutcome } from "../terminal-git/terminal-git-types"
import { NOT_A_REPOSITORY_MESSAGE } from "../terminal-git/terminal-git-types"
import { MobileIntentError } from "./intent-executor"

/**
 * 手机发来的 `git` 意图，落到按目录跑 git 的那一层上。
 *
 * 这一层的职责有三个，每个都只做一次：
 *
 * 1. **目录从哪来** —— 请求里没有目录，只有 `sessionId`。目录是电脑按会话解析出来的
 *    （外壳上报的 OSC 7，兜底探测），所以用户在终端里 `cd` 到哪它就跟着到哪。这里用的是
 *    可等待的那一个（`probeCurrentWorkingDirectory`），因为「有人问」正是它的用途：
 *    手机打开面板时拿到的必须是此刻的目录，而不是上一次缓存下来的。
 * 2. **鉴权** —— 每个动作都自己过一遍权限，与既有 19 个 kind 的做法一致。读的走
 *    `terminal.state.read`，写的走 `terminal.git.manage`：借别的名字记审计，
 *    事后查的人会以为当时只是落了一个文件。
 * 3. **结果信封** —— 快照里的 `changes`（改动文件清单）**不许往手机上走**，
 *    所以这里从来不是「把服务的返回值原样转发」，而是挑出这个动作真正要回答的那一块。
 *
 * 它不认识 `repositoryId`，也不碰「代码仓库」注册表。
 */
export type MobileGitIntentRequest = {
  readonly sessionId: string
  readonly action: MobileGitAction
  readonly branch?: string
  readonly fromBranch?: string
  readonly message?: string
  readonly pushAfterCommit?: boolean
  readonly direction?: MobileGitMergeDirection
  readonly discardChanges?: boolean
  /** `checkoutRemote` 的远端名。远端名本身可以含 `/`。 */
  readonly remote?: string
  /** `checkoutRemote` 的另一个本地名；缺席＝与远端分支同名。 */
  readonly localBranch?: string
}

export type MobileGitIntentOutcome = {
  readonly outcome: "accepted" | "rejected"
  readonly code?: string
  readonly message?: string
  readonly git?: NonNullable<MobileIntentResult["git"]>
  /**
   * 这次动作有没有可能改动了仓库。
   *
   * 手机端第二行与面板都以 `mobile.gitStatus` 为准，所以动过仓库之后必须让电脑
   * 重算一次推过去 —— 目录没变，光靠那个「目录变了才重算」的闸门是等不到的。
   */
  readonly repositoryChanged?: boolean
}

export type MobileGitIntentRunner = (request: MobileGitIntentRequest) => Promise<MobileGitIntentOutcome>

export function createMobileGitIntentRunner(deps: {
  readonly terminal: Pick<TerminalService, "probeCurrentWorkingDirectory">
  readonly terminalGit: TerminalGitService
  readonly authorize: (
    action: PermissionAction,
    resource: string,
    context?: Record<string, unknown>,
  ) => Promise<void>
}): MobileGitIntentRunner {
  /**
   * 会话当前所在目录。
   *
   * 会话不在了就如实说：手机可能在它被关掉之后还开着面板。它与「目录读不出来」
   * 是两件事 —— 后者由终端服务自己退回会话启动目录，不是这里的错误。
   */
  async function resolveCwd(sessionId: string): Promise<string> {
    try {
      return await deps.terminal.probeCurrentWorkingDirectory(sessionId)
    } catch {
      throw new MobileIntentError("session_not_found", "这个终端在电脑上已经不在了。")
    }
  }

  /** 这几个动作的名字就是它们要的那个分支，缺了就没法进行下去。 */
  function needsBranch(action: MobileGitAction): boolean {
    return action === "checkout" || action === "createBranch" || action === "merge"
      || action === "checkoutRemote"
  }

  /**
   * 只有 `checkoutRemote` 要远端名。
   *
   * 它与 `branch` 一样是「缺了就走不下去」的那一类，所以走同一个 `required` ——
   * 先核参数、再碰仓库，与 `branch` 那条同一个理由。
   */
  function needsRemote(action: MobileGitAction): boolean {
    return action === "checkoutRemote"
  }

  function required(value: string | undefined, what: string): string {
    const trimmed = value?.trim() ?? ""
    if (!trimmed) throw new MobileIntentError("invalid_argument", `${what}没有指定。`)
    return trimmed
  }

  return async (request) => {
    /*
     * 先把这个动作必需的参数核一遍，再碰仓库。
     *
     * 顺序是有意的：一个缺参数的请求不该先跑一条 `git rev-parse` 才被拒 —— 那既浪费
     * 一次执行，也让「参数不对」与「目录不对」在审计里长得一样。
     */
    const action = request.action
    // 空串是「这个动作不需要分支」的占位，下面只在需要它的分支里读 —— 真缺了
    // `required` 会先抛，读不到空串。
    const branch = needsBranch(action) ? required(request.branch, "要操作的分支") : ""
    const remote = needsRemote(action) ? required(request.remote, "远端") : ""
    const message = action === "commit" ? required(request.message, "提交信息") : ""

    const cwd = await resolveCwd(request.sessionId)

    // 读操作按只读动作的口径处理（`terminal.state.read`），写的另有一个名字。
    // `remoteBranches` 是读（只读缓存的 `refs/remotes`，不联网），`fetchRemotes` 与
    // `checkoutRemote` 是写 —— 联网那一次也记在写的名字下。
    if (action === "status" || action === "branches" || action === "remoteBranches") {
      await deps.authorize("terminal.state.read", sessionResource(request.sessionId))
    } else {
      await deps.authorize("terminal.git.manage", sessionResource(request.sessionId))
    }

    /**
     * 回答**不走结果信封**：手机端的状态永远以 `mobile.gitStatus` 为准，两个来源写
     * 同一件事迟早会分叉。这个动作要的只是「重算一次并推给我」，也就是手机端在
     * 面板上拉一次的效果 —— 所以它自己一条 git 命令都不跑，也就不需要先问是不是仓库：
     * 「不是仓库」由那份推算出来的状态说（`status: null`），第二行据此退回版本号。
     */
    if (action === "status") return { outcome: "accepted", repositoryChanged: true }

    /*
     * 写动作自己也有一道「不是仓库就一行命令都不跑」的守卫，但那道守卫给出的是一句
     * 与这里完全相同的话、却没有一个能分辨的 code。写动作本来就慢（一次 merge 是
     * 上百毫秒），多一次 `rev-parse` 换一个手机能分辨的答案，值。
     */
    if (!(await deps.terminalGit.isRepository(cwd))) {
      return { outcome: "rejected", code: "not_a_repository", message: NOT_A_REPOSITORY_MESSAGE }
    }

    switch (action) {
      case "branches": {
        const branches = await deps.terminalGit.listBranches(cwd)
        return { outcome: "accepted", git: { branches: branches.map(toWireBranch) } }
      }

      case "checkout":
        return fromOutcome(await deps.terminalGit.checkout({
          cwd,
          branch,
          ...(request.discardChanges === true ? { discardChanges: true } : {}),
        }), true)

      case "createBranch":
        return fromOutcome(await deps.terminalGit.createBranch({
          cwd,
          branch,
          ...(request.fromBranch === undefined ? {} : { fromBranch: request.fromBranch }),
        }), true)

      case "commit":
        return commit(cwd, message, request)

      case "push":
        return fromOutcome(await deps.terminalGit.push({ cwd }), true)

      case "sync":
        return fromOutcome(await deps.terminalGit.sync({ cwd }), true)

      case "merge":
        return fromOutcome(await deps.terminalGit.merge({
          cwd,
          branch,
          // 方向缺省成「合进当前分支」：手机端两行都画出来让用户选，这一条只是兜底，
          // 而且它是更不容易出错的那一个（不离开当前分支）。
          direction: request.direction === "outOfCurrent" ? "outOfCurrent" : "intoCurrent",
        }), true)

      case "remoteBranches": {
        const branches = await deps.terminalGit.listRemoteBranches(cwd)
        /*
         * 超过上界就**在产生端截断**：校验器那边是 `boundedArray(..., maxGitBranches)`，
         * 超了整条结果被判非法、结果被丢，手机上表现为「电脑一直没有回答」——
         * 比少列几条糟得多。截了一条就要说一句：不说的截断等于骗人。
         */
        const listed = branches.slice(0, MOBILE_FRAME_LIMITS.maxGitBranches)
        return {
          outcome: "accepted",
          git: { remoteBranches: listed.map(toWireRemoteBranch) },
          ...(branches.length > listed.length
            ? { message: `远端分支过多，只列出了前 ${MOBILE_FRAME_LIMITS.maxGitBranches} 条。` }
            : {}),
        }
      }

      case "fetchRemotes":
        return fromOutcome(await deps.terminalGit.fetchRemotes({ cwd }), true)

      case "checkoutRemote":
        return fromOutcome(await deps.terminalGit.checkoutRemote({
          cwd,
          remote,
          branch,
          ...(request.localBranch === undefined ? {} : { localBranch: request.localBranch }),
          ...(request.discardChanges === true ? { discardChanges: true } : {}),
        }), true)
    }
  }

  /**
   * 提交，（可选）接着推送。
   *
   * 两件事合成一个意图，因为手机上的那个开关就是一次决定。但**结果要分开说**：
   * 提交成功、推送没成，报的仍然是提交成功 —— 提交已经进了历史，说成失败会让用户
   * 再去提交一次，而那一次只会得到「没有改动可提交」。
   */
  async function commit(
    cwd: string,
    message: string,
    request: MobileGitIntentRequest,
  ): Promise<MobileGitIntentOutcome> {
    const committed = await deps.terminalGit.commit({ cwd, message })
    if (!committed.ok) return fromOutcome(committed, false)

    if (request.pushAfterCommit !== true) {
      return { outcome: "accepted", repositoryChanged: true }
    }
    const pushed = await deps.terminalGit.push({ cwd })
    if (pushed.ok) {
      return {
        outcome: "accepted",
        repositoryChanged: true,
        ...(pushed.message === undefined ? {} : { message: clampMessage(pushed.message) }),
      }
    }
    return {
      outcome: "accepted",
      repositoryChanged: true,
      message: clampMessage(`提交已完成，但推送没有成功：${pushed.message}`),
    }
  }
}

/**
 * 把服务层的结论翻成手机能读的结果。
 *
 * `needsDecision` 与 `conflict` 都仍然算 `rejected`（它们带着一句要显示的话，也只有
 * 这个分支放得下），但手机靠 `git` 这两个字段区分「出了一条错误」与「要弹一个选择」。
 */
function fromOutcome(
  outcome: TerminalGitOutcome<unknown>,
  repositoryChanged: boolean,
): MobileGitIntentOutcome {
  if (outcome.ok) {
    return {
      outcome: "accepted",
      ...(outcome.message === undefined ? {} : { message: clampMessage(outcome.message) }),
      ...(repositoryChanged ? { repositoryChanged: true } : {}),
    }
  }
  const git: {
    branches?: readonly MobileGitBranch[]
    conflict?: MobileGitConflict
    needsDecision?: "dirty" | "localBranchName"
  } = {}
  // 原样透传：手机靠这个取值分「弹三选一」与「推一页填名字」，写死 `"dirty"` 会让后者
  // 变成一句错，而用户根本没有出路。
  if (outcome.needsDecision) git.needsDecision = outcome.needsDecision
  if (outcome.conflict) git.conflict = toWireConflict(outcome.conflict)
  return {
    outcome: "rejected",
    code: outcome.needsDecision === "dirty"
      ? "dirty_working_tree"
      : outcome.needsDecision === "localBranchName"
        ? "local_branch_conflict"
        : outcome.conflict
          ? "merge_conflict"
          : "git_failed",
    message: clampMessage(outcome.message),
    ...(Object.keys(git).length === 0 ? {} : { git }),
  }
}

/**
 * 失败原文按线上的上限收一下。
 *
 * 消息走的是 `MobileIntentResult.message`，而那条字段在云端有长度上限 —— 超了会被
 * 当成非法消息**直接丢掉**，手机上表现为「点了没反应」，比截断难查得多。git 的 stderr
 * 长度不由我们决定，所以这一刀必须在这里落。
 *
 * 冲突那段可复制的文本不受这一刀影响：它走 `git.conflict.summaryText`，有自己的上限，
 * 而且是手机真正要复制走的东西 —— 从中间截断它就等于把它毁了。
 */
function clampMessage(message: string): string {
  const limit = MOBILE_FRAME_LIMITS.maxIntentResultMessageLength
  return message.length <= limit ? message : `${message.slice(0, limit - 1)}…`
}

/**
 * 两个数组都按线上的上界收一下。
 *
 * 截断本该发生在产生端（`terminal-git-integration.ts` 拼那段文本时），这里只是
 * **协议边界**的第二道：真正不可替代的是 `summaryText`，`files` 只用来让手机说
 * 「有 N 个文件冲突」，所以清单超量时收的是清单，文本一个字都不动。
 */
function toWireConflict(conflict: {
  readonly source: string
  readonly target: string
  readonly files: readonly string[]
  readonly summaryText: string
}): MobileGitConflict {
  return {
    source: clamp(conflict.source, MOBILE_FRAME_LIMITS.maxGitRefNameLength),
    target: clamp(conflict.target, MOBILE_FRAME_LIMITS.maxGitRefNameLength),
    files: conflict.files
      .slice(0, MOBILE_FRAME_LIMITS.maxGitConflictFiles)
      .map((file) => clamp(file, MOBILE_FRAME_LIMITS.maxGitPathLength)),
    summaryText: conflict.summaryText,
  }
}

/** 分支名是 ref 名，按同一个上界收。 */
function toWireBranch(branch: { readonly name: string; readonly current: boolean }): MobileGitBranch {
  return { name: clamp(branch.name, MOBILE_FRAME_LIMITS.maxGitRefNameLength), current: branch.current }
}

/** 远端分支的两段都是 ref 名，按同一个上界收。 */
function toWireRemoteBranch(branch: {
  readonly remote: string
  readonly name: string
}): MobileGitRemoteBranch {
  return {
    remote: clamp(branch.remote, MOBILE_FRAME_LIMITS.maxGitRefNameLength),
    name: clamp(branch.name, MOBILE_FRAME_LIMITS.maxGitRefNameLength),
  }
}

function clamp(value: string, maxLength: number): string {
  if (value.length <= maxLength) return value
  const clipped = value.slice(0, maxLength)
  // 别留下半个代理对：JSON 转义之后手机会渲染成一个替换字符。
  return /[\uD800-\uDBFF]$/.test(clipped) ? clipped.slice(0, -1) : clipped
}

function sessionResource(sessionId: string): string {
  return `terminal.session:${sessionId}`
}
