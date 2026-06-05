import type { SynapseRepositoryConfig } from "../../src/types/config"
import type {
  SynapseRepositoryOperationKind,
  SynapseRepositoryOperationResult,
  SynapseRepositoryProgressEvent,
} from "../../src/types/repository"
import { isGitRebaseInProgress, runGitCommand } from "./git-command"
import { createMainLogger } from "./log-store"
import { formatGitFailureMessage } from "./git-error-utils"
import { repositoryLockManager } from "./repository-lock-manager"
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


async function runRepositoryGitCommand(
  repositoryUuid: string,
  operation: SynapseRepositoryOperationKind,
  args: string[],
  options: {
    cwd: string
    onProgress: ProgressListener
  },
): Promise<void> {
  await runGitCommand({
    args,
    cwd: options.cwd,
    fallbackMessage: "仓库同步失败。请检查网络、访问权限、远程配置或当前分支状态后重试。",
    formatFailureMessage: formatGitFailureMessage,
    onLine: (line) => {
      const progressEvent = parseGitProgressLine(repositoryUuid, operation, line)

      if (progressEvent) {
        options.onProgress(progressEvent)
      }
    },
    timeoutMessage: "仓库同步超时，请检查网络后重试。",
    timeoutMs: GIT_REMOTE_OPERATION_TIMEOUT_MS,
  })
}

function isNonFastForwardError(message: string): boolean {
  const lowered = message.toLowerCase()

  return (
    lowered.includes("not possible to fast-forward")
    || lowered.includes("non-fast-forward")
    || lowered.includes("[rejected]")
    || lowered.includes("fetch first")
  )
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

async function abortRebaseIfNeeded(localPath: string): Promise<void> {
  if (!(await isGitRebaseInProgress(localPath))) {
    return
  }

  logger.warn("Rebase in progress detected during sync. Aborting rebase.", { localPath })
  await runGitCommand({
    args: ["rebase", "--abort"],
    cwd: localPath,
    fallbackMessage: "无法中止 rebase。",
    formatFailureMessage: formatGitFailureMessage,
  })
}

class RepositoryGitService {
  async syncRepository(
    repository: SynapseRepositoryConfig,
    onProgress: ProgressListener,
    options?: { skipLock?: boolean },
  ): Promise<SynapseRepositoryOperationResult> {
    logger.info("Starting repository sync.", {
      repositoryUuid: repository.uuid,
      localPath: repository.localPath,
    })
    const currentState = await repositoryStore.getRepositoryState(repository)

    if (currentState.status !== "ready") {
      logger.warn("Repository sync aborted because local path is missing.", {
        repositoryUuid: repository.uuid,
        localPath: repository.localPath,
      })
      throw new Error("当前目录不存在，请先在 Settings 里重新选择本地目录。")
    }

    if (!currentState.isGitRepository) {
      logger.info("Repository sync resolved as a local-only refresh.", {
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

    const release = options?.skipLock
      ? () => {}
      : await repositoryLockManager.acquire(repository.uuid, "sync")
    try {
      onProgress({
        repositoryUuid: repository.uuid,
        operation: "sync",
        statusText: "正在检查远程更新...",
        percent: 0,
      })

      let pullSucceeded = false

      try {
        await runRepositoryGitCommand(repository.uuid, "sync", [
          "pull",
          "--ff-only",
          "--progress",
        ], {
          cwd: repository.localPath,
          onProgress,
        })
        pullSucceeded = true
      } catch (pullError) {
        const message = pullError instanceof Error ? pullError.message : ""

        if (!isNonFastForwardError(message)) {
          throw pullError
        }

        logger.info("Pull --ff-only failed due to diverged state. Attempting pull --rebase.", {
          repositoryUuid: repository.uuid,
        })

        onProgress({
          repositoryUuid: repository.uuid,
          operation: "sync",
          statusText: "正在变基合并远程更新...",
          percent: null,
        })

        try {
          await runRepositoryGitCommand(repository.uuid, "sync", [
            "pull",
            "--rebase",
            "-X", "theirs",
            "--progress",
          ], {
            cwd: repository.localPath,
            onProgress,
          })
        } catch (rebaseError) {
          await abortRebaseIfNeeded(repository.localPath)
          throw rebaseError
        }

        onProgress({
          repositoryUuid: repository.uuid,
          operation: "sync",
          statusText: "正在推送本地提交...",
          percent: null,
        })

        await runRepositoryGitCommand(repository.uuid, "sync", [
          "push",
          "--progress",
        ], {
          cwd: repository.localPath,
          onProgress,
        })
      }

      if (pullSucceeded) {
        let aheadCount = 0

        try {
          aheadCount = await getAheadCount(repository.localPath)
        } catch (error) {
          logger.warn("Failed to determine ahead count after pull.", {
            repositoryUuid: repository.uuid,
            error,
          })
        }

        if (aheadCount > 0) {
          logger.info("Local branch is ahead after pull. Pushing automatically.", {
            repositoryUuid: repository.uuid,
            aheadCount,
          })

          onProgress({
            repositoryUuid: repository.uuid,
            operation: "sync",
            statusText: "正在推送本地提交...",
            percent: null,
          })

          await runRepositoryGitCommand(repository.uuid, "sync", [
            "push",
            "--progress",
          ], {
            cwd: repository.localPath,
            onProgress,
          })
        }
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
        repositoryUuid: repository.uuid,
        completedAt,
      })

      return {
        operation: "sync" as const,
        repository: nextState,
        completedAt,
      }
    } catch (error) {
      logger.error("Repository sync failed.", {
        repositoryUuid: repository.uuid,
        error,
      })
      throw error
    } finally {
      release()
    }
  }
}

export const repositoryGitService = new RepositoryGitService()
