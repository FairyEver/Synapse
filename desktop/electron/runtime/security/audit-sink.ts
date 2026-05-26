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
const SENSITIVE_RESOURCE_VALUE_PATTERN = /(?<=\b(?:token|secret|authorization|api[_-]?key|password|bearer|auth)\s*[:=]\s*)\S+/gi
const POSIX_PATH_PATTERN = /(?:\/Users|\/home|\/Volumes|\/private|\/tmp)\/[^\s"'`<>),;]+/g

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
        this.logger?.warn("Audit event persistence failed.", {
          action: entry.action,
          consecutiveFailures: this.consecutiveFailures,
          error: error instanceof Error ? error.message : String(error),
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

  flushForTests(): Promise<void> {
    return this.pendingWrite
  }
}

function sanitizeMetadata(
  metadata: Record<string, unknown> | undefined,
): Record<string, unknown> | undefined {
  if (!metadata) return undefined
  return sanitizeRecord(metadata)
}

function sanitizeResource(resource: string): string {
  return sanitizePathText(resource.replace(SENSITIVE_RESOURCE_VALUE_PATTERN, "[redacted]"))
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
    return sanitizePathText(value)
  }
  return value
}

function sanitizePathText(value: string): string {
  return value.replace(POSIX_PATH_PATTERN, "[path]")
}

function isSensitiveKey(key: string): boolean {
  const normalized = key.replace(/[-_\s]/g, "").toLowerCase()
  if (normalized.includes("sessionkey")) return true
  if (/^(prompt|message|content|body|text|reason|error|errors|stack)$/.test(normalized)) return true
  return /\b(token|secret|authorization|api[_-]?key|password|bearer)\b/i.test(key)
}

function projectIdFromMetadata(metadata: Record<string, unknown> | undefined): string | undefined {
  return typeof metadata?.projectId === "string" ? metadata.projectId : undefined
}

function sessionIdFromMetadata(metadata: Record<string, unknown> | undefined): string | undefined {
  if (typeof metadata?.conversationId === "string") return metadata.conversationId
  return typeof metadata?.sessionId === "string" ? metadata.sessionId : undefined
}
