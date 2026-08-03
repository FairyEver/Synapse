import type { SynapseRepositoryConfig } from "../../src/types/config"
import type {
  SynapseRepositoryLocalState,
  SynapseRepositoryOperationKind,
  SynapseRepositoryOperationResult,
  SynapseRepositoryProgressEvent,
} from "../../src/types/repository"
import { runGitCommand } from "./git-command"
import { assertNoPreexistingGitRebase, recoverOwnedRebase } from "./git-rebase-guard"
import { assertGitWorktreeMutationAllowed } from "./git-operation-state"
import { assertNoIgnoredPathCollisions } from "./git-working-tree-safety"
import { createGitOperationId, gitErrorMeta, summarizeGitArgs } from "./git-client/git-logging"
import { createMainLogger } from "./log-store"
import { formatGitFailureMessage, isNonFastForwardError } from "./git-error-utils"
import { runRepositoryGitExclusive } from "./repository-git-mutation-service"
import { repositoryStore } from "./repository-store"

type ProgressListener = (event: SynapseRepositoryProgressEvent) => void
const logger = createMainLogger("service.repository-git")
const GIT_REMOTE_OPERATION_TIMEOUT_MS = 60_000

function extractPercent(line: string): number | null {
  const match = line.match(/(\d+)%/)

  if (!match) {
    return null
  }

  const percent = Number(match[1])

  return Number.isFinite(percent) ? percent : null
}

function parseGitProgressLine(
  repositoryUuid: string,
  operation: SynapseRepositoryOperationKind,
  line: string,
): SynapseRepositoryProgressEvent | null {
  const trimmedLine = line.trim()

  if (!trimmedLine) {
    return null
  }

  const percent = extractPercent(trimmedLine)

  if (trimmedLine.startsWith("From ")) {
    return {
      repositoryUuid,
      operation,
      statusText: "正在获取远程更新...",
      percent,
    }
  }

  if (trimmedLine === "Already up to date.") {
    return {
      repositoryUuid,
      operation,
      statusText: "仓库已经是最新状态。",
      percent: 100,
    }
  }

  if (trimmedLine.startsWith("remote: Enumerating objects")) {
    return {
      repositoryUuid,
      operation,
      statusText: "远程正在枚举对象...",
      percent,
    }
  }

  if (trimmedLine.startsWith("remote: Counting objects") || trimmedLine.startsWith("Counting objects")) {
    return {
      repositoryUuid,
      operation,
      statusText: "正在统计对象...",
      percent,
    }
  }

  if (
    trimmedLine.startsWith("remote: Compressing objects")
    || trimmedLine.startsWith("Compressing objects")
  ) {
    return {
      repositoryUuid,
      operation,
      statusText: "正在压缩对象...",
      percent,
    }
  }

  if (trimmedLine.startsWith("Receiving objects")) {
    return {
      repositoryUuid,
      operation,
      statusText: "正在接收对象...",
      percent,
    }
  }

  if (trimmedLine.startsWith("Resolving deltas")) {
    return {
      repositoryUuid,
      operation,
      statusText: "正在解析差异...",
      percent,
    }
  }

  if (trimmedLine.startsWith("Updating ")) {
    return {
      repositoryUuid,
      operation,
      statusText: "正在更新本地工作区...",
      percent,
    }
  }

  if (trimmedLine.startsWith("Fast-forward")) {
    return {
      repositoryUuid,
      operation,
      statusText: "正在快进到最新提交...",
      percent,
    }
  }

  return {
    repositoryUuid,
    operation,
    statusText: trimmedLine,
    percent,
  }
}

function gitFailureOutput(error: unknown): string {
  if (error && typeof error === "object" && "output" in error) {
    const output = (error as { readonly output?: unknown }).output
    if (typeof output === "string" && output.trim()) return output
  }

  return error instanceof Error ? error.message : ""
}

async function runRepositoryGitCommand(
  repositoryUuid: string,
  operation: SynapseRepositoryOperationKind,
  args: string[],
  options: {
    captureStdout?: false
    cwd: string
    onStdoutChunk?: (chunk: Uint8Array) => void
    onProgress: ProgressListener
    operationId: string
  },
): ReturnType<typeof runGitCommand> {
  const startedAt = performance.now()
  try {
    return await runGitCommand({
      args,
      captureStdout: options.captureStdout,
      cwd: options.cwd,
      fallbackMessage: "仓库同步失败。请检查网络、访问权限、远程配置或当前分支状态后重试。",
      formatFailureMessage: formatGitFailureMessage,
      onLine: (line) => {
        const progressEvent = parseGitProgressLine(repositoryUuid, operation, line)

        if (progressEvent) {
          options.onProgress(progressEvent)
        }
      },
      onStdoutChunk: options.onStdoutChunk,
      timeoutMessage: "仓库同步超时，请检查网络后重试。",
      timeoutMs: GIT_REMOTE_OPERATION_TIMEOUT_MS,
    })
  } catch (error) {
    logger.error("Repository Git command failed.", {
      operation: `repository.${operation}`,
      operationId: options.operationId,
      repositoryUuid,
      localPath: options.cwd,
      gitArgs: summarizeGitArgs(args),
      durationMs: Math.max(0, Math.round(performance.now() - startedAt)),
      ...gitErrorMeta(error),
    })
    throw error
  }
}

