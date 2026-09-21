import type { SynapseGitWorkingTreeChange } from "../../../src/types/git"

/**
 * 按目录跑 git 的领域类型。
 *
 * 这一层**只认路径**：没有 `repositoryId`、没有注册表、没有「先添加本地仓库」这一步。
 * 它与 Synapse 的「代码仓库」那套没有产品关系，共享的只有底层的命令封装与解析器。
 */

export type TerminalGitBranch = {
  readonly name: string
  readonly current: boolean
}

export type TerminalGitSnapshot = {
  readonly cwd: string
  readonly isRepository: boolean
  readonly branch: string | null
  /** 只有游离 HEAD 时才有值（短 sha）。 */
  readonly detachedSha: string | null
  readonly upstream: string | null
  readonly ahead: number
  readonly behind: number
  readonly changeCount: number
  readonly hasConflicts: boolean
  /** 给内部判断用（脏检查、冲突文件）；**不往手机上发**。 */
  readonly changes: readonly SynapseGitWorkingTreeChange[]
}

/**
 * 合并冲突的结论。手机端只负责把 `summaryText` 复制走 ——
 * 它是一段给人（以及别的 Agent）读的完整说明，不是文件清单结构。
 */
export type TerminalGitConflict = {
  readonly source: string
  readonly target: string
  readonly files: readonly string[]
  readonly summaryText: string
}

export type TerminalGitFailure = {
  /** 给用户看的原文，不改写。 */
  readonly message: string
  /** 有未提交改动，需要用户先选一个走法（提交并切换 / 丢弃并切换 / 取消）。 */
  readonly needsDecision?: "dirty"
  readonly conflict?: TerminalGitConflict
}

export type TerminalGitOutcome<T> =
  /**
   * `message` 是**成功但有话说**：操作已经达成，另有一件用户需要知道的事没做成
   * （例如合并成功、却没切回原分支）。它绝不能借失败的形状说 —— 手机端拿到
   * `ok: false` 会说「合并失败」，而合并其实已经进了历史。
   */
  | { readonly ok: true; readonly value: T; readonly message?: string }
  | ({ readonly ok: false } & TerminalGitFailure)

export const NOT_A_REPOSITORY_MESSAGE = "这个目录不是 Git 仓库。"
export const DETACHED_HEAD_MESSAGE = "当前处于游离状态，请先切换到一条分支。"
export const DIRTY_WORKING_TREE_MESSAGE = "当前目录里有未提交的改动。"

/** 同步类操作天然慢，超时值参考既有的 120s；其余命令沿用默认的 60s。 */
export const TERMINAL_GIT_REMOTE_TIMEOUT_MS = 120_000

export function emptySnapshot(cwd: string): TerminalGitSnapshot {
  return {
    cwd,
    isRepository: false,
    branch: null,
    detachedSha: null,
    upstream: null,
    ahead: 0,
    behind: 0,
    changeCount: 0,
    hasConflicts: false,
    changes: [],
  }
}

export function failure(message: string, extra: Omit<TerminalGitFailure, "message"> = {}): TerminalGitOutcome<never> {
  return { ok: false, message, ...extra }
}

export function success<T>(value: T, message?: string): TerminalGitOutcome<T> {
  return { ok: true, value, ...(message === undefined ? {} : { message }) }
}
