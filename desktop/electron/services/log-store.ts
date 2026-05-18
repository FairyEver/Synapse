import { app } from "electron"
import { createWriteStream, type WriteStream } from "node:fs"
import {
  copyFile,
  mkdir,
  mkdtemp,
  readdir,
  readFile,
  rm,
  stat,
  unlink,
} from "node:fs/promises"
import os from "node:os"
import path from "node:path"
import { inspect } from "node:util"
import { createZipArchive } from "../runtime/archive"
import type {
  SynapseLogClearResult,
  SynapseLogEntry,
  SynapseLogExportResult,
  SynapseLogFileInfo,
  SynapseLogLevel,
  SynapseLogSource,
} from "../../src/types/log"
import type { LogSink, LogRecord, StructuredLogger } from "../runtime/logging"
import { createLogger } from "../runtime/logging"
import { createMacCompatibilitySnapshot } from "./mac-compatibility"
import { createWindowsCompatibilitySnapshot } from "./windows-compatibility"

const LOG_DIR_NAME = "logs"
const MAX_LOG_FILE_SIZE = 10 * 1024 * 1024 // 10MB
const MAX_LOG_FILES = 30

interface LogWriteInput {
  source: SynapseLogSource
  level: SynapseLogLevel
  category: string
  message: unknown
  details?: unknown
}

type LogFileDescriptor = {
  name: string
  path: string
  mtimeMs: number
}

function formatDetails(details: unknown): string | null {
  if (details === undefined || details === null) {
    return null
  }

  if (details instanceof Error) {
    return details.stack ?? details.message
  }

  if (typeof details === "string") {
    return details
  }

  return inspect(details, {
    breakLength: 120,
    depth: 5,
    maxArrayLength: 50,
    sorted: true,
  })
}

function normalizeLogInput(message: unknown, details: unknown): { message: string; details?: unknown } {
  if (typeof message === "string") {
    return {
      message: message.trim() || "(empty message)",
      details,
    }
  }

  if (message instanceof Error) {
    return {
      message: message.message.trim() || message.name || "(error)",
      details: details ?? message,
    }
  }

  if (message === undefined || message === null) {
    return {
      message: "(empty message)",
      details,
    }
  }

  if (typeof message === "number" || typeof message === "boolean" || typeof message === "bigint") {
    return {
      message: String(message),
      details,
    }
  }

  return {
    message:
      inspect(message, {
        breakLength: 120,
        depth: 1,
        maxArrayLength: 10,
        sorted: true,
      }).trim() || "(empty message)",
    details: details ?? message,
  }
}

function formatLogEntry(entry: SynapseLogEntry): string {
  const timestamp = new Date(entry.createdAt).toISOString()
  const level = entry.level.toUpperCase().padEnd(5, " ")
  const head = `[${timestamp}] [${level}] [${entry.source}:${entry.category}] ${entry.message}`

  if (!entry.details) {
    return head
  }

  return `${head}\n${entry.details}`
}

function createLogFileName(date: Date): string {
  const d = [
    date.getFullYear(),
    String(date.getMonth() + 1).padStart(2, "0"),
    String(date.getDate()).padStart(2, "0"),
  ].join("")
  const t = [
    String(date.getHours()).padStart(2, "0"),
    String(date.getMinutes()).padStart(2, "0"),
    String(date.getSeconds()).padStart(2, "0"),
    String(date.getMilliseconds()).padStart(3, "0"),
  ].join("")

  return `synapse-${d}-${t}.log`
}

function createExportFileName(date: Date): string {
  return `synapse-logs-${date.toISOString().replace(/[:.]/g, "-")}.zip`
}

function getByteLength(value: string): number {
  return Buffer.byteLength(value, "utf8")
}

function writeFallbackError(message: string, error: unknown): void {
  const formattedError = error instanceof Error
    ? error.stack ?? error.message
    : inspect(error, {
        breakLength: 120,
        depth: 3,
        sorted: true,
      })

  process.stderr.write(`[synapse-log] ${message}\n${formattedError}\n`)
}

