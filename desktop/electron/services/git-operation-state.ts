import { access } from "node:fs/promises"
import path from "node:path"
import type { SynapseGitRepositoryOperationState } from "../../src/types/git"

type GitOperationStateCommand = (args: readonly string[]) => Promise<{ readonly stdout: string }>
type PathExists = (filePath: string) => Promise<boolean>

type GitRepositoryOperationDiagnostics = {
  readonly indexLockExists: boolean
  readonly operationState: SynapseGitRepositoryOperationState
}

const OPERATION_STATE_MESSAGE: Record<Exclude<SynapseGitRepositoryOperationState, "normal">, string> = {
  merge: "当前仓库正在进行合并，请先在外部 Git 工具中完成或中止后再重试。",
  rebase: "当前仓库正在进行 rebase，请先在外部 Git 工具中完成或中止后再重试。",
  "cherry-pick": "当前仓库正在进行 cherry-pick，请先在外部 Git 工具中完成或中止后再重试。",
  revert: "当前仓库正在进行 revert，请先在外部 Git 工具中完成或中止后再重试。",
  bisect: "当前仓库正在进行 bisect，请先在外部 Git 工具中完成或中止后再重试。",
  unknown: "无法确认当前仓库的 Git 操作状态，请在外部 Git 工具中检查后再重试。",
}

async function defaultPathExists(filePath: string): Promise<boolean> {
  try {
    await access(filePath)
    return true
  } catch {
    return false
  }
}

function resolveGitPath(repositoryPath: string, gitPath: string): string {
  return path.isAbsolute(gitPath) ? gitPath : path.join(repositoryPath, gitPath)
}

async function readGitRepositoryOperationDiagnostics(input: {
  readonly localPath: string
  readonly pathExists?: PathExists
  readonly run: GitOperationStateCommand
}): Promise<GitRepositoryOperationDiagnostics> {
  const result = await input.run([
    "rev-parse",
    "--git-path", "index.lock",
    "--git-path", "MERGE_HEAD",
    "--git-path", "rebase-merge",
    "--git-path", "rebase-apply",
    "--git-path", "CHERRY_PICK_HEAD",
    "--git-path", "REVERT_HEAD",
    "--git-path", "BISECT_LOG",
  ])
  const paths = result.stdout.split(/\r?\n/u).map((line) => line.trim())
  if (paths.length < 7 || paths.slice(0, 7).some((value) => !value)) {
    throw new Error("Git 仓库状态探测返回了无效结果。")
  }

  const exists = input.pathExists ?? defaultPathExists
  const [
    indexLockExists,
    mergeInProgress,
    rebaseMergeInProgress,
    rebaseApplyInProgress,
    cherryPickInProgress,
    revertInProgress,
    bisectInProgress,
  ] = await Promise.all(paths.slice(0, 7).map((gitPath) => exists(resolveGitPath(input.localPath, gitPath))))

  const operationState: SynapseGitRepositoryOperationState = rebaseMergeInProgress || rebaseApplyInProgress
    ? "rebase"
    : mergeInProgress
      ? "merge"
      : cherryPickInProgress
        ? "cherry-pick"
        : revertInProgress
          ? "revert"
          : bisectInProgress
            ? "bisect"
            : "normal"

  return { indexLockExists, operationState }
}

async function assertGitWorktreeMutationAllowed(input: {
  readonly localPath: string
  readonly pathExists?: PathExists
  readonly run: GitOperationStateCommand
}): Promise<void> {
  let diagnostics: GitRepositoryOperationDiagnostics
  try {
    diagnostics = await readGitRepositoryOperationDiagnostics(input)
  } catch (error) {
    throw new Error(OPERATION_STATE_MESSAGE.unknown, { cause: error })
  }
  if (diagnostics.operationState !== "normal") {
    throw new Error(OPERATION_STATE_MESSAGE[diagnostics.operationState])
  }
}

export {
  assertGitWorktreeMutationAllowed,
  OPERATION_STATE_MESSAGE,
  readGitRepositoryOperationDiagnostics,
}
export type { GitRepositoryOperationDiagnostics }
