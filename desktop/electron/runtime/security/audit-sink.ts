import { randomUUID } from "node:crypto"

import type { AuditEntryV1, DataNamespace } from "../data-repo"
import type { StructuredLogger } from "../service-registry"
import type { AuditEvent, AuditSink } from "./permission-guard"

type AuditSinkInput = Omit<AuditEvent, "id" | "timestamp"> & {
  readonly id?: string
  readonly timestamp?: string
}

export interface DataRepositoryAuditSinkDeps {
  readonly audit: DataNamespace<AuditEntryV1>
  readonly logger?: Pick<StructuredLogger, "warn">
  readonly now?: () => Date
  readonly idFactory?: () => string
}

const MAX_MEMORY_EVENTS = 10_000
const SENSITIVE_TEXT_VALUE_PATTERN = /\b(token|secret|authorization|api[_-]?key|password|auth|(?:set[-_]?cookie|cookie))\b(\s*[:=]\s*)(Bearer\s+[^\s"'`<>),;]+|"[^"]*"|'[^']*'|[^\s"'`<>),;]+)/gi
const BEARER_TEXT_VALUE_PATTERN = /\bBearer\s+[^\s"'`<>),;]+/gi
const COOKIE_HEADER_TEXT_PATTERN = /\b((?:set-)?cookie)(\s*:\s*)[^\r\n]+/gi
const POSIX_PATH_PATTERN = /(?:\/Users|\/home|\/Volumes|\/private|\/tmp)\/[^\s"'`<>),;]+/g
const WINDOWS_DRIVE_PATH_PATTERN = /\b[A-Za-z]:\\(?:[^\\\s"'`<>),;]+(?:\s+[^\\\s"'`<>),;]+)*\\)+[^\\\s"'`<>),;]+/g
const WINDOWS_UNC_PATH_PATTERN = /\\\\(?:[^\\\s"'`<>),;]+(?:\s+[^\\\s"'`<>),;]+)*\\){2,}[^\\\s"'`<>),;]+/g
const SENSITIVE_URL_PARAM_PATTERN = /(^|[-_])(token|secret|signature|sig|password|auth|key|credential|api[-_]?key|access[-_]?token|security[-_]?token|session[-_]?token)([-_]|$)/i

export class DataRepositoryAuditSink implements AuditSink {
  private readonly audit: DataNamespace<AuditEntryV1>
  private readonly logger?: Pick<StructuredLogger, "warn">
  private readonly now: () => Date
  private readonly idFactory: () => string
  private readonly events: AuditEvent[] = []
  private pendingWrite: Promise<void> = Promise.resolve()
  private healthy = true
  private consecutiveFailures = 0

  constructor(deps: DataRepositoryAuditSinkDeps) {
    this.audit = deps.audit
    this.logger = deps.logger
    this.now = deps.now ?? (() => new Date())
    this.idFactory = deps.idFactory ?? (() => `audit:${randomUUID()}`)
  }

  isHealthy(): boolean {
    return this.healthy
  }

  record(event: AuditSinkInput): void {
    const timestamp = event.timestamp ?? this.now().toISOString()
    const id = event.id ?? this.idFactory()
    const metadata = sanitizeMetadata(event.metadata)
    const resource = sanitizeResource(event.resource)
    const cachedEvent: AuditEvent = {
      action: event.action,
      actor: event.actor,
      resource,
      outcome: event.outcome,
      id,
      timestamp,
      ...(metadata ? { metadata } : {}),
    }
    this.events.push(cachedEvent)
    if (this.events.length > MAX_MEMORY_EVENTS) {
      this.events.splice(0, this.events.length - MAX_MEMORY_EVENTS)
    }

    const entry: AuditEntryV1 = {
      id,
      schemaVersion: 1,
      action: event.action,
      actor: event.actor,
      resource: {
        type: event.action.split(".")[0] ?? "permission",
        id: resource,
        projectId: projectIdFromMetadata(metadata),
      },
      outcome: event.outcome,
      timestamp,
      projectId: projectIdFromMetadata(metadata),
      sessionId: sessionIdFromMetadata(metadata),
      ...(metadata ? { metadata } : {}),
    }

    this.pendingWrite = this.pendingWrite
      .then(() => this.audit.upsert(entry))
      .then(() => {
        this.consecutiveFailures = 0
        this.healthy = true
      })
      .catch((error) => {
        this.consecutiveFailures++
        this.healthy = false
        const errorSummary = summarizePersistenceError(error)
        this.logger?.warn("Audit event persistence failed.", {
          action: entry.action,
          consecutiveFailures: this.consecutiveFailures,
          ...errorSummary,
        })
      })
  }

  list(): readonly AuditEvent[] {
    return this.events.slice()
  }

  clearForTests(): void {
    this.events.length = 0
    this.pendingWrite = Promise.resolve()
  }

  flush(): Promise<void> {
    return this.pendingWrite
  }

  flushForTests(): Promise<void> {
    return this.flush()
  }
}

function sanitizeMetadata(
  metadata: Record<string, unknown> | undefined,
): Record<string, unknown> | undefined {
  if (!metadata) return undefined
  return sanitizeRecord(metadata)
}

function sanitizeResource(resource: string): string {
  return sanitizeText(resource)
}

function sanitizeRecord(record: Record<string, unknown>): Record<string, unknown> {
  const sanitized: Record<string, unknown> = {}
  for (const [key, value] of Object.entries(record)) {
    sanitized[key] = isSensitiveKey(key) ? "[redacted]" : sanitizeValue(value)
  }
  return sanitized
}

function sanitizeValue(value: unknown): unknown {
  if (Array.isArray(value)) {
    return value.map((item) => sanitizeValue(item))
  }
  if (typeof value === "object" && value !== null) {
    return sanitizeRecord(value as Record<string, unknown>)
  }
  if (typeof value === "string") {
    return sanitizeText(value)
  }
  return value
}

function sanitizeText(value: string): string {
  return sanitizePathText(
    sanitizeUrlText(
      value
        .replace(COOKIE_HEADER_TEXT_PATTERN, (_match, key: string, separator: string) =>
          `${key}${separator}[redacted]`)
        .replace(SENSITIVE_TEXT_VALUE_PATTERN, (_match, key: string, separator: string) =>
          `${key}${separator}[redacted]`)
        .replace(BEARER_TEXT_VALUE_PATTERN, "Bearer [redacted]"),
    ),
  )
}

function summarizePersistenceError(error: unknown): {
  error: string
  errorName?: string
  errorCode?: string
  errorLength: number
} {
  const message = error instanceof Error ? error.message : String(error)
  const code = typeof error === "object" && error !== null && "code" in error
    ? String((error as { code?: unknown }).code)
    : undefined
  return {
    error: sanitizeText(message),
    ...(error instanceof Error && error.name ? { errorName: sanitizeText(error.name) } : {}),
    ...(code ? { errorCode: sanitizeText(code) } : {}),
    errorLength: message.length,
  }
}

function sanitizePathText(value: string): string {
  return value
    .replace(POSIX_PATH_PATTERN, "[path]")
    .replace(WINDOWS_UNC_PATH_PATTERN, "[path]")
    .replace(WINDOWS_DRIVE_PATH_PATTERN, "[path]")
}

function sanitizeUrlText(value: string): string {
  try {
    const url = new URL(value)
    if (url.protocol !== "http:" && url.protocol !== "https:") {
      return value
    }
    url.username = ""
    url.password = ""
    for (const key of url.searchParams.keys()) {
      if (SENSITIVE_URL_PARAM_PATTERN.test(key)) {
        url.searchParams.set(key, "[redacted]")
      }
    }
    return url.toString()
  } catch {
    return value
  }
}

function isSensitiveKey(key: string): boolean {
  const normalized = key.replace(/[-_\s]/g, "").toLowerCase()
  if (normalized.includes("sessionkey")) return true
  if (normalized.includes("cookie")) return true
  if (normalized === "args" || normalized.endsWith("args")) return true
  if (/^(prompt|message|content|body|text|reason|stack)$/.test(normalized)) return true
  return /(token|secret|authorization|apikey|password|bearer)/.test(normalized)
}

function projectIdFromMetadata(metadata: Record<string, unknown> | undefined): string | undefined {
  return typeof metadata?.projectId === "string" ? metadata.projectId : undefined
}

function sessionIdFromMetadata(metadata: Record<string, unknown> | undefined): string | undefined {
  if (typeof metadata?.conversationId === "string") return metadata.conversationId
  return typeof metadata?.sessionId === "string" ? metadata.sessionId : undefined
}