/**
 * LogSink adapter that writes to LogService.
 * Bridges runtime/logging/LogSink to the existing LogService implementation.
 */
class LogServiceSink implements LogSink {
  constructor(private service: LogService) {}

  write(record: LogRecord): void {
    // Map LogRecord to SynapseLogEntry format
    const level = record.level === "trace" ? "debug" : record.level
    const synapseLevel = level as SynapseLogLevel

    this.service.write({
      source: "main",
      level: synapseLevel,
      category: record.module,
      message: record.message,
      details: record.context,
    })
  }

  flush(): Promise<void> {
    return this.service.flush()
  }

  close(): Promise<void> {
    return this.service.dispose()
  }
}

class LogService {
  private currentStream: WriteStream | null = null
  private currentFilePath: string | null = null
  private currentFileSize = 0
  private nextId = 1
  private readonly logDirPath: string
  private buffer: string[] = []
  private bufferedBytes = 0
  private flushTimer: NodeJS.Timeout | null = null
  private readonly readyPromise: Promise<void>
  private operationChain: Promise<void> = Promise.resolve()
  private flushRequested = false
  private isDisposed = false
  private readonly bufferFlushInterval = 1000
  private readonly maxBufferSize = 100

  constructor() {
    this.logDirPath = path.join(app?.getPath?.("userData") ?? os.tmpdir(), LOG_DIR_NAME)
    this.readyPromise = this.initializeLogDirectory()
    this.startFlushTimer()
  }

  private async initializeLogDirectory(): Promise<void> {
    try {
      await mkdir(this.logDirPath, { recursive: true })
      await this.rotateToNewFile()
      await this.cleanOldLogFiles()
      this.writeWindowsCompatibilitySnapshot()
      this.writeMacCompatibilitySnapshot()
    } catch (error) {
      writeFallbackError("Failed to initialize log directory.", error)
    }
  }

  private writeWindowsCompatibilitySnapshot(): void {
    this.write({
      source: "main",
      level: "info",
      category: "windows.compatibility",
      message: "Windows compatibility snapshot captured.",
      details: createWindowsCompatibilitySnapshot({
        paths: {
          appPath: safeGetAppPath(),
          cwd: process.cwd(),
          userDataPath: safeGetAppNamedPath("userData"),
          tempPath: safeGetAppNamedPath("temp"),
          downloadsPath: safeGetAppNamedPath("downloads"),
          logPath: this.logDirPath,
        },
      }),
    })
  }

  private writeMacCompatibilitySnapshot(): void {
    this.write({
      source: "main",
      level: "info",
      category: "mac.compatibility",
      message: "macOS compatibility snapshot captured.",
      details: createMacCompatibilitySnapshot({
        paths: {
          appPath: safeGetAppPath(),
          cwd: process.cwd(),
          userDataPath: safeGetAppNamedPath("userData"),
          tempPath: safeGetAppNamedPath("temp"),
          downloadsPath: safeGetAppNamedPath("downloads"),
          logPath: this.logDirPath,
        },
      }),
    })
  }

  private startFlushTimer(): void {
    this.flushTimer = setInterval(() => {
      this.requestFlush()
    }, this.bufferFlushInterval)
    this.flushTimer.unref?.()
  }

  private enqueue<T>(task: () => Promise<T>): Promise<T> {
    const nextTask = this.operationChain.then(task, task)
    this.operationChain = nextTask.then(() => undefined, () => undefined)

    return nextTask
  }

  private async ensureReady(): Promise<void> {
    await this.readyPromise
  }

  private async closeCurrentStream(): Promise<void> {
    if (!this.currentStream) {
      return
    }

    const stream = this.currentStream
    this.currentStream = null

    await new Promise<void>((resolve) => {
      stream.end(() => resolve())
    })
  }

  private async rotateToNewFile(): Promise<void> {
    await this.closeCurrentStream()

    const fileName = createLogFileName(new Date())
    this.currentFilePath = path.join(this.logDirPath, fileName)
    this.currentFileSize = 0
    this.currentStream = createWriteStream(this.currentFilePath, { flags: "a" })
    this.currentStream.on("error", (error) => {
      writeFallbackError("Log stream error.", error)
    })
  }

