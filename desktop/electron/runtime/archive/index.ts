import path from "node:path"
import { sanitizeError } from "../../../src/lib/error-sanitize"
import { sanitizeUrl } from "../../../src/lib/url-sanitize"
import {
  ControlledProcessPermissionError,
  type ControlledProcessResult,
  type ControlledProcessRunner,
} from "../process"
import type { ActorIdentity } from "../security"

type ZipArchiveMessages = {
  missingTool?: string
  startFailed?: string
  failed?: string
}

type ZipArchiveOptions = {
  actor?: ActorIdentity
  messages?: ZipArchiveMessages
  platform?: NodeJS.Platform
  processRunner?: Pick<ControlledProcessRunner, "run">
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

  return error instanceof Error ? sanitizeArchiveFailureDetail(error.message) || messages.startFailed : messages.startFailed
}

function formatArchiveProcessError(result: ControlledProcessResult, messages: Required<ZipArchiveMessages>): string {
  if (result.timedOut) {
    return "压缩操作超时，请稍后重试。"
  }

  if (result.error?.includes("ENOENT")) {
    return messages.missingTool
  }

  return formatArchiveFailureMessage(
    `${result.stdout ?? ""}\n${result.stderr ?? ""}\n${result.error ?? ""}`,
    messages,
  )
}

function formatArchiveFailureMessage(output: string, messages: Required<ZipArchiveMessages>): string {
  const firstLine = output
    .trim()
    .split(/\r?\n/)
    .map((line) => line.trim())
    .find((line) => line.length > 0)

  const detail = firstLine ? sanitizeArchiveFailureDetail(firstLine) : ""
  return detail ? `${messages.failed}\n${detail}` : messages.failed
}

function sanitizeArchiveFailureDetail(value: string): string {
  return sanitizeError(value.replace(/https?:\/\/[^\s"'<>]+/gi, (url) => sanitizeUrl(url)))
}

const ARCHIVE_DEFAULT_TIMEOUT_MS = 5 * 60 * 1000

async function runArchiveCommand(
  command: string,
  args: string[],
  messages: Required<ZipArchiveMessages>,
  options?: {
    actor?: ActorIdentity
    cwd?: string
    processRunner?: Pick<ControlledProcessRunner, "run">
    timeoutMs?: number
  },
): Promise<void> {
  if (!options?.processRunner || !options.actor) {
    throw new Error("压缩命令缺少安全执行上下文。")
  }

  try {
    const result = await options.processRunner.run({
      action: "shell.exec",
      actor: options.actor,
      args,
      command,
      cwd: options.cwd,
      metadata: {
        source: "archive.createZipArchive",
      },
      output: {
        stderr: "buffer",
        stdout: "buffer",
      },
      timeoutMs: options.timeoutMs ?? ARCHIVE_DEFAULT_TIMEOUT_MS,
    })

    if (result.exitCode === 0 && !result.timedOut && !result.error) {
      return
    }

    throw new Error(formatArchiveProcessError(result, messages))
  } catch (error) {
    if (error instanceof ControlledProcessPermissionError) {
      throw error
    }
    throw new Error(formatArchiveSpawnError(error, messages), { cause: error })
  }
}

async function createZipArchive(
  sourceDirectoryPath: string,
  outputFilePath: string,
  options?: ZipArchiveOptions,
): Promise<void> {
  const messages = resolveMessages(options?.messages)
  const platform = options?.platform ?? process.platform
  const timeoutMs = options?.timeoutMs

  if (platform === "win32") {
    const sourceDirectoryName = path.basename(sourceDirectoryPath)
    const script = [
      "Compress-Archive",
      "-LiteralPath",
      escapePowerShellSingleQuotedString(sourceDirectoryName),
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
    ], messages, {
      actor: options?.actor,
      cwd: path.dirname(sourceDirectoryPath),
      processRunner: options?.processRunner,
      timeoutMs,
    })
    return
  }

  if (platform === "darwin") {
    await runArchiveCommand("ditto", [
      "-c",
      "-k",
      "--norsrc",
      "--keepParent",
      sourceDirectoryPath,
      outputFilePath,
    ], messages, {
      actor: options?.actor,
      processRunner: options?.processRunner,
      timeoutMs,
    })
    return
  }

  await runArchiveCommand(
    "zip",
    ["-r", "-q", outputFilePath, path.basename(sourceDirectoryPath)],
    messages,
    {
      actor: options?.actor,
      cwd: path.dirname(sourceDirectoryPath),
      processRunner: options?.processRunner,
      timeoutMs,
    },
  )
}

export { createZipArchive }
export type { ZipArchiveMessages, ZipArchiveOptions }
