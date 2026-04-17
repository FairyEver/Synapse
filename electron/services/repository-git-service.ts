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

  if (trimmedLine.startsWith("Cloning into ")) {
    return {
      repositoryUuid,
      operation,
      statusText: "正在连接远程仓库...",
      percent: 0,
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

  if (trimmedLine.startsWith("Updating files")) {
    return {
      repositoryUuid,
      operation,
      statusText: "正在更新文件...",
      percent,
    }
  }

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

function formatGitFailureMessage(
  operation: SynapseRepositoryOperationKind,
  output: string,
): string {
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
    || loweredOutput.includes("does not appear to be a git repository")
  ) {
    return "仓库地址不可用，或当前账号没有访问这个仓库的权限。"
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
    return "本地仓库无法快进同步，建议重新执行一次浅克隆。"
  }

  if (loweredOutput.includes("not a git repository")) {
    return "本地仓库目录不完整，建议重新执行一次浅克隆。"
  }

  const fallbackMessage =
    operation === "clone"
      ? "仓库克隆失败。请检查仓库地址、网络和访问权限后重试。"
      : "仓库同步失败。请检查网络、访问权限或本地缓存状态后重试。"

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
    cwd?: string
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

      reject(new Error(formatGitFailureMessage(operation, combinedOutput)))
    })
  })
}

class RepositoryGitService {
  private activeOperations = new Map<string, SynapseRepositoryOperationKind>()

  async cloneRepository(
    repository: SynapseRepositoryConfig,
    onProgress: ProgressListener,
  ): Promise<SynapseRepositoryOperationResult> {
    return this.runExclusive(repository.uuid, "clone", async () => {
      onProgress({
        repositoryUuid: repository.uuid,
        operation: "clone",
        statusText: "正在准备本地仓库目录...",
        percent: 0,
      })

      await repositoryStore.ensureRepositoriesRootPath()
      await repositoryStore.removeLocalRepository(repository.uuid)

      await runGitCommand(repository.uuid, "clone", [
        "clone",
        "--depth=1",
        "--progress",
        repository.url,
        repositoryStore.getRepositoryPath(repository.uuid),
      ], {
        onProgress,
      })

      const nextState = await repositoryStore.getRepositoryState(repository.uuid)
      const completedAt = new Date().toISOString()

      onProgress({
        repositoryUuid: repository.uuid,
        operation: "clone",
        statusText: "仓库克隆完成。",
        percent: 100,
      })

      return {
        operation: "clone",
        repository: nextState,
        completedAt,
      }
    })
  }

  async syncRepository(
    repository: SynapseRepositoryConfig,
    onProgress: ProgressListener,
  ): Promise<SynapseRepositoryOperationResult> {
    const currentState = await repositoryStore.getRepositoryState(repository.uuid)

    if (currentState.status !== "ready") {
      return this.cloneRepository(repository, onProgress)
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
        "--depth=1",
        "--progress",
      ], {
        cwd: repositoryStore.getRepositoryPath(repository.uuid),
        onProgress,
      })

      const nextState = await repositoryStore.getRepositoryState(repository.uuid)
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
