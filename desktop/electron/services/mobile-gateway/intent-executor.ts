import { randomUUID } from "node:crypto"
import type {
  MobileIntent,
  MobileIntentResult,
  MobileKey,
  MobileKeyAction,
} from "@synapse/shared" with { "resolution-mode": "import" }

import type { TerminalService } from "../../../app-capabilities/terminal/main/service"
import type { AuditSink, PermissionAction } from "../../runtime/security/permission-guard"
import type { MobileAttachment } from "./attachment-registry"
import { AttachmentRegistry, createAttachment } from "./attachment-registry"
import { mobileControllerFor } from "./controller"

/** Long enough that an actively used terminal never loses control mid-sentence. */
const LEASE_DURATION_MS = 60_000

/** Result cache size per phone. Small: it only needs to cover an in-flight retry. */
const INTENT_HISTORY_LIMIT = 256

export type MobileGatewayLogger = {
  info(message: string, meta?: Record<string, unknown>): void
  warn(message: string, meta?: Record<string, unknown>): void
}

export type IntentExecutorDeps = {
  readonly terminal: TerminalService
  readonly registry: AttachmentRegistry
  readonly auditSink: AuditSink
  readonly logger: MobileGatewayLogger
  readonly authorize: (
    action: PermissionAction,
    resource: string,
    context?: Record<string, unknown>,
  ) => Promise<void>
  readonly nowMs: () => number
  /** Marks an attachment as having pending screen content to flush. */
  readonly markDirty: (sessionId: string) => void
  /** Asks the gateway to re-send the session list. */
  readonly requestSummary: () => void
  /** Sends a full-window frame immediately, for attach and resync. */
  readonly pushSnapshot: (attachment: MobileAttachment) => Promise<void>
  /** Sends one page of scrollback below `before`, or an empty page at the end. */
  readonly sendHistory: (attachment: MobileAttachment, before: number, limit: number) => Promise<void>
}

export class MobileIntentExecutor {
  private readonly deps: IntentExecutorDeps
  /**
   * Results keyed by intent id, per phone. The phone may resend an intent after
   * an uncertain send; replaying the stored result makes that safe without the
   * phone having to reason about whether the first attempt landed.
   */
  private readonly results = new Map<string, MobileIntentResult>()

  constructor(deps: IntentExecutorDeps) {
    this.deps = deps
  }

  forgetClient(mobileClientInstanceId: string): void {
    for (const key of this.results.keys()) {
      if (key.startsWith(`${mobileClientInstanceId}\x00`)) this.results.delete(key)
    }
  }

  async execute(
    mobileClientInstanceId: string,
    intent: MobileIntent,
  ): Promise<MobileIntentResult> {
    const cacheKey = `${mobileClientInstanceId}\x00${intent.intentId}`
    const cached = this.results.get(cacheKey)
    if (cached) return cached

    let result: MobileIntentResult
    try {
      result = await this.run(mobileClientInstanceId, intent)
    } catch (error) {
      result = {
        intentId: intent.intentId,
        outcome: "rejected",
        code: classifyError(error),
        message: describeError(error),
      }
    }
    this.remember(cacheKey, result)
    this.deps.requestSummary()
    return result
  }

