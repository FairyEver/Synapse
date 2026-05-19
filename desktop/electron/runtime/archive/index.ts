import { spawn } from "node:child_process"
import path from "node:path"

type ZipArchiveMessages = {
  missingTool?: string
  startFailed?: string
  failed?: string
}

type ZipArchiveOptions = {
  messages?: ZipArchiveMessages
  timeoutMs?: number
}

const DEFAULT_MESSAGES: Required<ZipArchiveMessages> = {
  missingTool: "当前系统缺少创建压缩包所需的工具。",
  startFailed: "启动压缩命令失败。",
  failed: "创建压缩包失败，请稍后重试。",
}

function escapePowerShellSingleQuotedString(value: string): string {
  return `'${value.replace(/'/g, "''")}'`
}

function resolveMessages(messages?: ZipArchiveMessages): Required<ZipArchiveMessages> {
  return {
    ...DEFAULT_MESSAGES,
    ...messages,
  }
}

function formatArchiveSpawnError(error: unknown, messages: Required<ZipArchiveMessages>): string {
  if (error instanceof Error && "code" in error && error.code === "ENOENT") {
    return messages.missingTool
  }

  return error instanceof Error ? error.message : messages.startFailed
}

function formatArchiveFailureMessage(output: string, messages: Required<ZipArchiveMessages>): string {
  const firstLine = output
    .trim()
    .split(/\r?\n/)
    .map((line) => line.trim())
    .find((line) => line.length > 0)

  return firstLine ? `${messages.failed}\n${firstLine}` : messages.failed
}

const ARCHIVE_DEFAULT_TIMEOUT_MS = 5 * 60 * 1000

function runArchiveCommand(
  command: string,
  args: string[],
  messages: Required<ZipArchiveMessages>,
  options?: {
    cwd?: string
    timeoutMs?: number
  },
): Promise<void> {
  return new Promise((resolve, reject) => {
    const childProcess = spawn(command, args, {
      cwd: options?.cwd,
      env: {
        ...process.env,
      },
    })

    const timeoutMs = options?.timeoutMs ?? ARCHIVE_DEFAULT_TIMEOUT_MS
    const timer = setTimeout(() => {
      childProcess.kill("SIGTERM")
      reject(new Error("压缩操作超时，请稍后重试。"))
    }, timeoutMs)

    let stdout = ""
    let stderr = ""

    childProcess.stdout.on("data", (chunk: Buffer) => {
      stdout += chunk.toString("utf8")
    })

    childProcess.stderr.on("data", (chunk: Buffer) => {
      stderr += chunk.toString("utf8")
    })

    childProcess.on("error", (error) => {
      clearTimeout(timer)
      reject(new Error(formatArchiveSpawnError(error, messages)))
    })

    childProcess.on("close", (code) => {
      clearTimeout(timer)
      if (code === 0) {
        resolve()
        return
      }

      reject(new Error(formatArchiveFailureMessage(`${stdout}\n${stderr}`, messages)))
    })
  })
}

async function createZipArchive(
  sourceDirectoryPath: string,
  outputFilePath: string,
  options?: ZipArchiveOptions,
): Promise<void> {
  const messages = resolveMessages(options?.messages)
  const timeoutMs = options?.timeoutMs

  if (process.platform === "win32") {
    const script = [
      "Compress-Archive",
      "-LiteralPath",
      escapePowerShellSingleQuotedString(sourceDirectoryPath),
      "-DestinationPath",
      escapePowerShellSingleQuotedString(outputFilePath),
      "-CompressionLevel",
      "Optimal",
      "-Force",
    ].join(" ")

    await runArchiveCommand("powershell.exe", [
      "-NoLogo",
      "-NoProfile",
      "-NonInteractive",
      "-Command",
      script,
    ], messages, { timeoutMs })
    return
  }

  if (process.platform === "darwin") {
    await runArchiveCommand("ditto", [
      "-c",
      "-k",
      "--keepParent",
      sourceDirectoryPath,
      outputFilePath,
    ], messages, { timeoutMs })
    return
  }

  await runArchiveCommand(
    "zip",
    ["-r", "-q", outputFilePath, path.basename(sourceDirectoryPath)],
    messages,
    { cwd: path.dirname(sourceDirectoryPath), timeoutMs },
  )
}

export { createZipArchive }
export type { ZipArchiveMessages, ZipArchiveOptions }
