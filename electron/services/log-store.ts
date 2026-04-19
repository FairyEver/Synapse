import { app } from "electron"
import { createWriteStream, mkdir, readdir, stat, unlink, WriteStream } from "node:fs"
import path from "node:path"
import { promisify } from "node:util"
import { inspect } from "node:util"
import type {
  SynapseLogEntry,
  SynapseLogExportResult,
  SynapseLogLevel,
  SynapseLogSource,
} from "../../src/types/log"

const LOG_DIR_NAME = "logs"
const MAX_LOG_FILE_SIZE = 10 * 1024 * 1024 // 10MB
const MAX_LOG_FILES = 30 // 保留最近30个日志文件

interface LogWriteInput {
  source: SynapseLogSource
  level: SynapseLogLevel
  category: string
  message: unknown
  details?: unknown
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
  ].join("")

  return `synapse-${d}-${t}.log`
}

const mkdirAsync = promisify(mkdir)
const readdirAsync = promisify(readdir)
const statAsync = promisify(stat)
const unlinkAsync = promisify(unlink)

class LogStore {
  private currentStream: WriteStream | null = null
  private currentFilePath: string | null = null
  private currentFileSize = 0
  private nextId = 1
  private logDirPath: string | null = null
  private buffer: string[] = []
  private flushTimer: NodeJS.Timeout | null = null
  private readonly bufferFlushInterval = 1000 // 1秒刷新一次
  private readonly maxBufferSize = 100 // 缓冲区最大条目数

  constructor() {
    this.initializeLogDirectory()
    this.startFlushTimer()
  }

  private async initializeLogDirectory(): Promise<void> {
    try {
      this.logDirPath = path.join(app.getPath("userData"), LOG_DIR_NAME)
      await mkdirAsync(this.logDirPath, { recursive: true })
      await this.rotateToNewFile()
      await this.cleanOldLogFiles()
    } catch (error) {
      // eslint-disable-next-line no-console
      console.error("Failed to initialize log directory:", error)
    }
  }

  private startFlushTimer(): void {
    this.flushTimer = setInterval(() => {
      void this.flushBuffer()
    }, this.bufferFlushInterval)
  }

  private async rotateToNewFile(): Promise<void> {
    // 关闭当前文件流
    if (this.currentStream) {
      await new Promise<void>((resolve) => {
        this.currentStream?.end(() => resolve())
      })
      this.currentStream = null
    }

    if (!this.logDirPath) {
      return
    }

    const fileName = createLogFileName(new Date())
    this.currentFilePath = path.join(this.logDirPath, fileName)
    this.currentFileSize = 0

    this.currentStream = createWriteStream(this.currentFilePath, { flags: "a" })

    // 监听流错误
    this.currentStream.on("error", (error) => {
      // eslint-disable-next-line no-console
      console.error("Log stream error:", error)
    })
  }

  private async checkRotation(): Promise<void> {
    if (this.currentFileSize >= MAX_LOG_FILE_SIZE) {
      await this.flushBuffer()
      await this.rotateToNewFile()
      await this.cleanOldLogFiles()
    }
  }

  private async cleanOldLogFiles(): Promise<void> {
    if (!this.logDirPath) {
      return
    }

    try {
      const files = await readdirAsync(this.logDirPath)
      const logFiles: { name: string; path: string; mtime: Date }[] = []

      for (const file of files) {
        if (!file.endsWith(".log")) {
          continue
        }

        const filePath = path.join(this.logDirPath, file)
        try {
          const stats = await statAsync(filePath)
          logFiles.push({ name: file, path: filePath, mtime: stats.mtime })
        } catch {
          // 忽略无法读取的文件
        }
      }

      // 按修改时间排序，保留最新的
      logFiles.sort((a, b) => b.mtime.getTime() - a.mtime.getTime())

      // 删除旧文件
      const filesToDelete = logFiles.slice(MAX_LOG_FILES)
      for (const file of filesToDelete) {
        try {
          await unlinkAsync(file.path)
        } catch {
          // 忽略删除失败
        }
      }
    } catch {
      // 忽略清理失败
    }
  }

