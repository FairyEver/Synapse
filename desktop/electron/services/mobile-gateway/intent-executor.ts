import { randomUUID } from "node:crypto"
import type {
  MobileIntent,
  MobileIntentResult,
  MobileKey,
  MobileKeyAction,
  MobileModelTier,
} from "@synapse/shared" with { "resolution-mode": "import" }

import type { TerminalService } from "../../../app-capabilities/terminal/main/service"
import type { AuditSink, PermissionAction } from "../../runtime/security/permission-guard"
import type { MobileAttachment } from "./attachment-registry"
import { AttachmentRegistry, createAttachment } from "./attachment-registry"
import { mobileControllerFor, MOBILE_RELAY_RESOURCE } from "./controller"
import type { MobileFileRelay } from "./file-relay"
import { MobileFileRelayError } from "./file-relay"

/** Long enough that an actively used terminal never loses control mid-sentence. */
const LEASE_DURATION_MS = 60_000

/** Result cache size per phone. Small: it only needs to cover an in-flight retry. */
const INTENT_HISTORY_LIMIT = 256

/**
 * How often a phone is told how far along a relayed file is.
 *
 * The download underneath reports every 100 ms, which would be ten socket messages
 * a second for something the user reads as a bar. Coarser than this and the bar
 * visibly steps on a fast link. The opening tick and the closing one always go, so
 * even a transfer too quick to need a bar still says it started and finished.
 */
const TRANSFER_PROGRESS_INTERVAL_MS = 250

export type MobileGatewayLogger = {
  info(message: string, meta?: Record<string, unknown>): void
  warn(message: string, meta?: Record<string, unknown>): void
}

export type IntentExecutorDeps = {
  readonly terminal: TerminalService
  readonly registry: AttachmentRegistry
  readonly fileRelay: MobileFileRelay
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
  /**
   * Asks for the list even if it has not changed since the last one was sent.
   *
   * For a caller that has just arrived and therefore holds nothing — see
   * `MobileGatewayService.resendSummary`.
   */
  readonly resendSummary: () => void
  /** Sends a full-window frame immediately, for attach and resync. */
  readonly pushSnapshot: (attachment: MobileAttachment) => Promise<void>
  /** Sends one page of scrollback below `before`, or an empty page at the end. */
  readonly sendHistory: (attachment: MobileAttachment, before: number, limit: number) => Promise<void>
  /**
   * Tells one phone how far along the computer is in fetching a file it relayed.
   *
   * Out-of-band rather than part of the intent's answer, because the answer is a
   * single value at the end and this is what there is to say while the file is
   * still coming down.
   */
  readonly reportTransferProgress: (
    mobileClientInstanceId: string,
    intentId: string,
    completedBytes: number,
    totalBytes: number,
  ) => void
  /**
   * Starts the bundled Claude Code in one of the computer's projects.
   *
   * Injected rather than imported: the launcher lives in the agent module, which this
   * service has no other reason to know about, and the wiring belongs where every
   * other cross-module assembly is. Structurally typed for the same reason — the two
   * sides agree on the shape without sharing a module to say so.
   *
   * The Provider's credentials are read on the far side of this call and never cross
   * it: everything that goes in is a project, an optional choice, and a grid.
   */
  readonly createClaudeCodeConversation: (
    input: ClaudeCodeConversationLaunch,
  ) => Promise<{ readonly id: string }>
}

