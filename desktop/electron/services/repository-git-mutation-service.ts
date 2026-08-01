import type { SynapseRepositoryConfig } from "../../src/types/config"
import type { SynapseRepositoryLocalState } from "../../src/types/repository"
import { isGitRebaseInProgress, runGitCommand, type GitCommandResult } from "./git-command"
import { formatGitFailureMessage } from "./git-error-utils"
import { toRepositoryGitPaths } from "./git-paths"
import { assertNoPreexistingGitRebase } from "./git-rebase-guard"
import { createMainLogger } from "./log-store"
import { repositoryLockManager } from "./repository-lock-manager"
import { repositoryStore } from "./repository-store"

const SYNAPSE_BOT_NAME = "Synapse Bot"
const SYNAPSE_BOT_EMAIL = "bot@synapse.local"
const GIT_LOCAL_OPERATION_TIMEOUT_MS = 30_000
const GIT_REMOTE_OPERATION_TIMEOUT_MS = 60_000
const logger = createMainLogger("service.repository-git-mutation")

type GitProgressListener = (statusText: string) => void

function runRepositoryGitCommand(
  cwd: string,
  args: string[],
  fallbackMessage: string,
  options: {
    onProgress?: GitProgressListener
    timeoutMessage?: string
    timeoutMs?: number
  } = {},
): Promise<GitCommandResult> {
  return runGitCommand({
    args,
    cwd,
    fallbackMessage,
    formatFailureMessage: formatGitFailureMessage,
    onLine: options.onProgress,
    timeoutMessage: options.timeoutMessage ?? fallbackMessage,
    timeoutMs: options.timeoutMs ?? GIT_LOCAL_OPERATION_TIMEOUT_MS,
  })
}

async function readReadyRepositoryState(
  repository: SynapseRepositoryConfig,
): Promise<SynapseRepositoryLocalState> {
  const state = await repositoryStore.getRepositoryState(repository)

  if (state.status !== "ready") {
    throw new Error("当前目录不存在，请先在 Settings 里重新选择本地目录。")
  }

  return state
}

async function runRepositoryGitExclusive<T>(
  repository: SynapseRepositoryConfig,
  operation: string,
  task: (state: SynapseRepositoryLocalState) => Promise<T>,
): Promise<T> {
  const state = await readReadyRepositoryState(repository)

  if (!state.isGitRepository || !state.gitRootPath) {
    return task(state)
  }

  const release = await repositoryLockManager.acquire(state.gitRootPath, operation)
  try {
    return await task(state)
  } finally {
    release()
  }
}

async function abortStartedRebase(localPath: string): Promise<void> {
  if (!(await isGitRebaseInProgress(localPath))) return

  logger.warn("Aborting rebase started by Synapse after a conflict.", { localPath })
  await runRepositoryGitCommand(
    localPath,
    ["rebase", "--abort"],
    "无法中止 rebase，请手动检查仓库状态。",
  )
}

async function pullRepositoryWithSafeRebase(
  repository: SynapseRepositoryConfig,
  onProgress?: GitProgressListener,
): Promise<void> {
  onProgress?.("正在拉取最新内容...")
  await assertNoPreexistingGitRebase(repository.localPath, (localPath) => {
    logger.warn("Synapse pull skipped because the repository already has a rebase in progress.", { localPath })
  })

  try {
    await runRepositoryGitCommand(
      repository.localPath,
      ["pull", "--rebase"],
      "同步仓库失败，请检查网络或仓库状态后重试。",
      {
        onProgress,
        timeoutMessage: "同步仓库超时，请检查网络后重试。",
        timeoutMs: GIT_REMOTE_OPERATION_TIMEOUT_MS,
      },
    )
  } catch (error) {
    await abortStartedRebase(repository.localPath)
    throw error
  }
}

async function readCommitIdentityArgs(gitRootPath: string): Promise<string[]> {
  const [nameResult, emailResult] = await Promise.all([
    runRepositoryGitCommand(
      gitRootPath,
      ["config", "--get", "user.name"],
      "无法读取 Git 提交身份。",
    ).catch(() => null),
    runRepositoryGitCommand(
      gitRootPath,
      ["config", "--get", "user.email"],
      "无法读取 Git 提交身份。",
    ).catch(() => null),
  ])

  if (nameResult?.stdout.trim() && emailResult?.stdout.trim()) {
    return []
  }

  return [
    "-c", `user.name=${SYNAPSE_BOT_NAME}`,
    "-c", `user.email=${SYNAPSE_BOT_EMAIL}`,
  ]
}

async function commitRepositoryPaths(input: {
  readonly fallbackMessage: string
  readonly filePaths: readonly string[]
  readonly gitRootPath: string
  readonly message: string
}): Promise<string> {
  const resolvedRelativePaths = toRepositoryGitPaths(input.gitRootPath, [...input.filePaths])

  if (resolvedRelativePaths.length !== input.filePaths.length) {
    throw new Error("提交路径必须位于当前 Git 仓库内。")
  }

  const relativePaths = [...new Set(resolvedRelativePaths)]

  if (relativePaths.length === 0) {
    throw new Error("当前没有可提交的改动。")
  }

  await runRepositoryGitCommand(
    input.gitRootPath,
    ["--literal-pathspecs", "add", "--", ...relativePaths],
    "暂存本地改动失败。",
  )

  const identityArgs = await readCommitIdentityArgs(input.gitRootPath)
  await runRepositoryGitCommand(
    input.gitRootPath,
    [
      ...identityArgs,
      "--literal-pathspecs",
      "commit",
      "--only",
      "-m",
      input.message,
      "--",
      ...relativePaths,
    ],
    input.fallbackMessage,
  )

  const headCommit = await runRepositoryGitCommand(
    input.gitRootPath,
    ["rev-parse", "HEAD"],
    "读取最新提交失败。",
  )

  return headCommit.stdout.trim()
}

async function readUnpushedCommitCount(
  repository: SynapseRepositoryConfig,
  state?: SynapseRepositoryLocalState,
): Promise<number> {
  const repositoryState = state ?? await readReadyRepositoryState(repository)
  if (!repositoryState.isGitRepository || !repositoryState.gitRootPath) return 0

  try {
    const result = await runRepositoryGitCommand(
      repositoryState.gitRootPath,
      ["rev-list", "--count", "@{u}..HEAD"],
      "无法读取待推送提交。",
    )
    return Math.max(0, Number.parseInt(result.stdout.trim(), 10) || 0)
  } catch (upstreamError) {
    logger.debug("Git upstream is unavailable; checking commits absent from every remote.", {
      error: upstreamError instanceof Error ? upstreamError.message : String(upstreamError),
      gitRootPath: repositoryState.gitRootPath,
    })
  }

  try {
    const result = await runRepositoryGitCommand(
      repositoryState.gitRootPath,
      ["rev-list", "--count", "HEAD", "--not", "--remotes"],
      "无法读取待推送提交。",
    )
    return Math.max(0, Number.parseInt(result.stdout.trim(), 10) || 0)
  } catch (fallbackError) {
    logger.warn("Unable to determine unpushed commit count.", {
      error: fallbackError instanceof Error ? fallbackError.message : String(fallbackError),
      gitRootPath: repositoryState.gitRootPath,
    })
    return 0
  }
}

export {
  commitRepositoryPaths,
  pullRepositoryWithSafeRebase,
  readReadyRepositoryState,
  readUnpushedCommitCount,
  runRepositoryGitExclusive,
}
