import { app } from "electron"
import { mkdir, writeFile } from "node:fs/promises"
import path from "node:path"
import { inspect } from "node:util"
import type {
  SynapseLogAppendedEvent,
  SynapseLogEntry,
  SynapseLogExportResult,
  SynapseLogLevel,
  SynapseLogListQuery,
  SynapseLogListResult,
  SynapseLogSource,
  SynapseLogSummary,
} from "../../src/types/log"

type LogWriteInput = {
  source: SynapseLogSource
  level: SynapseLogLevel
  category: string
  message: string
  details?: unknown
}

type LogListener = (event: SynapseLogAppendedEvent) => void

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

function formatLogLine(entry: SynapseLogEntry): string {
  const head = `[${entry.createdAt}] [${entry.level.toUpperCase()}] [${entry.source}:${entry.category}] ${entry.message}`

  if (!entry.details) {
    return head
  }

  return `${head}\n${entry.details}`
}

function createLogFileName(): string {
  const now = new Date()
  const date = [
    now.getFullYear(),
    String(now.getMonth() + 1).padStart(2, "0"),
    String(now.getDate()).padStart(2, "0"),
  ].join("")
  const time = [
    String(now.getHours()).padStart(2, "0"),
    String(now.getMinutes()).padStart(2, "0"),
    String(now.getSeconds()).padStart(2, "0"),
  ].join("")

  return `synapse-log-${date}-${time}.txt`
}

class LogStore {
  private readonly entries: SynapseLogEntry[] = []
  private readonly listeners = new Set<LogListener>()
  private nextId = 1
  private readonly maxEntries = 50000

  write(input: LogWriteInput): SynapseLogEntry {
    const entry: SynapseLogEntry = {
      id: this.nextId,
      createdAt: new Date().toISOString(),
      level: input.level,
      source: input.source,
      category: input.category.trim() || "app",
      message: input.message.trim() || "(empty message)",
      details: formatDetails(input.details),
    }

    this.nextId += 1
    this.entries.push(entry)

    if (this.entries.length > this.maxEntries) {
      this.entries.splice(0, this.entries.length - this.maxEntries)
    }

    const event: SynapseLogAppendedEvent = {
      entry,
      total: this.entries.length,
    }

    for (const listener of this.listeners) {
      listener(event)
    }

    return structuredClone(entry)
  }

  createLogger(source: SynapseLogSource, category: string) {
    return {
      debug: (message: string, details?: unknown) =>
        this.write({ source, level: "debug", category, message, details }),
      info: (message: string, details?: unknown) =>
        this.write({ source, level: "info", category, message, details }),
      warn: (message: string, details?: unknown) =>
        this.write({ source, level: "warn", category, message, details }),
      error: (message: string, details?: unknown) =>
        this.write({ source, level: "error", category, message, details }),
    }
  }

  getSummary(): SynapseLogSummary {
    return {
      total: this.entries.length,
    }
  }

  list(query: SynapseLogListQuery): SynapseLogListResult {
    const offset = Math.max(0, Math.min(query.offset, this.entries.length))
    const limit = Math.max(0, query.limit)

    return {
      total: this.entries.length,
      entries: structuredClone(this.entries.slice(offset, offset + limit)),
    }
  }

  onAppended(listener: LogListener): () => void {
    this.listeners.add(listener)

    return () => {
      this.listeners.delete(listener)
    }
  }

  async exportToDownloads(): Promise<SynapseLogExportResult> {
    const downloadsDir = app.getPath("downloads")
    const filePath = path.join(downloadsDir, createLogFileName())
    const content = this.entries.map(formatLogLine).join("\n\n")

    await mkdir(downloadsDir, { recursive: true })
    await writeFile(filePath, content.length > 0 ? `${content}\n` : "", "utf8")

    return {
      entryCount: this.entries.length,
      filePath,
    }
  }
}

export const logStore = new LogStore()

export function createMainLogger(category: string) {
  return logStore.createLogger("main", category)
}