  private async run(
    mobileClientInstanceId: string,
    intent: MobileIntent,
  ): Promise<MobileIntentResult> {
    const { terminal, registry } = this.deps

    switch (intent.kind) {
      case "ping":
        return { intentId: intent.intentId, outcome: "no_op" }

      case "sync": {
        await this.deps.authorize("terminal.discover", "terminal:sessions")
        this.deps.requestSummary()
        for (const attachment of registry.forClient(mobileClientInstanceId)) {
          await this.deps.pushSnapshot(attachment)
        }
        return accepted(intent.intentId)
      }

      case "attach": {
        await this.deps.authorize("terminal.state.read", sessionResource(intent.sessionId))
        const session = terminal.getSession({ sessionId: intent.sessionId })
        if (session.status !== "running" && session.status !== "stopping") {
          return {
            intentId: intent.intentId,
            outcome: "rejected",
            code: "lifecycle_conflict",
            message: "该终端已结束。",
            sessionId: session.id,
          }
        }
        const existing = registry.get(mobileClientInstanceId, intent.sessionId)
        if (existing) {
          await this.deps.pushSnapshot(existing)
          return accepted(intent.intentId, { sessionId: session.id })
        }
        const attachment = createAttachment({
          mobileClientInstanceId,
          sessionId: intent.sessionId,
          nowMs: this.deps.nowMs(),
        })
        registry.attach(attachment)
        const message = await this.tryAcquireLease(attachment)
        await this.deps.pushSnapshot(attachment)
        return { ...accepted(intent.intentId, { sessionId: session.id }), message }
      }

      case "history": {
        await this.deps.authorize("terminal.output.read", sessionResource(intent.sessionId))
        // Same read gate as the live view: history is terminal content.
        const attachment = requireWritableUnlessObservationOnly(
          registry,
          mobileClientInstanceId,
          intent.sessionId,
        )
        await this.deps.sendHistory(attachment, intent.before, intent.limit)
        return accepted(intent.intentId, { sessionId: intent.sessionId })
      }

      case "detach": {
        const attachment = registry.get(mobileClientInstanceId, intent.sessionId)
        if (attachment) await this.releaseLease(attachment)
        registry.detach(mobileClientInstanceId, intent.sessionId)
        return accepted(intent.intentId, { sessionId: intent.sessionId })
      }

      case "unlock": {
        await this.deps.authorize("terminal.session.control", sessionResource(intent.sessionId))
        const attachment = requireAttachment(registry, mobileClientInstanceId, intent.sessionId)
        // The lease the desktop took back by typing is the only thing this clears.
        // Typing itself needs no enabling: a phone that opened a terminal can write
        // to it, and the write gate is purely about who holds the lease.
        attachment.leasePreempted = false
        const message = await this.tryAcquireLease(attachment)
        this.deps.markDirty(intent.sessionId)
        return { ...accepted(intent.intentId, { sessionId: intent.sessionId }), message }
      }

      case "command": {
        await this.deps.authorize("terminal.session.control", sessionResource(intent.sessionId))
        const attachment = requireWritable(registry, mobileClientInstanceId, intent.sessionId)
        if (/[\r\n]/u.test(intent.text)) {
          return {
            intentId: intent.intentId,
            outcome: "rejected",
            code: "invalid_argument",
            message: "一次只能提交一行命令。",
          }
        }
        const lease = await this.requireLease(attachment)
        await terminal.sendCommand({
          sessionId: intent.sessionId,
          leaseId: lease.leaseId,
          expectedInputRevision: lease.inputRevision,
          text: intent.text,
          idempotencyKey: intentKey(intent.intentId),
        }, lease.controller)
        lease.attachment.leaseId = lease.leaseId
        this.deps.markDirty(intent.sessionId)
        return accepted(intent.intentId, { sessionId: intent.sessionId })
      }

      case "keys": {
        await this.deps.authorize("terminal.session.control", sessionResource(intent.sessionId))
        const attachment = requireWritable(registry, mobileClientInstanceId, intent.sessionId)
        if (intent.actions.length === 0) return accepted(intent.intentId)
        const lease = await this.requireLease(attachment)
        await terminal.sendSemanticInput({
          sessionId: intent.sessionId,
          leaseId: lease.leaseId,
          expectedInputRevision: lease.inputRevision,
          actions: intent.actions.map(toSemanticAction),
          // Stable per intent, so a resend after an uncertain link collapses into one write.
          idempotencyKey: intentKey(intent.intentId),
        }, lease.controller)
        this.deps.markDirty(intent.sessionId)
        return accepted(intent.intentId, { sessionId: intent.sessionId })
      }

      case "stop": {
        await this.deps.authorize("terminal.session.stop", sessionResource(intent.sessionId))
        const attachment = registry.get(mobileClientInstanceId, intent.sessionId)
        const controller = controllerFor(mobileClientInstanceId, intent.sessionId)
        // Normal stop only. The terminal service never escalates to a force stop on
        // its own, and neither does this gateway.
        await terminal.stopControlledSession({
          sessionId: intent.sessionId,
          idempotencyKey: intentKey(intent.intentId),
        }, controller)
        if (attachment) await this.releaseLease(attachment)
        this.deps.markDirty(intent.sessionId)
        return accepted(intent.intentId, { sessionId: intent.sessionId })
      }

      case "delete": {
        await this.deps.authorize("terminal.session.delete", sessionResource(intent.sessionId))
        const attachment = registry.get(mobileClientInstanceId, intent.sessionId)
        const session = terminal.getSession({ sessionId: intent.sessionId })
        if (session.status === "running" || session.status === "stopping") {
          // The service refuses to delete a live session (`lifecycle_conflict`), and
          // it must not be deleted a second time either: when the PTY exits, the
          // terminal service destroys the session itself and announces it. So for
          // anything still alive the stop *is* the delete.
          await terminal.stopControlledSession({
            sessionId: intent.sessionId,
            idempotencyKey: intentKey(intent.intentId),
          }, controllerFor(mobileClientInstanceId, intent.sessionId))
        } else {
          // Already ended but still listed: the service keeps those only so they
          // can be cleaned up explicitly.
          await terminal.deleteSession({ sessionId: intent.sessionId })
        }
        // The lease belongs to a session that is going away.
        if (attachment) await this.releaseLease(attachment)
        this.deps.requestSummary()
        return accepted(intent.intentId, { sessionId: intent.sessionId })
      }

      case "stopAll": {
        await this.deps.authorize("terminal.session.stop", "terminal:sessions")
        const attachments = registry.forClient(mobileClientInstanceId)
        for (const attachment of attachments) {
          await terminal.stopControlledSession({
            sessionId: attachment.sessionId,
            idempotencyKey: intentKey(`${intent.intentId}:${attachment.sessionId}`),
          }, controllerFor(mobileClientInstanceId, attachment.sessionId))
          await this.releaseLease(attachment)
        }
        this.deps.requestSummary()
        return accepted(intent.intentId)
      }

      case "rename": {
        await this.deps.authorize("terminal.metadata.manage", sessionResource(intent.sessionId))
        await terminal.renameSession({ sessionId: intent.sessionId, title: intent.title })
        this.deps.requestSummary()
        return accepted(intent.intentId, { sessionId: intent.sessionId })
      }

      case "create": {
        await this.deps.authorize("terminal.session.create", `terminal.group:${intent.groupId}`)
        const session = await terminal.createSession({
          groupId: intent.groupId,
          title: intent.title,
        })
        await this.adoptCreatedSession(mobileClientInstanceId, session.id)
        return accepted(intent.intentId, { createdSessionId: session.id })
      }

      case "launchCommand": {
        await this.deps.authorize("terminal.command.launch", `terminal.group:${intent.groupId}`)
        const session = await terminal.launchGroupCommand({
          groupId: intent.groupId,
          commandId: intent.commandId,
        }, { source: "mcp", clientId: `mobile:${mobileClientInstanceId}` })
        await this.adoptCreatedSession(mobileClientInstanceId, session.id)
        return accepted(intent.intentId, { createdSessionId: session.id })
      }

      default:
        return {
          intentId: (intent as MobileIntent).intentId,
          outcome: "rejected",
          code: "unsupported_intent",
          message: "这个操作暂不支持。",
        }
    }
  }

