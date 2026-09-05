import { randomUUID } from "node:crypto"

import { REPLY_OUTBOX_SENT_RETENTION_LIMIT } from "../../../config"
import type { DataNamespace, OutboxEntryV1, OutboxPayloadV1 } from "../../runtime/data-repo"
import type { StructuredLogger } from "../../runtime/service-registry"
import type { AgentEvent } from "../agent-runtime"

const OUTBOX_RETENTION_SCAN_LIMIT = 1_000

export interface ReplyTarget {
  readonly projectId: string
  readonly sessionKey: string
  readonly conversationId?: string
  readonly threadId?: string
  readonly messageId?: string
  readonly transport: {
    readonly kind: string
    readonly connectorId?: string
  }
  readonly replyCtx?: Record<string, unknown>
  readonly metadata?: Record<string, unknown>
}

export type ReplyOutboxStatus = "pending" | "sent" | "failed"

export interface ReplyOutboxRecordInput {
  readonly target: ReplyTarget
  readonly payload: OutboxPayloadV1
  readonly status: ReplyOutboxStatus
  readonly lastError?: string
}

export interface ReplyOutboxServiceDeps {
  readonly projectId: string
  readonly outbox: DataNamespace<OutboxEntryV1>
  readonly logger?: Pick<StructuredLogger, "warn">
  readonly sentRetentionLimit?: number
  readonly now?: () => Date
  readonly idFactory?: () => string
}

export class ReplyOutboxService {
  private readonly deps: ReplyOutboxServiceDeps
  private readonly sentRetentionLimit: number
  private readonly retainedSentIdsByDestination = new Map<string, string[]>()
  private readonly initializedDestinations = new Set<string>()
  private pendingWrite: Promise<void> = Promise.resolve()

  constructor(deps: ReplyOutboxServiceDeps) {
    this.deps = deps
    this.sentRetentionLimit = normalizePositiveLimit(
      deps.sentRetentionLimit,
      REPLY_OUTBOX_SENT_RETENTION_LIMIT,
    )
  }

  record(input: ReplyOutboxRecordInput): Promise<string> {
    const now = this.isoNow()
    const id = this.nextId()
    const entry: OutboxEntryV1 = {
      id,
      schemaVersion: 1,
      projectId: input.target.projectId,
      destination: {
        platform: input.target.transport.kind,
        connectorId: input.target.transport.connectorId,
        sessionKey: input.target.sessionKey,
        replyCtx: input.target.replyCtx,
        externalId: input.target.messageId ?? input.target.threadId,
      },
      payload: input.payload,
      attempts: input.status === "pending" ? 0 : 1,
      status: input.status,
      lastError: input.lastError,
      createdAt: now,
      updatedAt: now,
    }

    const write = this.pendingWrite.then(async () => {
      await this.deps.outbox.upsert(entry)
      if (input.status === "sent") {
        await this.pruneSentEntriesSafely(entry)
      }
    })
    this.pendingWrite = write
      .catch((error) => {
        this.deps.logger?.warn("Outbox persistence failed.", {
          projectId: input.target.projectId,
          hasSessionKey: Boolean(input.target.sessionKey),
          ...errorDiagnostic(error),
        })
      })

    return write.then(() => id)
  }

  recordAgentEvent(target: ReplyTarget, event: AgentEvent): Promise<string> {
    const payload = payloadFromAgentEvent(event)
    const failed = event.type === "error"
    return this.record({
      target,
      payload,
      status: failed ? "failed" : "pending",
      lastError: failed ? outboxErrorSummary(event.message) : undefined,
    })
  }

  updateRecordStatus(
    id: string,
    status: ReplyOutboxStatus,
    lastError?: string,
  ): Promise<void> {
    const now = this.isoNow()
    const write = this.pendingWrite
      .then(async () => {
        const entry = await this.deps.outbox.get(id)
        if (!entry) return
        await this.deps.outbox.upsert({
          ...entry,
          status,
          lastError: lastError ? outboxErrorSummary(lastError) : undefined,
          updatedAt: now,
        })
        if (status === "sent") {
          await this.pruneSentEntriesSafely({
            ...entry,
            status,
            lastError: undefined,
            updatedAt: now,
          })
        }
      })
    this.pendingWrite = write
      .catch((error) => {
        this.deps.logger?.warn("Outbox status update failed.", {
          outboxId: id,
          status,
          ...errorDiagnostic(error),
        })
      })
    return write
  }

  async list(filter?: Partial<OutboxEntryV1>): Promise<OutboxEntryV1[]> {
    return this.deps.outbox.list(filter)
  }

  flushForTests(): Promise<void> {
    return this.pendingWrite
  }

