import { app } from "electron"
import { mkdir, writeFile } from "node:fs/promises"
import path from "node:path"
import { inspect } from "node:util"
import { formatLogExportText } from "../../src/lib/log-export"
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
  message: unknown
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
    const content = formatLogExportText(this.entries)

    await mkdir(downloadsDir, { recursive: true })
    await writeFile(filePath, content, "utf8")

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
