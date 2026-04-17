import { spawn } from "node:child_process"
import type { SynapseRepositoryConfig } from "../../src/types/config"
import type {
  SynapseRepositoryOperationKind,
  SynapseRepositoryOperationResult,
  SynapseRepositoryProgressEvent,
} from "../../src/types/repository"
import { repositoryStore } from "./repository-store"

type ProgressListener = (event: SynapseRepositoryProgressEvent) => void

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

function formatGitFailureMessage(output: string): string {
  const normalizedOutput = output.trim()
  const firstLine = normalizedOutput
    .split(/\r?\n/)
    .map((line) => line.trim())
    .find((line) => line.length > 0)
  const loweredOutput = normalizedOutput.toLowerCase()

  if (
    loweredOutput.includes("authentication failed")
    || loweredOutput.includes("could not read username")
    || loweredOutput.includes("permission denied (publickey)")
    || loweredOutput.includes("permission denied")
    || loweredOutput.includes("fatal: could not read from remote repository")
  ) {
    return "Git 认证失败。请检查系统凭证、SSH Key 或 credential.helper 配置。"
  }

  if (
    loweredOutput.includes("repository not found")
    || loweredOutput.includes("not found")
    || loweredOutput.includes("no such remote")
  ) {
    return "当前仓库没有可用的远程配置，或当前账号没有访问权限。"
  }

  if (
    loweredOutput.includes("there is no tracking information for the current branch")
    || loweredOutput.includes("no upstream configured for branch")
    || loweredOutput.includes("has no upstream branch")
  ) {
    return "当前分支还没有配置上游分支，暂时无法在 Synapse 中执行同步。"
  }

  if (
    loweredOutput.includes("could not resolve host")
    || loweredOutput.includes("failed to connect")
    || loweredOutput.includes("connection timed out")
    || loweredOutput.includes("network is unreachable")
    || loweredOutput.includes("connection reset")
  ) {
    return "无法连接到远程仓库。请检查网络连接、代理设置或仓库域名。"
  }

  if (loweredOutput.includes("not possible to fast-forward")) {
    return "当前仓库无法快进同步，请先在你常用的 Git 工具里处理分支分叉。"
  }

  if (loweredOutput.includes("not a git repository")) {
    return "当前目录不是 Git 仓库，无法执行同步。"
  }

  const fallbackMessage = "仓库同步失败。请检查网络、访问权限、远程配置或当前分支状态后重试。"

  return firstLine ? `${fallbackMessage}\n${firstLine}` : fallbackMessage
}

function formatGitSpawnError(error: unknown): string {
  if (error instanceof Error && "code" in error && error.code === "ENOENT") {
    return "当前系统没有可用的 git 命令，请先安装 Git 并确保命令行可访问。"
  }

  return error instanceof Error ? error.message : "启动 Git 命令失败。"
}

function createLineProcessor(onLine: (line: string) => void) {
  let buffer = ""

  return {
    push(chunk: string) {
      buffer += chunk.replace(/\r/g, "\n")
      const lines = buffer.split("\n")
      buffer = lines.pop() ?? ""

      for (const line of lines) {
        if (line.trim()) {
          onLine(line)
        }
      }
    },
    flush() {
      if (buffer.trim()) {
        onLine(buffer)
      }

      buffer = ""
    },
  }
}

async function runGitCommand(
  repositoryUuid: string,
  operation: SynapseRepositoryOperationKind,
  args: string[],
  options: {
    cwd: string
    onProgress: ProgressListener
  },
): Promise<void> {
  await new Promise<void>((resolve, reject) => {
    const childProcess = spawn("git", args, {
      cwd: options.cwd,
      env: {
        ...process.env,
        GIT_TERMINAL_PROMPT: "0",
        LANG: "C",
        LC_ALL: "C",
      },
    })

    let combinedOutput = ""
    const stdoutProcessor = createLineProcessor((line) => {
      combinedOutput += `${line}\n`
      const progressEvent = parseGitProgressLine(repositoryUuid, operation, line)

      if (progressEvent) {
        options.onProgress(progressEvent)
      }
    })
    const stderrProcessor = createLineProcessor((line) => {
      combinedOutput += `${line}\n`
      const progressEvent = parseGitProgressLine(repositoryUuid, operation, line)

      if (progressEvent) {
        options.onProgress(progressEvent)
      }
    })

    childProcess.stdout.on("data", (chunk: Buffer) => {
      stdoutProcessor.push(chunk.toString("utf8"))
    })

    childProcess.stderr.on("data", (chunk: Buffer) => {
      stderrProcessor.push(chunk.toString("utf8"))
    })

    childProcess.on("error", (error) => {
      reject(new Error(formatGitSpawnError(error)))
    })

    childProcess.on("close", (code) => {
      stdoutProcessor.flush()
      stderrProcessor.flush()

      if (code === 0) {
        resolve()
        return
      }

      reject(new Error(formatGitFailureMessage(combinedOutput)))
    })
  })
}

class RepositoryGitService {
  private activeOperations = new Map<string, SynapseRepositoryOperationKind>()

  async syncRepository(
    repository: SynapseRepositoryConfig,
    onProgress: ProgressListener,
  ): Promise<SynapseRepositoryOperationResult> {
    const currentState = await repositoryStore.getRepositoryState(repository)

    if (currentState.status !== "ready") {
      throw new Error("当前目录不存在，请先在 Settings 里重新选择本地目录。")
    }

    if (!currentState.isGitRepository) {
      throw new Error("当前目录不是 Git 仓库，无法执行同步。")
    }

    return this.runExclusive(repository.uuid, "sync", async () => {
      onProgress({
        repositoryUuid: repository.uuid,
        operation: "sync",
        statusText: "正在检查远程更新...",
        percent: 0,
      })

      await runGitCommand(repository.uuid, "sync", [
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
        operation: "sync",
        repository: nextState,
        completedAt,
      }
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