  private async cleanOldLogFiles(): Promise<void> {
    try {
      const logFiles = await this.readLogFiles({ newestFirst: true })

      for (const file of logFiles.slice(MAX_LOG_FILES)) {
        try {
          await unlink(file.path)
        } catch {
          writeFallbackError("Failed to clean old log file.", file.path)
        }
      }
    } catch (error) {
      writeFallbackError("Failed to clean old log files.", error)
    }
  }

  private async flushBuffer(): Promise<void> {
    await this.ensureReady()

    if (this.buffer.length === 0) {
      return
    }

    if (!this.currentStream) {
      await this.rotateToNewFile()
    }

    if (!this.currentStream) {
      return
    }

    const linesToWrite = this.buffer.join("\n") + "\n"
    this.buffer = []
    this.bufferedBytes = 0

    await new Promise<void>((resolve, reject) => {
      this.currentStream?.write(linesToWrite, (error) => {
        if (error) {
          reject(error)
          return
        }

        this.currentFileSize += getByteLength(linesToWrite)
        resolve()
      })
    })
  }

  private async rotateIfNeeded(): Promise<void> {
    if (this.currentFileSize < MAX_LOG_FILE_SIZE) {
      return
    }

    await this.rotateToNewFile()
    await this.cleanOldLogFiles()
  }

  private requestFlush(): void {
    if (this.flushRequested || this.isDisposed) {
      return
    }

    this.flushRequested = true

    void this.enqueue(async () => {
      try {
        await this.flushBuffer()
        await this.rotateIfNeeded()
      } catch (error) {
        writeFallbackError("Failed to flush log buffer.", error)
      } finally {
        this.flushRequested = false
      }
    })
  }

  private async listLogFiles(options?: { newestFirst?: boolean }): Promise<LogFileDescriptor[]> {
    await this.ensureReady()

    return this.readLogFiles(options)
  }

  private async readLogFiles(options?: { newestFirst?: boolean }): Promise<LogFileDescriptor[]> {
    const files = await readdir(this.logDirPath)

    const logFiles: LogFileDescriptor[] = []

    for (const file of files) {
      if (!file.endsWith(".log")) {
        continue
      }

      const filePath = path.join(this.logDirPath, file)
      const fileStats = await stat(filePath).catch(() => null)

      if (!fileStats?.isFile()) {
        continue
      }

      logFiles.push({
        name: file,
        path: filePath,
        mtimeMs: fileStats.mtimeMs,
      })
    }

    logFiles.sort((a, b) => {
      if (options?.newestFirst) {
        return b.mtimeMs - a.mtimeMs
      }

      return a.mtimeMs - b.mtimeMs
    })

    return logFiles
  }

  write(input: LogWriteInput): SynapseLogEntry {
    const normalizedInput = normalizeLogInput(input.message, input.details)

    const entry: SynapseLogEntry = {
      id: this.nextId,
      createdAt: new Date().toISOString(),
      level: input.level,
      source: input.source,
      category: input.category.trim() || "app",
      message: normalizedInput.message,
      details: formatDetails(normalizedInput.details),
    }

    this.nextId += 1

    const formattedLine = formatLogEntry(entry)
    this.buffer.push(formattedLine)
    this.bufferedBytes += getByteLength(`${formattedLine}\n`)

    if (
      this.buffer.length >= this.maxBufferSize
      || this.currentFileSize + this.bufferedBytes >= MAX_LOG_FILE_SIZE
    ) {
      this.requestFlush()
    }

    return entry
  }

  createSink(): LogSink {
    return new LogServiceSink(this)
  }

  async flush(): Promise<void> {
    await this.enqueue(async () => {
      await this.flushBuffer()
      await this.rotateIfNeeded()
    })
  }