  /**
   * A session the phone just created is attached immediately, so the user lands
   * on a live terminal rather than an empty row they have to open.
   */
  private async adoptCreatedSession(
    mobileClientInstanceId: string,
    sessionId: string,
  ): Promise<void> {
    const registry = this.deps.registry
    if (registry.get(mobileClientInstanceId, sessionId)) return
    const attachment = createAttachment({
      mobileClientInstanceId,
      sessionId,
      nowMs: this.deps.nowMs(),
    })
    registry.attach(attachment)
    await this.tryAcquireLease(attachment)
    // A brand new session has no output yet; the first flush catches its banner.
    this.deps.markDirty(sessionId)
  }

  /**
   * Takes the write lease if it is free. A busy lease is not an error: the phone
   * still gets to watch the terminal, it just cannot type until the other writer
   * lets go.
   */
  private async tryAcquireLease(attachment: MobileAttachment): Promise<string | undefined> {
    try {
      const lease = await this.deps.terminal.acquireControl({
        sessionId: attachment.sessionId,
        requestedLeaseMs: LEASE_DURATION_MS,
        idempotencyKey: leaseKey(attachment.sessionId),
      }, controllerFor(attachment.mobileClientInstanceId, attachment.sessionId))
      attachment.leaseId = lease.leaseId
      attachment.leaseExpiresAtMs = Date.parse(lease.expiresAt)
      attachment.leasePreempted = false
      return undefined
    } catch (error) {
      attachment.leaseId = null
      attachment.leaseExpiresAtMs = 0
      attachment.leasePreempted = true
      this.deps.logger.info("Mobile attachment could not take the lease.", {
        sessionId: attachment.sessionId,
        code: classifyError(error),
      })
      return "另一个客户端正在控制这个终端。"
    }
  }

  private async releaseLease(attachment: MobileAttachment): Promise<void> {
    const leaseId = attachment.leaseId
    attachment.leaseId = null
    attachment.leaseExpiresAtMs = 0
    if (!leaseId) return
    try {
      this.deps.terminal.releaseControl(
        { sessionId: attachment.sessionId, leaseId },
        controllerFor(attachment.mobileClientInstanceId, attachment.sessionId),
      )
    } catch (error) {
      // Already expired or taken over; both are normal and need no recovery.
      this.deps.logger.info("Mobile lease release was not needed.", {
        sessionId: attachment.sessionId,
        code: classifyError(error),
      })
    }
  }

