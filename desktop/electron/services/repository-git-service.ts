import type { SynapseRepositoryConfig } from "../../src/types/config"
import type {
  SynapseRepositoryOperationKind,
  SynapseRepositoryOperationResult,
  SynapseRepositoryProgressEvent,
} from "../../src/types/repository"
import { runGitCommand } from "./git-command"
import { createMainLogger } from "./log-store"
import { formatGitFailureMessage } from "./git-error-utils"
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

class RepositoryGitService {
  private activeOperations = new Map<string, SynapseRepositoryOperationKind>()

  async syncRepository(
    repository: SynapseRepositoryConfig,
    onProgress: ProgressListener,
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

    return this.runExclusive(repository.uuid, "sync", async () => {
      onProgress({
        repositoryUuid: repository.uuid,
        operation: "sync",
        statusText: "正在检查远程更新...",
        percent: 0,
      })

      await runRepositoryGitCommand(repository.uuid, "sync", [
        "pull",
        "--ff-only",
        "--progress",
      ], {
        cwd: repository.localPath,
        onProgress,
      })

      const nextState = await repositoryStore.getRepositoryState(repository)
      const completedAt = new Date().toISOString()

      onProgress({
        repositoryUuid: repository.uuid,
        operation: "sync",
        statusText: "仓库同步完成。",
        percent: 100,
      })

      return {
        operation: "sync" as const,
        repository: nextState,
        completedAt,
      }
    }).then((result) => {
      logger.info("Repository sync completed.", {
        repositoryUuid: repository.uuid,
        completedAt: result.completedAt,
      })

      return result
    }).catch((error) => {
      logger.error("Repository sync failed.", {
        repositoryUuid: repository.uuid,
        error,
      })
      throw error
    })
  }

  private async runExclusive<T>(
    repositoryUuid: string,
    operation: SynapseRepositoryOperationKind,
    callback: () => Promise<T>,
  ): Promise<T> {
    if (this.activeOperations.has(repositoryUuid)) {
      throw new Error("这个仓库已经有一个 Git 操作在进行中，请稍候再试。")
    }

    this.activeOperations.set(repositoryUuid, operation)

    try {
      return await callback()
    } finally {
      this.activeOperations.delete(repositoryUuid)
    }
  }
}

export const repositoryGitService = new RepositoryGitService()