  async exportAllLogs(exportFilePath: string): Promise<SynapseLogExportResult> {
    return this.enqueue(async () => {
      await this.flushBuffer()
      await this.rotateIfNeeded()

      const logFiles = await this.listLogFiles()
      const stagingRootPath = await mkdtemp(path.join(os.tmpdir(), "synapse-log-export-"))
      const stagingDirectoryPath = path.join(stagingRootPath, "synapse-logs")

      try {
        await mkdir(stagingDirectoryPath, { recursive: true })

        for (const logFile of logFiles) {
          await copyFile(logFile.path, path.join(stagingDirectoryPath, logFile.name))
        }

        await createZipArchive(stagingDirectoryPath, exportFilePath, {
          messages: {
            missingTool: "当前系统缺少导出日志压缩包所需的工具。",
            startFailed: "启动日志导出命令失败。",
            failed: "导出日志压缩包失败，请稍后重试。",
          },
        })
      } finally {
        await rm(stagingRootPath, { recursive: true, force: true }).catch(() => undefined)
      }

      return {
        fileCount: logFiles.length,
        filePath: exportFilePath,
      }
    })
  }

  async readAllLogs(): Promise<string> {
    return this.enqueue(async () => {
      await this.flushBuffer()

      const logFiles = await this.listLogFiles()
      const parts: string[] = []

      for (const logFile of logFiles) {
        const content = await readFile(logFile.path, "utf-8")
        parts.push(content)
      }

      return parts.join("\n")
    })
  }

  async listLogFilesInfo(): Promise<SynapseLogFileInfo[]> {
    return this.enqueue(async () => {
      await this.flushBuffer()

      const logFiles = await this.listLogFiles({ newestFirst: true })
      const result: SynapseLogFileInfo[] = []

      for (const logFile of logFiles) {
        const fileStats = await stat(logFile.path).catch(() => null)
        result.push({
          name: logFile.name,
          sizeBytes: fileStats?.size ?? 0,
        })
      }

      return result
    })
  }

  async readLogsByNames(fileNames: string[]): Promise<string> {
    return this.enqueue(async () => {
      await this.flushBuffer()

      const allowedNames = new Set(fileNames)
      const logFiles = await this.listLogFiles()
      const parts: string[] = []

      for (const logFile of logFiles) {
        if (!allowedNames.has(logFile.name)) {
          continue
        }
        const content = await readFile(logFile.path, "utf-8")
        parts.push(content)
      }

      return parts.join("\n")
    })
  }

  async clearAllLogs(): Promise<SynapseLogClearResult> {
    return this.enqueue(async () => {
      await this.flushBuffer()

      const logFiles = await this.listLogFiles()
      await this.closeCurrentStream()

      let fileCount = 0

      for (const logFile of logFiles) {
        await unlink(logFile.path)
        fileCount += 1
      }

      this.currentFilePath = null
      this.currentFileSize = 0
      this.buffer = []
      this.bufferedBytes = 0

      await this.rotateToNewFile()

      return {
        fileCount,
      }
    })
  }

  getLogDirectory(): string {
    return this.logDirPath
  }

  async dispose(): Promise<void> {
    this.isDisposed = true

    if (this.flushTimer) {
      clearInterval(this.flushTimer)
      this.flushTimer = null
    }

    await this.enqueue(async () => {
      await this.flushBuffer()
      await this.closeCurrentStream()
    })
  }
}

export const logStore = new LogService()

/**
 * Creates a StructuredLogger for the given module category.
 * Phase 0.6 — now returns runtime/logging/StructuredLogger interface.
 */
export function createMainLogger(category: string): StructuredLogger {
  return createLogger({
    module: category,
    sink: logStore.createSink(),
    minLevel: "info",
  })
}

function safeGetAppPath(): string | undefined {
  try {
    return app.getAppPath()
  } catch (error) {
    writeFallbackError("Failed to read app path for compatibility log.", error)
    return undefined
  }
}

function safeGetAppNamedPath(name: Parameters<typeof app.getPath>[0]): string | undefined {
  try {
    return app.getPath(name)
  } catch (error) {
    writeFallbackError(`Failed to read app ${name} path for compatibility log.`, error)
    return undefined
  }
}