  private async flushBuffer(): Promise<void> {
    if (this.buffer.length === 0 || !this.currentStream) {
      return
    }

    const linesToWrite = this.buffer.join("\n") + "\n"
    this.buffer = []

    return new Promise((resolve, reject) => {
      if (!this.currentStream) {
        resolve()
        return
      }

      this.currentStream.write(linesToWrite, (error) => {
        if (error) {
          reject(error)
        } else {
          this.currentFileSize += Buffer.byteLength(linesToWrite, "utf8")
          resolve()
        }
      })
    })
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

    // 格式化为单行并加入缓冲区
    const formattedLine = formatLogEntry(entry)
    this.buffer.push(formattedLine)

    // 如果缓冲区满了，立即刷新
    if (this.buffer.length >= this.maxBufferSize) {
      void this.flushBuffer().then(() => {
        void this.checkRotation()
      })
    } else {
      // 否则定期检查文件大小
      void this.checkRotation()
    }

    return entry
  }

  createLogger(source: SynapseLogSource, category: string) {
    return {
      debug: (message: unknown, details?: unknown) =>
        this.write({ source, level: "debug", category, message, details }),
      info: (message: unknown, details?: unknown) =>
        this.write({ source, level: "info", category, message, details }),
      warn: (message: unknown, details?: unknown) =>
        this.write({ source, level: "warn", category, message, details }),
      error: (message: unknown, details?: unknown) =>
        this.write({ source, level: "error", category, message, details }),
    }
  }

  async exportAllLogs(): Promise<SynapseLogExportResult> {
    if (!this.logDirPath) {
      throw new Error("Log directory not initialized")
    }

    // 先刷新缓冲区确保所有日志都写入文件
    await this.flushBuffer()

    const downloadsDir = app.getPath("downloads")
    const exportFileName = `synapse-logs-export-${new Date().toISOString().replace(/[:.]/g, "-")}.txt`
    const exportFilePath = path.join(downloadsDir, exportFileName)

    const { pipeline } = await import("node:stream/promises")
    const { createReadStream } = await import("node:fs")
    const { createWriteStream } = await import("node:fs")

    // 读取所有日志文件并按时间顺序合并
    const files = await readdirAsync(this.logDirPath)
    const logFiles: { name: string; path: string; mtime: Date }[] = []

    for (const file of files) {
      if (!file.endsWith(".log")) {
        continue
      }

      const filePath = path.join(this.logDirPath, file)
      try {
        const stats = await statAsync(filePath)
        logFiles.push({ name: file, path: filePath, mtime: stats.mtime })
      } catch {
        // 忽略无法读取的文件
      }
    }

    // 按修改时间排序（从早到晚）
    logFiles.sort((a, b) => a.mtime.getTime() - b.mtime.getTime())

    // 合并所有日志文件
    const outputStream = createWriteStream(exportFilePath)

    let totalEntries = 0

    for (const file of logFiles) {
      await new Promise<void>((resolve, reject) => {
        const inputStream = createReadStream(file.path, { encoding: "utf8" })
        let fileEntryCount = 0

        inputStream.on("data", (chunk: string) => {
          // 统计条目数（每行一个条目）
          fileEntryCount += (chunk.match(/\n/g) || []).length
        })

        inputStream.on("end", () => {
          totalEntries += fileEntryCount
        })

        inputStream.pipe(outputStream, { end: false })
        inputStream.on("end", () => resolve())
        inputStream.on("error", reject)
      })
    }

    // 添加缓冲区中的日志
    if (this.buffer.length > 0) {
      const bufferContent = this.buffer.join("\n") + "\n"
      outputStream.write(bufferContent)
      totalEntries += this.buffer.length
    }

    // 关闭输出流
    await new Promise<void>((resolve) => {
      outputStream.end(() => resolve())
    })

    return {
      entryCount: totalEntries,
      filePath: exportFilePath,
    }
  }

  async dispose(): Promise<void> {
    if (this.flushTimer) {
      clearInterval(this.flushTimer)
      this.flushTimer = null
    }

    await this.flushBuffer()

    if (this.currentStream) {
      await new Promise<void>((resolve) => {
        this.currentStream?.end(() => resolve())
      })
      this.currentStream = null
    }
  }
}

export const logStore = new LogStore()

export function createMainLogger(category: string) {
  return logStore.createLogger("main", category)
}