  /** Refreshes the lease and returns the revision the next write must match. */
  private async requireLease(attachment: MobileAttachment): Promise<{
    readonly leaseId: string
    readonly inputRevision: number
    readonly controller: ReturnType<typeof controllerFor>
    readonly attachment: MobileAttachment
  }> {
    const controller = controllerFor(attachment.mobileClientInstanceId, attachment.sessionId)
    // Re-acquiring is idempotent for the current owner and returns the input
    // revision the next write has to match, so no separate state read is needed.
    const lease = await this.deps.terminal.acquireControl({
      sessionId: attachment.sessionId,
      requestedLeaseMs: LEASE_DURATION_MS,
      idempotencyKey: leaseKey(attachment.sessionId),
    }, controller)
    attachment.leaseId = lease.leaseId
    attachment.leaseExpiresAtMs = Date.parse(lease.expiresAt)
    return {
      leaseId: lease.leaseId,
      inputRevision: lease.inputRevision,
      controller,
      attachment,
    }
  }

  /** Extends leases that would otherwise expire while a phone keeps a terminal open. */
  async renewLeases(): Promise<void> {
    const now = this.deps.nowMs()
    for (const attachment of this.deps.registry.all()) {
      if (!attachment.leaseId) continue
      if (attachment.leaseExpiresAtMs - now > LEASE_DURATION_MS / 2) continue
      try {
        const lease = await this.deps.terminal.renewControl({
          sessionId: attachment.sessionId,
          leaseId: attachment.leaseId,
          requestedLeaseMs: LEASE_DURATION_MS,
          idempotencyKey: leaseKey(attachment.leaseId),
        }, controllerFor(attachment.mobileClientInstanceId, attachment.sessionId))
        attachment.leaseExpiresAtMs = Date.parse(lease.expiresAt)
      } catch {
        attachment.leaseId = null
        attachment.leaseExpiresAtMs = 0
        attachment.leasePreempted = true
      }
    }
  }

  private remember(cacheKey: string, result: MobileIntentResult): void {
    this.results.set(cacheKey, result)
    if (this.results.size <= INTENT_HISTORY_LIMIT) return
    const oldest = this.results.keys().next()
    if (!oldest.done) this.results.delete(oldest.value)
  }
}

function controllerFor(mobileClientInstanceId: string, sessionId: string) {
  return mobileControllerFor({ mobileClientInstanceId, sessionId })
}

function requireAttachment(
  registry: AttachmentRegistry,
  mobileClientInstanceId: string,
  sessionId: string,
): MobileAttachment {
  const attachment = registry.get(mobileClientInstanceId, sessionId)
  if (!attachment) throw new MobileIntentError("not_attached", "请先打开这个终端。")
  return attachment
}

/**
 * History is reading, not writing, so it needs an attachment but not the write
 * gate.
 */
function requireWritableUnlessObservationOnly(
  registry: AttachmentRegistry,
  mobileClientInstanceId: string,
  sessionId: string,
): MobileAttachment {
  return requireAttachment(registry, mobileClientInstanceId, sessionId)
}

function requireWritable(
  registry: AttachmentRegistry,
  mobileClientInstanceId: string,
  sessionId: string,
): MobileAttachment {
  const attachment = requireAttachment(registry, mobileClientInstanceId, sessionId)
  if (attachment.leasePreempted) {
    throw new MobileIntentError("lease_preempted", "桌面端正在使用这个终端。")
  }
  return attachment
}

export class MobileIntentError extends Error {
  readonly code: string

  constructor(code: string, message: string) {
    super(message)
    this.name = "MobileIntentError"
    this.code = code
  }
}

function accepted(
  intentId: string,
  extra: { readonly sessionId?: string; readonly createdSessionId?: string } = {},
): MobileIntentResult {
  return { intentId, outcome: "accepted", ...extra }
}

function sessionResource(sessionId: string): string {
  return `terminal.session:${sessionId}`
}

function intentKey(intentId: string): string {
  // The terminal service requires at least 16 characters for an idempotency key.
  return `mobile-intent-${intentId}`.padEnd(16, "0")
}

function toSemanticAction(action: MobileKeyAction): { type: "text"; text: string } | {
  type: "key"
  key: MobileKey
} {
  return action.type === "text"
    ? { type: "text", text: action.text }
    : { type: "key", key: action.key }
}

/** The lease schemas require an idempotency key; mobile intents are deduplicated one layer up. */
function leaseKey(prefix: string): string {
  return `mobile-lease-${prefix}-${randomUUID()}`
}

function classifyError(error: unknown): string {
  if (error instanceof MobileIntentError) return error.code
  if (error && typeof error === "object" && "code" in error) {
    const code = (error as { code?: unknown }).code
    if (typeof code === "string") return code
  }
  return "internal_error"
}

function describeError(error: unknown): string {
  if (error instanceof MobileIntentError) return error.message
  return "操作没有完成。"
}
