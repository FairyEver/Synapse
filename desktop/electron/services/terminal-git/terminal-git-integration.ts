import { isSynapseGitChangeConflicted } from "../../../src/types/git"
import type { GitClientCommandRunner } from "../git-client/git-command-runner"
import type { TerminalGitBranchValidator, TerminalGitStatusReader } from "./terminal-git-status"
import { gitFailureMessage } from "./terminal-git-workflow"
import {
  DETACHED_HEAD_MESSAGE,
  DIRTY_WORKING_TREE_MESSAGE,
  NOT_A_REPOSITORY_MESSAGE,
  TERMINAL_GIT_CONFLICT_FILE_LIMIT,
  TERMINAL_GIT_CONFLICT_PATH_LIMIT,
  TERMINAL_GIT_REMOTE_TIMEOUT_MS,
  failure,
  success,
  type TerminalGitConflict,
  type TerminalGitOutcome,
  type TerminalGitSnapshot,
} from "./terminal-git-types"

export type TerminalGitMergeDirection = "intoCurrent" | "outOfCurrent"

export type TerminalGitIntegration = {
  merge(input: {
    readonly cwd: string
    readonly direction: TerminalGitMergeDirection
    readonly branch: string
  }): Promise<TerminalGitOutcome<TerminalGitSnapshot>>
}

export function createTerminalGitIntegration(deps: {
  readonly commandRunner: GitClientCommandRunner
  readonly status: TerminalGitStatusReader
  readonly validateBranchName: TerminalGitBranchValidator
  readonly logger?: { warn(message: string, meta?: unknown): void }
}): TerminalGitIntegration {
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
   * 合并。
   *
   * 两个方向：
   * - `intoCurrent`：在当前分支上 `merge <选中分支>`，合完停在原地；
   * - `outOfCurrent`：把当前分支的成果并进选中分支 —— 切过去、合并、再切回来。
   *   必须离开当前分支，因为 git 没有「留在原地、把成果合进别的分支」这条原语。
   *
   * 一条铁律：**进入 merge 之前先记录「合并前状态」**，冲突回退之后拿它证明真的回退了。
   * 冲突不是一条要用户处理的岔路，是一次自动收尾：abort 回退，然后把一段拼好的文本
   * 交给用户去复制，手机端不提供任何「继续合并 / 标记已解决」的入口。
   */
  async function merge(input: {
    readonly cwd: string
    readonly direction: TerminalGitMergeDirection
    readonly branch: string
  }): Promise<TerminalGitOutcome<TerminalGitSnapshot>> {
    const before = await deps.status.getSnapshot(input.cwd)
    if (!before.isRepository) return failure(NOT_A_REPOSITORY_MESSAGE)
    if (!before.branch) return failure(DETACHED_HEAD_MESSAGE)

    const current = before.branch
    const other = await deps.validateBranchName(input.cwd, input.branch)
    if (!other) return failure(`分支名称不合法：${input.branch}`)
    if (other === current) return failure(`不能把 ${current} 合并到它自己。`)

    const outOfCurrent = input.direction === "outOfCurrent"
    const source = outOfCurrent ? current : other
    const target = outOfCurrent ? other : current

    // 统一都查，两个方向行为一致：方向二要切分支，方向一不切，但用户看到的是同一套交互。
    if (before.changeCount > 0) {
      return failure(DIRTY_WORKING_TREE_MESSAGE, { needsDecision: "dirty" })
    }

    const restore = async (): Promise<void> => {
      if (!outOfCurrent) return
      await run({ cwd: input.cwd, args: ["checkout", current], operation: "terminal-git.merge.restore" })
    }

    try {
      if (outOfCurrent) {
        await run({ cwd: input.cwd, args: ["checkout", other], operation: "terminal-git.merge.checkout-target" })
      }
      await run({
        cwd: input.cwd,
        args: ["merge", source],
        operation: "terminal-git.merge",
        timeoutMs: TERMINAL_GIT_REMOTE_TIMEOUT_MS,
      })
    } catch (error) {
      const after = await deps.status.getSnapshot(input.cwd)
      if (after.hasConflicts) {
        await abortMerge(input.cwd)
        await restore()
        const restored = await deps.status.getSnapshot(input.cwd)
        const rolledBack = sameWorkingState(before, restored)
        const files = conflictFiles(after)
        return failure("检测到冲突，已自动取消合并并回退。", {
          conflict: buildConflict({ cwd: input.cwd, source, target, files, rolledBack }),
        })
      }
      // 其它失败（比如未跟踪文件会被覆盖）：merge 可能已经起来，能 abort 就 abort。
      if (await isMergeInProgress(input.cwd)) await abortMerge(input.cwd)
      const message = gitFailureMessage(error, "合并失败。")
      try {
        await restore()
      } catch (restoreError) {
        return failure(`${message}（另外，切回 ${current} 也没有成功：${gitFailureMessage(restoreError, "未知原因")}）`)
      }
      return failure(message)
    }

    /*
     * 合并已经进了历史，切回原分支失败**不能**把它报成合并失败 —— 用户会以为
     * 什么都没发生，然后去做一遍已经做过的事。所以这条路上报的仍然是成功，
     * 只是把「没切回去」如实说出来（口吻与同步那条「远程仍有未拉取提交」一致）。
     *
     * 说的时候带上真实的分支名：手机端第二行会显示它现在停在哪条分支上，
     * 那句提示要和它对得上。
     */
    try {
      await restore()
    } catch (restoreError) {
      const reason = gitFailureMessage(restoreError, "未知原因")
      deps.logger?.warn("Terminal git merge could not return to the original branch.", {
        cwd: input.cwd,
        branch: current,
        error: restoreError,
      })
      return success(
        await deps.status.getSnapshot(input.cwd),
        `合并已完成，但没能切回 ${current}：${reason}`,
      )
    }
    return success(await deps.status.getSnapshot(input.cwd))
  }

  async function abortMerge(cwd: string): Promise<void> {
    try {
      await run({ cwd, args: ["merge", "--abort"], operation: "terminal-git.merge.abort" })
    } catch (error) {
      // abort 自己失败是罕见但严重的情况：仓库没回到合并前，调用方会看到「回退不一致」
      // 的如实报告，这里留一条日志。
      deps.logger?.warn("Terminal git merge abort failed.", { cwd, error })
    }
  }

  async function isMergeInProgress(cwd: string): Promise<boolean> {
    try {
      const result = await deps.commandRunner.run({
        cwd,
        args: ["rev-parse", "-q", "--verify", "MERGE_HEAD"],
        acceptedExitCodes: [0, 1, 128],
        logFailure: false,
        operation: "terminal-git.merge.probe",
        repoPath: cwd,
      })
      return result.stdout.trim().length > 0
    } catch {
      return false
    }
  }

  return { merge }
}