async function getAheadCount(cwd: string): Promise<number> {
  const result = await runGitCommand({
    args: ["rev-list", "@{u}..HEAD", "--count"],
    cwd,
    fallbackMessage: "",
    formatFailureMessage: () => "",
  })
  return parseInt(result.stdout.trim(), 10) || 0
}

class RepositoryGitService {
  async syncRepository(
    repository: SynapseRepositoryConfig,
    onProgress: ProgressListener,
  ): Promise<SynapseRepositoryOperationResult> {
    return runRepositoryGitExclusive(repository, "sync", (repositoryState) => (
      this.syncRepositoryInExclusive(repository, repositoryState, onProgress)
    ))
  }

  async syncRepositoryInExclusive(
    repository: SynapseRepositoryConfig,
    currentState: SynapseRepositoryLocalState,
    onProgress: ProgressListener,
  ): Promise<SynapseRepositoryOperationResult> {
    const operationId = createGitOperationId()
    const startedAt = performance.now()
    logger.info("Starting repository sync.", {
      operation: "repository.sync",
      operationId,
      repositoryUuid: repository.uuid,
      localPath: repository.localPath,
    })
    if (!currentState.isGitRepository) {
      logger.info("Repository sync resolved as a local-only refresh.", {
        operation: "repository.sync",
        operationId,
        repositoryUuid: repository.uuid,
        localPath: repository.localPath,
      })
      return {
        operation: "sync" as const,
        repository: currentState,
        completedAt: new Date().toISOString(),
        message: "本地目录已刷新。",
      }
    }

    try {
      onProgress({
        repositoryUuid: repository.uuid,
        operation: "sync",
        statusText: "正在检查远程更新...",
        percent: 0,
      })

      const run = (args: readonly string[], streamOptions?: { readonly captureStdout: false; readonly onStdoutChunk: (chunk: Uint8Array) => void }) => runRepositoryGitCommand(repository.uuid, "sync", [...args], {
        cwd: repository.localPath,
        onProgress,
        operationId,
        ...streamOptions,
      })
      await assertGitWorktreeMutationAllowed({ localPath: repository.localPath, run })
      await run(["fetch", "--prune", "--progress"])
      const [origHeadResult, ontoResult] = await Promise.all([
        run(["rev-parse", "HEAD"]),
        run(["rev-parse", "@{u}"]),
      ])
      const expectedOrigHead = origHeadResult.stdout.trim()
      const expectedOnto = ontoResult.stdout.trim()
      await assertNoIgnoredPathCollisions({ run, target: expectedOnto })
      try {
        await run([
          "merge",
          "--ff-only",
          "--no-overwrite-ignore",
          expectedOnto,
        ])
      } catch (pullError) {
        const message = gitFailureOutput(pullError)

        if (!isNonFastForwardError(message)) {
          throw pullError
        }

        logger.info("Fast-forward merge failed due to diverged state. Attempting rebase.", {
          operation: "repository.sync",
          operationId,
          repositoryUuid: repository.uuid,
        })

        onProgress({
          repositoryUuid: repository.uuid,
          operation: "sync",
          statusText: "正在变基合并远程更新...",
          percent: null,
        })
        await assertNoPreexistingGitRebase(repository.localPath, (localPath) => {
          logger.warn("Repository sync rebase skipped because repository already has a rebase in progress.", { localPath })
        })

        try {
          await run(["rebase", expectedOnto])
        } catch (rebaseError) {
          const recovery = await recoverOwnedRebase({
            error: rebaseError,
            expectedOnto,
            expectedOrigHead,
            localPath: repository.localPath,
            run,
          })
          if (recovery === "not-owned" || recovery === "not-recoverable") {
            throw new Error("同步失败，检测到无法确认归属的 rebase 状态；Synapse 未执行中止，请在 Git 工具中检查。", { cause: rebaseError })
          }
          throw rebaseError
        }
      }

      let aheadCount = 0

      try {
        aheadCount = await getAheadCount(repository.localPath)
      } catch (error) {
        logger.warn("Failed to determine ahead count after pull.", {
          operation: "repository.sync",
          operationId,
          repositoryUuid: repository.uuid,
          error,
        })
      }

      if (aheadCount > 0) {
        logger.info("Local branch is ahead after pull. Pushing automatically.", {
          operation: "repository.sync",
          operationId,
          repositoryUuid: repository.uuid,
          aheadCount,
        })

        onProgress({
          repositoryUuid: repository.uuid,
          operation: "sync",
          statusText: "正在推送本地提交...",
          percent: null,
        })

        await run(["push", "--progress"])
      }

      const nextState = await repositoryStore.getRepositoryState(repository)
      const completedAt = new Date().toISOString()

      onProgress({
        repositoryUuid: repository.uuid,
        operation: "sync",
        statusText: "仓库同步完成。",
        percent: 100,
      })

      logger.info("Repository sync completed.", {
        operation: "repository.sync",
        operationId,
        repositoryUuid: repository.uuid,
        completedAt,
        durationMs: Math.max(0, Math.round(performance.now() - startedAt)),
      })

      return {
        operation: "sync" as const,
        repository: nextState,
        completedAt,
      }
    } catch (error) {
      logger.error("Repository sync failed.", {
        operation: "repository.sync",
        operationId,
        repositoryUuid: repository.uuid,
        durationMs: Math.max(0, Math.round(performance.now() - startedAt)),
        ...gitErrorMeta(error),
      })
      throw error
    }
  }
}

export const repositoryGitService = new RepositoryGitService()
