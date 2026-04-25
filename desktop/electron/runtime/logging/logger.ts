/**
 * Phase 0.6 — StructuredLogger.
 * SPEC §9.
 *
 * Provides:
 *   - Structured records: { timestamp, level, module, message, context }
 *   - Sink-based output (file or console, injectable for tests)
 *   - Size-based rotation (default 10MB)
 *   - `child(prefix)` creates a derived logger with a `module.<prefix>` name
 *   - Uniform 6 levels: trace / debug / info / warn / error / fatal
 *
 * Phase 0.6 lands the new StructuredLogger; the existing log-store.ts (which
 * has its own pluggable rotation) keeps powering production until Phase
 * 0.6 follow-up rewires bootstrap. The new `runtime/logging/` is the
 * forward path.
 */

import { existsSync, statSync } from "node:fs"
import path from "node:path"
import type { StructuredLogger } from "../service-registry/types"

export type LogLevel = "trace" | "debug" | "info" | "warn" | "error" | "fatal"

export const LOG_LEVELS: readonly LogLevel[] = [
  "trace",
  "debug",
  "info",
  "warn",
  "error",
  "fatal",
]

export interface LogRecord {
  readonly timestamp: string
  readonly level: LogLevel
  readonly module: string
  readonly message: string
  readonly context?: Record<string, unknown>
  readonly error?: { name: string; message: string; stack?: string }
}

export interface LogSink {
  write(record: LogRecord): void
  /** Optional flush hook; sinks that batch should drain on call. */
  flush?(): Promise<void> | void
  /** Optional close hook; sinks that own files should release them. */
  close?(): Promise<void> | void
}

// Re-export StructuredLogger from service-registry/types.ts for unified interface.
export type { StructuredLogger }

export interface LoggerOptions {
  readonly module: string
  readonly sink: LogSink
  readonly minLevel?: LogLevel
  readonly bindings?: Record<string, unknown>
}

const LEVEL_RANK: Record<LogLevel, number> = {
  trace: 10,
  debug: 20,
  info: 30,
  warn: 40,
  error: 50,
  fatal: 60,
}

class StructuredLoggerImpl implements StructuredLogger {
  private readonly module: string
  private readonly sink: LogSink
  private readonly minLevel: LogLevel
  private readonly bindings: Record<string, unknown>

  constructor(options: LoggerOptions) {
    this.module = options.module
    this.sink = options.sink
    this.minLevel = options.minLevel ?? "info"
    this.bindings = options.bindings ?? {}
  }

  trace(message: string, context?: unknown) {
    this.write("trace", message, context)
  }
  debug(message: string, context?: unknown) {
    this.write("debug", message, context)
  }
  info(message: string, context?: unknown) {
    this.write("info", message, context)
  }
  warn(message: string, context?: unknown) {
    this.write("warn", message, context)
  }
  error(message: string, context?: unknown) {
    this.write("error", message, context)
  }
  fatal(message: string, context?: unknown) {
    this.write("fatal", message, context)
  }

  child(prefix: string, bindings: Record<string, unknown> = {}): StructuredLogger {
    return new StructuredLoggerImpl({
      module: `${this.module}.${prefix}`,
      sink: this.sink,
      minLevel: this.minLevel,
      bindings: { ...this.bindings, ...bindings },
    })
  }

  private write(level: LogLevel, message: string, raw?: unknown): void {
    if (LEVEL_RANK[level] < LEVEL_RANK[this.minLevel]) return
    const record: LogRecord = {
      timestamp: new Date().toISOString(),
      level,
      module: this.module,
      message,
      context: combineContext(this.bindings, raw),
      error: extractError(raw),
    }
    this.sink.write(record)
  }
}

export function createLogger(options: LoggerOptions): StructuredLogger {
  return new StructuredLoggerImpl(options)
}

function combineContext(
  bindings: Record<string, unknown>,
  raw: unknown,
): Record<string, unknown> | undefined {
  const fromRaw = raw === undefined || raw === null ? undefined : isPlainObject(raw) ? raw : { value: raw }
  const merged = fromRaw ? { ...bindings, ...fromRaw } : { ...bindings }
  return Object.keys(merged).length > 0 ? merged : undefined
}

function extractError(raw: unknown): LogRecord["error"] | undefined {
  if (raw instanceof Error) {
    return { name: raw.name, message: raw.message, stack: raw.stack }
  }
  if (raw && typeof raw === "object" && "error" in raw && raw.error instanceof Error) {
    const err = raw.error
    return { name: err.name, message: err.message, stack: err.stack }
  }
  return undefined
}

function isPlainObject(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !(value instanceof Error)
}

// ----- Sinks --------------------------------------------------------

export class ArraySink implements LogSink {
  readonly records: LogRecord[] = []
  write(record: LogRecord): void {
    this.records.push(record)
  }
}

export class ConsoleSink implements LogSink {
  write(record: LogRecord): void {
    const formatted = `${record.timestamp} ${record.level.toUpperCase()} [${record.module}] ${record.message}`
    switch (record.level) {
      case "fatal":
      case "error":
        console.error(formatted, record.context ?? "")
        break
      case "warn":
        console.warn(formatted, record.context ?? "")
        break
      case "info":
        console.info(formatted, record.context ?? "")
        break
      default:
        console.debug(formatted, record.context ?? "")
    }
  }
}

// ----- Rotation helper ----------------------------------------------

export interface LogRotatorOptions {
  readonly logDir: string
  readonly baseName: string
  readonly maxSizeBytes?: number
}

export class LogRotator {
  readonly logDir: string
  readonly baseName: string
  readonly maxSizeBytes: number

  constructor(options: LogRotatorOptions) {
    this.logDir = options.logDir
    this.baseName = options.baseName
    this.maxSizeBytes = options.maxSizeBytes ?? 10 * 1024 * 1024
  }

  shouldRotate(filePath: string): boolean {
    if (!existsSync(filePath)) return false
    return statSync(filePath).size >= this.maxSizeBytes
  }

  nextFilePath(): string {
    const stamp = new Date().toISOString().replace(/[:.]/g, "-")
    return path.join(this.logDir, `${this.baseName}-${stamp}.log`)
  }
}