/** 冲突文件从合并后那份快照里筛，不另跑命令。 */
function conflictFiles(snapshot: TerminalGitSnapshot): readonly string[] {
  return snapshot.changes.filter(isSynapseGitChangeConflicted).map((change) => change.path)
}

/**
 * 合并前 / 回退后是否一致。
 *
 * 只比这几个字段：它们是用户能看见的东西（在哪条分支、多少改动、领先落后）。
 * 不一致时如实说，不假装回退了。
 */
function sameWorkingState(before: TerminalGitSnapshot, after: TerminalGitSnapshot): boolean {
  return before.branch === after.branch
    && before.changeCount === after.changeCount
    && before.ahead === after.ahead
    && before.behind === after.behind
}

/**
 * 给别的 Agent 读的整段文本。
 *
 * 手机端只负责把它放进剪贴板 —— 传输的不是文件清单结构，是一段给人看的文字。
 */
function buildConflict(input: {
  readonly cwd: string
  readonly source: string
  readonly target: string
  readonly files: readonly string[]
  readonly rolledBack: boolean
}): TerminalGitConflict {
  /*
   * 截断在这里，不在协议层：文件清单和那段文本是同一次拼装的产物，分两处截就会
   * 拼出一段说「3 个」、清单里却只有 1 个的文本。截断本身要写在文本里，让读它的人
   * 知道自己看到的不是全部。
   */
  const files = input.files
    .slice(0, TERMINAL_GIT_CONFLICT_FILE_LIMIT)
    .map((file) => (file.length > TERMINAL_GIT_CONFLICT_PATH_LIMIT
      ? `${file.slice(0, TERMINAL_GIT_CONFLICT_PATH_LIMIT)}…`
      : file))
  const omitted = input.files.length - files.length
  const lines = [
    "【Synapse · Git 合并冲突】",
    `仓库目录：${input.cwd}`,
    `操作：把分支 ${input.source} 合并到 ${input.target}`,
    input.rolledBack
      ? "结果：检测到冲突，已自动取消合并并回退（git merge --abort），仓库回到了合并前的状态。"
      : "结果：检测到冲突，已执行 git merge --abort，但仓库状态与合并前不一致，请在电脑上确认后再处理。",
    `冲突文件（共 ${String(input.files.length)} 个）：`,
    ...files.map((file) => `- ${file}`),
    ...(omitted > 0 ? [`（清单只列了前 ${String(files.length)} 个，另有 ${String(omitted)} 个未列出）`] : []),
    "",
    "请帮我解决这些冲突。",
  ]
  return {
    source: input.source,
    target: input.target,
    files,
    summaryText: `${lines.join("\n")}\n`,
  }
}