  private async pruneSentEntriesSafely(entry: OutboxEntryV1): Promise<void> {
    try {
      await this.pruneSentEntries(entry)
    } catch (error) {
      this.deps.logger?.warn("Outbox retention cleanup failed.", {
        projectId: entry.projectId,
        platform: entry.destination.platform,
        connectorId: entry.destination.connectorId,
        hasSessionKey: Boolean(entry.destination.sessionKey),
        boundary: "reply-outbox-retention",
        ...errorDiagnostic(error),
      })
    }
  }

  private async pruneSentEntries(entry: OutboxEntryV1): Promise<void> {
    const destinationKey = outboxDestinationKey(entry)
    if (!this.initializedDestinations.has(destinationKey)) {
      const historicalIds = await this.loadRecentSentIds(entry)
      this.retainedSentIdsByDestination.set(destinationKey, historicalIds)
      this.initializedDestinations.add(destinationKey)
    }
    const retainedIds = this.retainedSentIdsByDestination.get(destinationKey) ?? []
    const nextRetainedIds = [entry.id, ...retainedIds.filter((id) => id !== entry.id)]
    const staleIds = nextRetainedIds.slice(this.sentRetentionLimit)
    this.retainedSentIdsByDestination.set(destinationKey, nextRetainedIds.slice(0, this.sentRetentionLimit))
    await Promise.all(staleIds.map((id) => this.deps.outbox.remove(id)))
  }

  private async loadRecentSentIds(entry: OutboxEntryV1): Promise<string[]> {
    if (!this.deps.outbox.listWindow) return []
    const rows = await this.deps.outbox.listWindow({
      filter: {
        projectId: entry.projectId,
        status: "sent",
      },
      orderBy: "updatedAt",
      order: "desc",
      limit: OUTBOX_RETENTION_SCAN_LIMIT,
    })
    const matchingIds = rows
      .map((row) => row.value)
      .filter((candidate) => outboxDestinationKey(candidate) === outboxDestinationKey(entry))
      .map((candidate) => candidate.id)
    const staleIds = matchingIds.slice(this.sentRetentionLimit)
    await Promise.all(staleIds.map((id) => this.deps.outbox.remove(id)))
    return matchingIds.slice(0, this.sentRetentionLimit)
  }

  private nextId(): string {
    return this.deps.idFactory?.() ?? `outbox:${randomUUID()}`
  }

  private isoNow(): string {
    return (this.deps.now?.() ?? new Date()).toISOString()
  }
}

function payloadFromAgentEvent(event: AgentEvent): OutboxPayloadV1 {
  switch (event.type) {
    case "text":
      return eventPayload("text", event.content, event)
    case "result":
      return eventPayload("text", event.content, event)
    case "error":
      return eventPayload("event", outboxErrorSummary(event.message), event)
    case "thinking":
      return eventPayload("event", event.content, event)
    case "toolUse":
      return eventPayload("event", event.toolName, event)
    case "toolResult":
      return eventPayload("event", event.content ?? event.toolName, event)
    case "permissionRequest":
      return eventPayload("event", event.toolName, event)
    case "sessionInit":
      return eventPayload("event", event.sdkSessionId, event)
    case "assistant":
    case "stream":
    case "status":
    case "compactBoundary":
    case "sdkEvent":
    case "fileCheckpoint":
      return eventPayload("event", undefined, event)
    default: {
      const exhaustive: never = event
      return eventPayload("event", "unknown", exhaustive)
    }
  }
}

function eventPayload(
  kind: OutboxPayloadV1["kind"],
  content: string | undefined,
  event: AgentEvent,
): OutboxPayloadV1 {
  const metadata: Record<string, unknown> = {
    eventType: event.type,
  }
  if (event.agentSessionId) metadata.agentSessionId = event.agentSessionId
  if (event.threadId) metadata.threadId = event.threadId
  if (event.conversationId) metadata.conversationId = event.conversationId
  if (event.turnId) metadata.turnId = event.turnId
  if (event.providerId) metadata.providerId = event.providerId
  if (event.projectId) metadata.projectId = event.projectId
  if (event.sdkSessionId) metadata.sdkSessionId = event.sdkSessionId

  return {
    kind,
    content,
    metadata,
  }
}

function errorDiagnostic(error: unknown): Record<string, unknown> {
  const message = error instanceof Error ? error.message : String(error)
  return {
    errorName: error instanceof Error ? error.name : typeof error,
    errorLength: message.length,
  }
}

function outboxErrorSummary(message: string): string {
  return `Error (${message.length} chars)`
}

function outboxDestinationKey(entry: OutboxEntryV1): string {
  return [
    entry.projectId,
    entry.destination.platform,
    entry.destination.connectorId ?? "",
    entry.destination.sessionKey,
  ].join("\u0000")
}

function normalizePositiveLimit(value: number | undefined, fallback: number): number {
  if (typeof value !== "number" || !Number.isFinite(value)) return fallback
  return Math.max(1, Math.floor(value))
}