/** What a phone may name, and nothing else. No credential, no environment, no path. */
export type ClaudeCodeConversationLaunch = {
  readonly projectId: string
  readonly providerId?: string
  readonly modelTier?: MobileModelTier
  readonly cols?: number
  readonly rows?: number
  readonly createdByClientId?: string
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
        // Not `requestSummary`: a phone sends this the moment it connects, so it is
        // exactly the caller that has received nothing and cannot be answered with
        // "the list has not changed".
        this.deps.resendSummary()
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

      /**
       * The phone sets the grid, for the display mode where it drives the size so
       * its own rendering is exact instead of wrapped.
       *
       * This is a UI resize, not an automated one: ADR 0063 lets it proceed
       * without a lease, because it takes no input control and revokes nothing the
       * desktop holds. The desktop records who asked so it can show a badge and
       * offer to take the grid back.
       */
      case "resize": {
        await this.deps.authorize("terminal.session.resize", sessionResource(intent.sessionId))
        await terminal.resizeSessionFromDevice({
          sessionId: intent.sessionId,
          cols: intent.cols,
          rows: intent.rows,
          deviceLabel: intent.deviceLabel,
          mobileClientInstanceId,
        })
        return accepted(intent.intentId, { sessionId: intent.sessionId })
      }

      /**
       * Hands the grid back, for when the reader leaves the mode where the phone
       * drives the size.
       *
       * Authorized as a resize because that is what it is the other half of: the
       * same permission that lets a phone choose the size lets it stop choosing.
       * The desktop moves the PTY back to its own layout's shape as part of the
       * same call, because the phone has just switched to drawing that shape and
       * has no other way to learn it: the desktop's fit only runs while a pane is
       * on screen, so a backgrounded window would otherwise leave the terminal at
       * the phone's grid while the phone drew the desktop's.
       *
       * Refused, not silently accepted, when the desktop has never laid the
       * terminal out — see `restoreGridForDesktop`. That refusal is half of a
       * protocol, not an error report: it tells the phone the grid could not be
       * handed back at all, so the phone returns its display mode to the one where
       * it sizes the terminal itself. The reader is not left on a mode that
       * describes nothing. The message below is therefore a statement of the state
       * that follows it, and the two halves change together — see
       * `applyGridRelease` on the phone.
       */
      case "releaseGrid": {
        await this.deps.authorize("terminal.session.resize", sessionResource(intent.sessionId))
        const restored = await terminal.restoreGridForDesktop(intent.sessionId)
        if (!restored) {
          return {
            intentId: intent.intentId,
            outcome: "rejected",
            code: "desktop_grid_unknown",
            message: "电脑端还没有显示过这个终端，已恢复为优先移动端。",
            sessionId: intent.sessionId,
          }
        }
        return accepted(intent.intentId, { sessionId: intent.sessionId })
      }

      case "create": {
        await this.deps.authorize("terminal.session.create", `terminal.group:${intent.groupId}`)
        // Explicit starting dimensions are also a resize. ADR 0063 requires both
        // permissions for them, and says so in as many words.
        const sized = intent.cols !== undefined && intent.rows !== undefined
        if (sized) {
          await this.deps.authorize("terminal.session.resize", `terminal.group:${intent.groupId}`)
        }
        const session = await terminal.createSession({
          groupId: intent.groupId,
          title: intent.title,
          cols: intent.cols,
          rows: intent.rows,
        })
        // A phone that created the terminal at its own shape keeps deciding that
        // shape, so the desktop shows the badge from the first frame. The size was
        // already established at creation, so this only records the owner.
        if (sized && intent.deviceLabel !== undefined) {
          await terminal.resizeSessionFromDevice({
            sessionId: session.id,
            cols: intent.cols as number,
            rows: intent.rows as number,
            deviceLabel: intent.deviceLabel,
            mobileClientInstanceId,
          })
        }
        await this.adoptCreatedSession(mobileClientInstanceId, session.id)
        return accepted(intent.intentId, { createdSessionId: session.id })
      }

      /**
       * A file the phone uploaded to the user's drive, to be brought down here and
       * named in the terminal.
       *
       * Order matters. The bytes are fetched first and the cloud copy is dropped
       * the moment they are local, because "the file is on this computer" is the
       * promise the phone made to the user; typing the path is the convenience on
       * top of it. A terminal that has since ended, or a lease the desktop's own
       * user has taken, therefore costs the insertion and nothing else — and the
       * result says so rather than reporting a failure that did not happen.
       */
      case "fileUpload": {
        await this.deps.authorize("fs.write.outside-userdata", MOBILE_RELAY_RESOURCE)
        const landed = await this.deps.fileRelay.land({
          driveItemId: intent.driveItemId,
          fileName: intent.fileName,
          onProgress: createTransferProgressReporter(
            this.deps.nowMs,
            (completedBytes, totalBytes) => this.deps.reportTransferProgress(
              mobileClientInstanceId,
              intent.intentId,
              completedBytes,
              totalBytes,
            ),
          ),
        })
        await this.deps.fileRelay.discardCloudCopy(intent.driveItemId)
        const note = await this.typeRelayedPath(
          mobileClientInstanceId,
          intent.sessionId,
          landed.path,
          intent.intentId,
        )
        return {
          intentId: intent.intentId,
          outcome: "accepted",
          sessionId: intent.sessionId,
          // The phone has no way to know this — the directory a file lands in is
          // this computer's fact. It needs the path both to say where the file went
          // and to undo the insertion, which is one backspace per character.
          landedPath: landed.path,
          ...(note === undefined ? {} : { message: note }),
        }
      }

      /**
       * Starts the bundled Claude Code in a project, at the phone's request.
       *
       * The phone names a project and, optionally, a Provider and tier. Everything
       * else is the computer's: its own default selection when neither was named, and
       * the Provider's credentials, which are read here and go nowhere near the phone.
       *
       * Authorized exactly as `create` is, and for the same reasons — a conversation
       * started this way is a terminal, and starting one from a phone is the same act
       * as starting one from the desktop's own shortcut.
       */
      case "createAgentConversation": {
        await this.deps.authorize("terminal.session.create", `terminal.group:${intent.projectId}`)
        // Explicit starting dimensions are also a resize. ADR 0063 requires both
        // permissions for them, and says so in as many words.
        const sized = intent.cols !== undefined && intent.rows !== undefined
        if (sized) {
          await this.deps.authorize("terminal.session.resize", `terminal.group:${intent.projectId}`)
        }
        const session = await this.deps.createClaudeCodeConversation({
          projectId: intent.projectId,
          ...(intent.providerId === undefined ? {} : { providerId: intent.providerId }),
          ...(intent.modelTier === undefined ? {} : { modelTier: intent.modelTier }),
          ...(intent.cols === undefined ? {} : { cols: intent.cols }),
          ...(intent.rows === undefined ? {} : { rows: intent.rows }),
          // Same attribution `launchCommand` uses, so a terminal started from a phone
          // is recorded as such rather than looking like the desktop's own doing.
          createdByClientId: `mobile:${mobileClientInstanceId}`,
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
   * Types a landed path at the terminal's prompt, without pressing Enter.
   *
   * Never turns a failure into a rejected result. By the time this runs the file
   * is already on the user's disk and the cloud copy is already gone, so the only
   * thing left that can go wrong is the insertion — and the phone has to hear
   * "landed, but not typed" rather than an error that would make it queue a retry
   * for a file that is already there.
   *
   * The text is the bare path, unquoted: `file-relay.ts` reduces a name to
   * letters, digits, `._-` and CJK, and the directory it lands in has no spaces
   * either, so there is nothing left for a shell to split on.
   */
  private async typeRelayedPath(
    mobileClientInstanceId: string,
    sessionId: string,
    filePath: string,
    intentId: string,
  ): Promise<string | undefined> {
    try {
      await this.deps.authorize("terminal.session.control", sessionResource(sessionId))
      const attachment = requireWritable(this.deps.registry, mobileClientInstanceId, sessionId)
      const lease = await this.requireLease(attachment)
      await this.deps.terminal.sendSemanticInput({
        sessionId,
        leaseId: lease.leaseId,
        expectedInputRevision: lease.inputRevision,
        actions: [{ type: "text", text: filePath }],
        // Stable per intent, so a resend after an uncertain link cannot type the
        // same path twice. The executor's own result cache catches most of these
        // first; this is the layer that holds if that cache has evicted the entry.
        idempotencyKey: intentKey(`${intentId}:path`),
      }, lease.controller)
      this.deps.markDirty(sessionId)
      return undefined
    } catch (error) {
      const code = classifyError(error)
      if (code === "not_attached" || code === "session_not_found") {
        return "文件已落到电脑，但这个终端已经不在了，路径没有插入。"
      }
      if (code === "lease_preempted" || code === "control_busy" || code === "lease_expired" ||
        code === "lease_invalid") {
        return "文件已落到电脑，但桌面端正在使用这个终端，路径没有插入。"
      }
      this.deps.logger.warn("Relayed path could not be typed into the terminal.", {
        sessionId,
        code,
      })
      return "文件已落到电脑，但路径没有插入。"
    }
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

/**
 * Rate-limits a download's own progress callbacks onto the live socket.
 *
 * `totalBytes` of 0 means the download declared no length, so there is no point at
 * which it can be told to be finished — which is why the "the last one always goes"
 * rule keys on a known total rather than on a final call.
 *
 * That same rule is latched: a body longer than its declared length keeps reporting
 * `completed >= total` for every remaining chunk, and letting each of those past the
 * throttle would turn the one message worth sending into a flood.
 */
function createTransferProgressReporter(
  nowMs: () => number,
  report: (completedBytes: number, totalBytes: number) => void,
): (completedBytes: number, totalBytes: number) => void {
  let lastSentAtMs: number | null = null
  let settledSent = false
  return (completedBytes, totalBytes) => {
    const now = nowMs()
    if (totalBytes > 0 && completedBytes >= totalBytes) {
      if (settledSent) return
      settledSent = true
      lastSentAtMs = now
      report(completedBytes, totalBytes)
      return
    }
    if (lastSentAtMs !== null && now - lastSentAtMs < TRANSFER_PROGRESS_INTERVAL_MS) return
    lastSentAtMs = now
    report(completedBytes, totalBytes)
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
  // The relay's failures are all things the user can act on — the file was too
  // large, the cloud item was gone — so its own wording beats a generic one.
  if (error instanceof MobileFileRelayError) return error.message
  // Same bargain for an injected capability that raises errors written for the user:
  // the Claude Code launcher's failures are a missing runtime and an unconfigured
  // Provider, both of which the user fixes on the computer. Recognised by the flag
  // rather than by its class, so this module does not have to import the agent
  // module — and an error that does not carry the flag still cannot put its own
  // wording on the user's screen.
  if (error instanceof Error && (error as { readonly userFacing?: unknown }).userFacing === true) {
    return error.message
  }
  return "操作没有完成。"
}
