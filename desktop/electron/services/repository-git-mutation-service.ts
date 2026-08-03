import { mkdtemp, rm } from "node:fs/promises"
import path from "node:path"
import type { SynapseRepositoryConfig } from "../../src/types/config"
import type { SynapseRepositoryLocalState } from "../../src/types/repository"
import { runGitCommand, type GitCommandResult } from "./git-command"
import { formatGitFailureMessage } from "./git-error-utils"
import { toRepositoryGitPaths } from "./git-paths"
import { assertNoPreexistingGitRebase, recoverOwnedRebase } from "./git-rebase-guard"
import { assertGitWorktreeMutationAllowed } from "./git-operation-state"
import { assertNoIgnoredPathCollisions } from "./git-working-tree-safety"
import { createMainLogger } from "./log-store"
import { repositoryLockManager } from "./repository-lock-manager"
import { repositoryStore } from "./repository-store"

const SYNAPSE_BOT_NAME = "Synapse Bot"
const SYNAPSE_BOT_EMAIL = "bot@synapse.local"
const GIT_LOCAL_OPERATION_TIMEOUT_MS = 30_000
const GIT_REMOTE_OPERATION_TIMEOUT_MS = 60_000
const logger = createMainLogger("service.repository-git-mutation")

type GitProgressListener = (statusText: string) => void

class RepositoryCommitCreatedError extends Error {
  readonly commitHash: string

  constructor(commitHash: string, options?: ErrorOptions) {
    super("提交已创建，但无法校正内容文件的暂存状态，请在 Git 工具中检查暂存区。", options)
    this.name = "RepositoryCommitCreatedError"
    this.commitHash = commitHash
  }
}

function runRepositoryGitCommand(
  cwd: string,
  args: string[],
  fallbackMessage: string,
  options: {
    captureStdout?: false
    gitIndexFile?: string
    onStdoutChunk?: (chunk: Uint8Array) => void
    onProgress?: GitProgressListener
    timeoutMessage?: string
    timeoutMs?: number
  } = {},
): Promise<GitCommandResult> {
  return runGitCommand({
    args,
    cwd,
    fallbackMessage,
    captureStdout: options.captureStdout,
    formatFailureMessage: formatGitFailureMessage,
    gitIndexFile: options.gitIndexFile,
    onLine: options.onProgress,
    onStdoutChunk: options.onStdoutChunk,
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

async function pullRepositoryWithSafeRebase(
  repository: SynapseRepositoryConfig,
  onProgress?: GitProgressListener,
): Promise<void> {
  onProgress?.("正在拉取最新内容...")
  await assertGitWorktreeMutationAllowed({
    localPath: repository.localPath,
    run: (args) => runRepositoryGitCommand(repository.localPath, [...args], "无法确认仓库 Git 操作状态。"),
  })
  await assertNoPreexistingGitRebase(repository.localPath, (localPath) => {
    logger.warn("Synapse pull skipped because the repository already has a rebase in progress.", { localPath })
  })

  const remoteOptions = {
    onProgress,
    timeoutMessage: "同步仓库超时，请检查网络后重试。",
    timeoutMs: GIT_REMOTE_OPERATION_TIMEOUT_MS,
  }
  await runRepositoryGitCommand(
    repository.localPath,
    ["fetch", "--prune"],
    "同步仓库失败，请检查网络或仓库状态后重试。",
    remoteOptions,
  )
  const run = (args: readonly string[], streamOptions?: { readonly captureStdout: false; readonly onStdoutChunk: (chunk: Uint8Array) => void }) => runRepositoryGitCommand(
    repository.localPath,
    [...args],
    "同步仓库失败，请检查网络或仓库状态后重试。",
    { ...remoteOptions, ...streamOptions },
  )
  const [origHeadResult, ontoResult] = await Promise.all([
    run(["rev-parse", "HEAD"]),
    run(["rev-parse", "@{u}"]),
  ])
  const expectedOrigHead = origHeadResult.stdout.trim()
  const expectedOnto = ontoResult.stdout.trim()
  await assertNoIgnoredPathCollisions({ run, target: expectedOnto })
  try {
    await run(["rebase", expectedOnto])
  } catch (error) {
    const recovery = await recoverOwnedRebase({
      error,
      expectedOnto,
      expectedOrigHead,
      localPath: repository.localPath,
      run,
    })
    if (recovery === "not-owned" || recovery === "not-recoverable") {
      throw new Error("同步失败，检测到无法确认归属的 rebase 状态；Synapse 未执行中止，请在 Git 工具中检查。", { cause: error })
    }
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

  const runStateProbe = (args: readonly string[]) => runRepositoryGitCommand(
    input.gitRootPath,
    [...args],
    "无法确认仓库 Git 操作状态。",
  )
  await assertGitWorktreeMutationAllowed({ localPath: input.gitRootPath, run: runStateProbe })

  const indexResult = await runRepositoryGitCommand(
    input.gitRootPath,
    ["rev-parse", "--git-path", "index"],
    "无法准备安全提交事务。",
  )
  const indexPath = path.isAbsolute(indexResult.stdout.trim())
    ? indexResult.stdout.trim()
    : path.resolve(input.gitRootPath, indexResult.stdout.trim())
  const temporaryIndexDirectory = await mkdtemp(path.join(path.dirname(indexPath), "synapse-index-"))
  const temporaryIndexPath = path.join(temporaryIndexDirectory, "index")

  try {
    const head = await runRepositoryGitCommand(
      input.gitRootPath,
      ["rev-parse", "HEAD"],
      "无法读取当前提交。",
    )
    await runRepositoryGitCommand(
      input.gitRootPath,
      ["read-tree", head.stdout.trim()],
      "无法准备安全提交事务。",
      { gitIndexFile: temporaryIndexPath },
    )
    await runRepositoryGitCommand(
      input.gitRootPath,
      ["--literal-pathspecs", "add", "--all", "--", ...relativePaths],
      "暂存本地改动失败。",
      { gitIndexFile: temporaryIndexPath },
    )

    const identityArgs = await readCommitIdentityArgs(input.gitRootPath)
    await assertGitWorktreeMutationAllowed({ localPath: input.gitRootPath, run: runStateProbe })
    await runRepositoryGitCommand(
      input.gitRootPath,
      [
        ...identityArgs,
        "commit",
        "-m",
        input.message,
      ],
      input.fallbackMessage,
      { gitIndexFile: temporaryIndexPath },
    )

    const headCommit = await runRepositoryGitCommand(
      input.gitRootPath,
      ["rev-parse", "HEAD"],
      "读取最新提交失败。",
    )
    try {
      await runRepositoryGitCommand(
        input.gitRootPath,
        ["--literal-pathspecs", "reset", "--mixed", "HEAD", "--", ...relativePaths],
        "提交已创建，但无法校正内容文件的暂存状态，请在 Git 工具中检查暂存区。",
      )
    } catch (error) {
      throw new RepositoryCommitCreatedError(headCommit.stdout.trim(), { cause: error })
    }

    return headCommit.stdout.trim()
  } finally {
    await rm(temporaryIndexDirectory, { recursive: true, force: true }).catch((error) => {
      logger.warn("Failed to clean temporary Git index.", {
        error,
        gitRootPath: input.gitRootPath,
      })
    })
  }
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
  RepositoryCommitCreatedError,
  commitRepositoryPaths,
  pullRepositoryWithSafeRebase,
  readReadyRepositoryState,
  readUnpushedCommitCount,
  runRepositoryGitExclusive,
}
