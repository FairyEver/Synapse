import { randomUUID } from "node:crypto"

import type { DataNamespace, OutboxEntryV1, OutboxPayloadV1 } from "../../runtime/data-repo"
import type { StructuredLogger } from "../../runtime/service-registry"
import type { AgentEvent } from "../agent-runtime"

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
  readonly now?: () => Date
  readonly idFactory?: () => string
}

export class ReplyOutboxService {
  private readonly deps: ReplyOutboxServiceDeps
  private pendingWrite: Promise<void> = Promise.resolve()

  constructor(deps: ReplyOutboxServiceDeps) {
    this.deps = deps
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

    const write = this.pendingWrite.then(() => this.deps.outbox.upsert(entry))
    this.pendingWrite = write
      .catch((error) => {
        this.deps.logger?.warn("Outbox persistence failed.", {
          projectId: input.target.projectId,
          sessionKey: input.target.sessionKey,
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
