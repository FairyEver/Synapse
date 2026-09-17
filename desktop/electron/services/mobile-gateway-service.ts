import { MOBILE_FRAME_LIMITS } from "@synapse/shared/mobile-live-constants"
import type {
  MobileIntent,
  MobileIntentResult,
  MobileSummaryGroup,
  MobileSummarySession,
  MobileSummaryWorkspace,
  MobileTerminalFrame,
} from "@synapse/shared" with { "resolution-mode": "import" }
import { collectTerminalPaneLeaves } from "../../app-capabilities/terminal/shared/workspace"

import type {
  TerminalService,
} from "../../app-capabilities/terminal/main/service"
import type { TerminalStyledLine } from "../../app-capabilities/terminal/main/emulator"
import type {
  AuditSink,
  PermissionAction,
  PermissionGuard,
} from "../runtime/security/permission-guard"
import type { MobileAttachment } from "./mobile-gateway/attachment-registry"
import { AttachmentRegistry } from "./mobile-gateway/attachment-registry"
import { MOBILE_GATEWAY_ACTOR } from "./mobile-gateway/controller"
import type { MobileFileRelay } from "./mobile-gateway/file-relay"
import { buildTerminalFrames } from "./mobile-gateway/frame-builder"
import type { MobileGatewayLogger } from "./mobile-gateway/intent-executor"
import { MobileIntentError, MobileIntentExecutor } from "./mobile-gateway/intent-executor"
import type { MobileGatewayTransport } from "./mobile-gateway/transport"

export type { MobileGatewayTransport, MobileSummaryDraft } from "./mobile-gateway/transport"

/**
 * How long output is accumulated before a frame is sent.
 *
 * Terminal output arrives in bursts — a build emits dozens of chunks in a few
 * milliseconds — and one frame per chunk would spend most of its bytes on
 * per-frame overhead. 60 ms is below the threshold where scrolling stops looking
 * continuous and collapses a burst into a single frame.
 */
const FLUSH_INTERVAL_MS = 60

/** The session list changes far less often than the screen; 1 Hz is plenty. */
const SUMMARY_INTERVAL_MS = 1_000

/** Tail lines read to answer "what is this terminal doing right now". */
const SUMMARY_TAIL_LINES = 4

/**
 * Styled lines read per flush. This is the replayable window a phone can scroll
 * back through; the desktop keeps the full scrollback.
 */
const DEFAULT_LINE_WINDOW = 500

const LEASE_RENEW_INTERVAL_MS = 15_000

/**
 * Safety net for a phone that vanished without detaching — killed by iOS, lost
 * its network, or crashed. A client that stops sending anything is dropped and its
 * leases released, so a dead phone cannot pin a terminal's write lease.
 *
 * Well above the client's keepalive interval, so a healthy idle viewer is never
 * dropped. Step 2 adds an explicit disconnect signal from the cloud that makes
 * this immediate; this exists so correctness does not depend on it.
 */
const CLIENT_IDLE_TIMEOUT_MS = 5 * 60_000

/**
 * How long a phone keeps deciding a terminal's grid after it stops responding.
 *
 * Far shorter than the idle timeout: the phone pings every 25 s while a terminal
 * is open, so three missed pings mean it is gone. A desktop left claiming a phone
 * sized the grid — while actually holding a grid the local user did not pick — is
 * a worse outcome than releasing the claim a little early. Only the claim is
 * dropped: the PTY keeps its size until the desktop's next layout change, so
 * nothing reflows out from under a terminal someone is reading.
 */
const SIZE_OWNERSHIP_IDLE_TIMEOUT_MS = 90_000

export type MobileGatewayServiceDeps = {
  readonly terminal: TerminalService
  readonly fileRelay: MobileFileRelay
  readonly permissionGuard: PermissionGuard
  readonly auditSink: AuditSink
  readonly logger: MobileGatewayLogger
  readonly now?: () => Date
  readonly setTimeout?: (callback: () => void, delayMs: number) => NodeJS.Timeout
  readonly clearTimeout?: (handle: NodeJS.Timeout) => void
  readonly lineWindowLines?: number
}

export type MobileGatewayState = {
  readonly started: boolean
  readonly transportAttached: boolean
  readonly clients: number
  readonly attachments: number
  readonly lastSummaryRevision: number
}

export class MobileGatewayService {
  private readonly deps: MobileGatewayServiceDeps
  private readonly terminal: TerminalService
  private readonly registry = new AttachmentRegistry()
  private readonly executor: MobileIntentExecutor
  private readonly setTimer: (callback: () => void, delayMs: number) => NodeJS.Timeout
  private readonly clearTimer: (handle: NodeJS.Timeout) => void
  private readonly lineWindowLines: number

  private transport: MobileGatewayTransport | null = null
  private started = false
  private flushTimer: NodeJS.Timeout | null = null
  private summaryTimer: NodeJS.Timeout | null = null
  private leaseTimer: NodeJS.Timeout | null = null

  private summaryRevision = 0
  private lastSummaryContent = ""
  private readonly bytesByClient = new Map<string, { windowStartedMs: number; bytes: number }>()
  private readonly lastLineCache = new Map<string, string>()
  private readonly lastLineDirty = new Set<string>()
  private readonly lastActivityByClient = new Map<string, number>()

  constructor(deps: MobileGatewayServiceDeps) {
    this.deps = deps
    this.terminal = deps.terminal
    this.setTimer = deps.setTimeout ?? ((callback, delayMs) => setTimeout(callback, delayMs))
    this.clearTimer = deps.clearTimeout ?? ((handle) => clearTimeout(handle))
    this.lineWindowLines = deps.lineWindowLines ?? DEFAULT_LINE_WINDOW
    this.executor = new MobileIntentExecutor({
      terminal: deps.terminal,
      registry: this.registry,
      fileRelay: deps.fileRelay,
      auditSink: deps.auditSink,
      logger: deps.logger,
      authorize: (action, resource, context) => this.authorize(action, resource, context),
      nowMs: () => this.nowMs(),
      markDirty: (sessionId) => this.markDirty(sessionId),
      requestSummary: () => this.scheduleSummary(),
      resendSummary: () => this.resendSummary(),
      pushSnapshot: (attachment) => this.pushSnapshot(attachment),
      sendHistory: (attachment, before, limit) => this.sendHistory(attachment, before, limit),
    })
  }

  setTransport(transport: MobileGatewayTransport | null): void {
    this.transport = transport
    if (transport) this.scheduleSummary()
  }

  /**
   * Subscribes to the terminal service's own event emitter rather than going
   * through IPC or the EventBus. The terminal capability deliberately does not
   * publish to the EventBus, and the renderer path is a broadcast to windows that
   * has nothing to do with this consumer.
   *
   * Four listeners here plus the six the terminal IPC layer registers lands at
   * Node's default cap of ten; that is the whole budget, so this list should not grow.
   */
  start(): void {
    if (this.started) return
    this.started = true
    const events = this.terminal.events
    events.on("data", this.handleData)
    events.on("stateChanged", this.handleStateChanged)
    events.on("sessionChanged", this.handleSessionChanged)
    events.on("sessionDeleted", this.handleSessionDeleted)
    this.scheduleLeaseRenewal()
    this.scheduleSummary()
  }

  async stop(): Promise<void> {
    if (!this.started) return
    this.started = false
    const events = this.terminal.events
    events.off("data", this.handleData)
    events.off("stateChanged", this.handleStateChanged)
    events.off("sessionChanged", this.handleSessionChanged)
    events.off("sessionDeleted", this.handleSessionDeleted)
    this.clearTimerIfSet("flush")
    this.clearTimerIfSet("summary")
    this.clearTimerIfSet("lease")
    for (const attachment of this.registry.all()) {
      this.registry.detach(attachment.mobileClientInstanceId, attachment.sessionId)
    }
    this.bytesByClient.clear()
    this.lastLineCache.clear()
    this.lastLineDirty.clear()
    this.lastSummaryContent = ""
  }

  /** Called by the live connection when a phone sends an intent. */
  async handleIntent(mobileClientInstanceId: string, intent: MobileIntent): Promise<void> {
    if (!this.started) {
      this.sendIntentResult(mobileClientInstanceId, {
        intentId: intent.intentId,
        outcome: "rejected",
        code: "gateway_unavailable",
        message: "终端服务当前不可用。",
      })
      return
    }
    this.lastActivityByClient.set(mobileClientInstanceId, this.nowMs())
    const result = await this.executor.execute(mobileClientInstanceId, intent)
    this.sendIntentResult(mobileClientInstanceId, result)
  }

  /** Called when a phone's connection drops, so its leases are not held by nobody. */
  async releaseClient(mobileClientInstanceId: string): Promise<void> {
    for (const attachment of this.registry.detachClient(mobileClientInstanceId)) {
      await this.releaseAttachmentLease(attachment)
    }
    // A phone that left stops deciding the grid. Its claim goes with it; the size
    // stays until the desktop's own layout decides otherwise.
    this.terminal.releaseSizeOwnershipForClient(mobileClientInstanceId)
    this.executor.forgetClient(mobileClientInstanceId)
    this.bytesByClient.delete(mobileClientInstanceId)
    this.scheduleSummary()
  }

  getState(): MobileGatewayState {
    return {
      started: this.started,
      transportAttached: this.transport !== null,
      clients: this.registry.clientCount(),
      attachments: this.registry.all().length,
      lastSummaryRevision: this.summaryRevision,
    }
  }

  /* ------------------------------------------------------------------ *
   * Terminal events
   * ------------------------------------------------------------------ */

  /**
   * Every handler is wrapped: these run inside the PTY's data callback, and an
   * exception here would propagate into the terminal service itself.
   */
  private readonly handleData = (payload: { readonly sessionId: string }): void => {
    try {
      this.lastLineDirty.add(payload.sessionId)
      this.markDirty(payload.sessionId)
    } catch (error) {
      this.logWarn("Mobile gateway data handler failed.", error)
    }
  }

  private readonly handleStateChanged = (payload: {
    readonly sessionId: string
    readonly changeTypes: readonly string[]
  }): void => {
    try {
      this.lastLineDirty.add(payload.sessionId)
      this.markDirty(payload.sessionId)
      if (payload.changeTypes.some((type) => type.startsWith("lease."))) {
        this.recheckLeases(payload.sessionId)
      }
      this.scheduleSummary()
    } catch (error) {
      this.logWarn("Mobile gateway state handler failed.", error)
    }
  }

  private readonly handleSessionChanged = (): void => {
    try {
      this.scheduleSummary()
    } catch (error) {
      this.logWarn("Mobile gateway session handler failed.", error)
    }
  }

  private readonly handleSessionDeleted = (payload: { readonly sessionId: string }): void => {
    try {
      this.lastLineCache.delete(payload.sessionId)
      this.lastLineDirty.delete(payload.sessionId)
      for (const attachment of this.registry.detachSession(payload.sessionId)) {
        attachment.leaseId = null
        attachment.leaseExpiresAtMs = 0
      }
      this.scheduleSummary()
    } catch (error) {
      this.logWarn("Mobile gateway delete handler failed.", error)
    }
  }

  /**
   * The desktop typing preempts the phone's lease by design (`user_takeover` in
   * the terminal service). Rather than guessing from the change type, ask the
   * service who owns the lease — that answer is authoritative.
   */
  private recheckLeases(sessionId: string): void {
    for (const attachment of this.registry.forSession(sessionId)) {
      const controller = this.controllerFor(attachment)
      try {
        const state = this.terminal.getSessionState(sessionId, controller)
        if (state.lease.occupied && !state.lease.own) {
          attachment.leaseId = null
          attachment.leaseExpiresAtMs = 0
          attachment.leasePreempted = true
        }
      } catch {
        // The session is gone; the delete handler cleans up.
      }
    }
  }

  /* ------------------------------------------------------------------ *
   * Frame flushing
   * ------------------------------------------------------------------ */

  private markDirty(sessionId: string): void {
    const attachments = this.registry.forSession(sessionId)
    if (attachments.length === 0) return
    for (const attachment of attachments) attachment.dirty = true
    this.scheduleFlush()
  }

  private scheduleFlush(): void {
    if (this.flushTimer || !this.started) return
    this.flushTimer = this.setTimer(() => {
      this.flushTimer = null
      void this.flush()
    }, FLUSH_INTERVAL_MS)
  }

  private async flush(): Promise<void> {
    const transport = this.transport
    if (!transport) return
    for (const attachment of this.registry.all()) {
      if (!attachment.dirty) continue
      attachment.dirty = false
      try {
        await this.flushAttachment(attachment)
      } catch (error) {
        this.logWarn("Mobile frame flush failed.", error, { sessionId: attachment.sessionId })
      }
    }
  }

  private async flushAttachment(attachment: MobileAttachment): Promise<void> {
    const transport = this.transport
    if (!transport) return
    const window = await this.terminal.readLineWindow({
      sessionId: attachment.sessionId,
      maxLines: this.lineWindowLines,
    })
    // Anchor before the first push so gateway indices and emulator indices share
    // an origin; history paging needs to be able to name lines older than the window.
    if (!attachment.anchored) {
      attachment.tracker.anchorAt(window.startIndex)
      attachment.anchored = true
    }
    attachment.emulatorWindowStart = window.startIndex
    attachment.lastSeq = window.throughOutputSeq
    attachment.lastSizeRevision = window.sizeRevision
    const update = attachment.tracker.push(window.lines)
    const mustSnapshot = attachment.needsSnapshot
    if (!update && !mustSnapshot) return

    const content = mustSnapshot ? attachment.tracker.snapshot() : update!
    attachment.needsSnapshot = false

    const frames = buildTerminalFrames({
      sessionId: attachment.sessionId,
      kind: mustSnapshot ? "reset" : "suffix",
      from: content.from,
      lines: content.lines,
      total: content.total,
      cursor: {
        // The emulator reports a row relative to the window it returned, so the
        // base has to be that window's first line in gateway space.
        //
        // `content.from` is not that line. It is the first line the update
        // *changed*, which sits later than the window's start whenever the head of
        // the window is unchanged — the ordinary case. Adding it pushed the cursor
        // down by however much of the window had not changed, which is why it was
        // only sometimes in the wrong place. `oldestIndex` is the window's first
        // line, the same correspondence line 425 already relies on.
        row: attachment.tracker.oldestIndex + window.cursor.row,
        col: window.cursor.col,
        visible: window.cursor.visible,
      },
      alt: window.alt,
      truncated: content.truncated,
      seq: window.throughOutputSeq,
      sizeRevision: window.sizeRevision,
    })

    // A snapshot is the recovery path, so it always goes out. Ordinary updates are
    // subject to the uplink budget: past it, the update is dropped and the next
    // flush sends a fresh window instead of queueing frames the phone will never
    // catch up on. On a metered link the latest screen always beats a full history.
    if (!mustSnapshot && !this.consumeBudget(attachment.mobileClientInstanceId, frames)) {
      attachment.needsSnapshot = true
      return
    }
    for (const frame of frames) {
      transport.sendFrame(attachment.mobileClientInstanceId, frame)
    }
  }

  /** Sends one full window immediately, for attach and for post-reconnect resync. */
  private async pushSnapshot(attachment: MobileAttachment): Promise<void> {
    const window = await this.terminal.readLineWindow({
      sessionId: attachment.sessionId,
      maxLines: this.lineWindowLines,
    })
    if (!attachment.anchored) {
      attachment.tracker.anchorAt(window.startIndex)
      attachment.anchored = true
    }
    attachment.emulatorWindowStart = window.startIndex
    attachment.lastSeq = window.throughOutputSeq
    attachment.lastSizeRevision = window.sizeRevision
    attachment.tracker.push(window.lines)
    const snapshot = attachment.tracker.snapshot()
    attachment.needsSnapshot = false
    attachment.dirty = false
    const frames = buildTerminalFrames({
      sessionId: attachment.sessionId,
      kind: "reset",
      from: snapshot.from,
      lines: snapshot.lines,
      total: snapshot.total,
      cursor: {
        row: snapshot.from + window.cursor.row,
        col: window.cursor.col,
        visible: window.cursor.visible,
      },
      alt: window.alt,
      truncated: false,
      seq: window.throughOutputSeq,
      sizeRevision: window.sizeRevision,
    })
    this.consumeBudget(attachment.mobileClientInstanceId, frames)
    for (const frame of frames) {
      this.transport?.sendFrame(attachment.mobileClientInstanceId, frame)
    }
  }

  /**
   * Serves one page of scrollback below what the phone already has.
   *
   * `before` is the client's oldest gateway index. The reply is a `history` frame
   * covering exactly `[from, from + lines.length)`; an empty one means the desktop
   * has nothing older, which is the honest answer once the emulator's ring has
   * evicted it — the line is gone here too, not merely unsent.
   */
  async sendHistory(attachment: MobileAttachment, before: number, limit: number): Promise<void> {
    const transport = this.transport
    if (!transport) return
    const requested = Math.max(1, Math.min(limit, MOBILE_FRAME_LIMITS.maxHistoryLines))
    // The client's oldest line, expressed in the emulator's own index space.
    const emulatorOfBefore = before - attachment.tracker.oldestIndex + attachment.emulatorWindowStart
    // Clamped by `before` as well as by what the emulator holds: a page may not
    // reach below gateway index 0. That index is not expressible on the wire, and
    // the server answers a malformed frame by closing the desktop's connection.
    const count = Math.min(requested, emulatorOfBefore, before)
    if (count <= 0) {
      this.emitHistoryFrame(attachment, before, [])
      return
    }
    const range = await this.terminal.readLineRange({
      sessionId: attachment.sessionId,
      from: emulatorOfBefore - count,
      maxLines: count,
    })
    if (range.lines.length === 0) {
      this.emitHistoryFrame(attachment, before, [])
      return
    }
    this.emitHistoryFrame(attachment, before - range.lines.length, range.lines)
  }

  private emitHistoryFrame(
    attachment: MobileAttachment,
    from: number,
    lines: readonly TerminalStyledLine[],
  ): void {
    const transport = this.transport
    if (!transport) return
    const frames = buildTerminalFrames({
      sessionId: attachment.sessionId,
      kind: "history",
      from,
      lines,
      total: attachment.tracker.snapshot().total,
      // History does not move the cursor, and the client ignores it here.
      cursor: { row: 0, col: 0, visible: false },
      alt: false,
      truncated: false,
      seq: attachment.lastSeq,
      sizeRevision: attachment.lastSizeRevision,
    })
    for (const frame of frames) {
      transport.sendFrame(attachment.mobileClientInstanceId, frame)
    }
  }

  private consumeBudget(
    mobileClientInstanceId: string,
    frames: readonly MobileTerminalFrame[],
  ): boolean {
    const nowMs = this.nowMs()
    let entry = this.bytesByClient.get(mobileClientInstanceId)
    if (!entry || nowMs - entry.windowStartedMs >= 1_000) {
      entry = { windowStartedMs: nowMs, bytes: 0 }
      this.bytesByClient.set(mobileClientInstanceId, entry)
    }
    let bytes = 0
    for (const frame of frames) bytes += Buffer.byteLength(JSON.stringify(frame), "utf8")
    const withinBudget = entry.bytes + bytes <= MOBILE_FRAME_LIMITS.maxBytesPerSecond
    entry.bytes += bytes
    return withinBudget
  }

  /* ------------------------------------------------------------------ *
   * Summary
   * ------------------------------------------------------------------ */

  private scheduleSummary(): void {
    if (this.summaryTimer || !this.started) return
    this.summaryTimer = this.setTimer(() => {
      this.summaryTimer = null
      void this.flushSummary()
    }, SUMMARY_INTERVAL_MS)
  }

  /**
   * Sends the list again even if nothing about it has changed.
   *
   * `flushSummary` compares against what was last sent, which is what keeps an idle
   * desktop from producing traffic at all — but "last sent" is only meaningful to a
   * listener that was there to receive it. A phone that has just connected has
   * received nothing, and the summary it needed may have gone to a *previous* cloud
   * process: when the relay restarts, its cache of the last summary per desktop goes
   * with it. Deduplicating against a send nobody can still read leaves every phone
   * on an empty list until a terminal happens to print something.
   *
   * So an explicit ask — the `sync` a phone sends whenever it connects — clears the
   * comparison first. The routine, event-driven path keeps the deduplication.
   */
  private resendSummary(): void {
    this.lastSummaryContent = ""
    this.scheduleSummary()
  }

  private async flushSummary(): Promise<void> {
    const transport = this.transport
    if (!transport) return
    try {
      const sessions = await this.summarySessions()
      const content = this.fitSummaryToBudget({
        groups: this.summaryGroups(),
        workspaces: this.summaryWorkspaces(sessions),
        sessions,
      })
      if (!content) return
      // Compared without the revision so an idle desktop produces no traffic at all.
      // `workspaces` is absent rather than empty in the common case, and JSON drops
      // absent keys, so an unsplit desktop fingerprints exactly as it always did.
      const serialized = JSON.stringify(content)
      if (serialized === this.lastSummaryContent) return
      this.lastSummaryContent = serialized
      this.summaryRevision += 1
      transport.sendSummary({ revision: this.summaryRevision, ...content })
    } catch (error) {
      this.logWarn("Mobile summary flush failed.", error)
    }
  }

  /**
   * Shrinks a summary to fit `maxSummaryBytes`, never dropping a conversation.
   *
   * The field bounds should already keep this unreachable for any desktop the product
   * can produce, and the boundary test in the shared package shows the largest
   * admissible session list on its own fits. It exists because the failure it prevents
   * is invisible: an oversized summary is answered by the socket closing, so the user
   * sees their computer go offline with nothing in the list to point at.
   *
   * The tab layer is sacrificed first because losing it degrades to precisely the flat
   * list the phone rendered before the layer existed — whereas dropping sessions would
   * make terminals disappear, and sending an oversized payload would take the whole
   * connection with it. If even that does not fit, the summary is not sent and the
   * phone keeps the list it already has.
   */
  private fitSummaryToBudget(content: MobileSummaryContent): MobileSummaryContent | null {
    if (summaryBytes(content) <= MOBILE_FRAME_LIMITS.maxSummaryBytes) return content
    const withoutTabs: MobileSummaryContent = { groups: content.groups, sessions: content.sessions }
    const bytes = summaryBytes(withoutTabs)
    if (bytes <= MOBILE_FRAME_LIMITS.maxSummaryBytes) return withoutTabs
    this.deps.logger.warn("Mobile summary exceeded its byte budget and was not sent.", {
      bytes,
      budget: MOBILE_FRAME_LIMITS.maxSummaryBytes,
    })
    return null
  }

  /**
   * The tab layer, or `undefined` when it would say nothing.
   *
   * A conversation gets its own tab unless the user splits it, so a desktop with no
   * splits has exactly one pane per tab — the flat session list already says that, and
   * restating it would cost bytes on every summary. The layer appears when a tab holds
   * a second pane, which is also when a phone gains something the flat list could not
   * tell it, and disappears again when the last split closes.
   *
   * Panes are filtered against the sessions this summary actually carries, so a phone
   * is never handed a pane naming a conversation absent from the same payload. A tab
   * left with fewer than two panes by that filter is dropped with it, since a one-pane
   * tab is once again the flat case.
   *
   * Ordering: panes come in the tab's own layout order, so dragging one to a new
   * position changes this array and therefore the content fingerprint. The desktop
   * emits nothing for a layout-only change, though — `movePane` bumps the terminal
   * domain revision and nothing more — and this gateway deliberately subscribes to no
   * more events than the four it has (`start()` documents why: the emitter is at
   * Node's default listener cap). A reorder therefore reaches the phone with the next
   * summary that anything else happens to trigger, and waits if it was the last thing
   * to happen. That gap is accepted on purpose: this layer answers *which conversations
   * share a tab*, and that answer is set by splitting and closing, both of which do
   * emit. Closing it would cost an eleventh listener plus a standing timer, for the
   * cosmetic order within a tab alone.
   */
  private summaryWorkspaces(
    sessions: readonly MobileSummarySession[],
  ): readonly MobileSummaryWorkspace[] | undefined {
    const present = new Set(sessions.map((session) => session.id))
    const tabs: MobileSummaryWorkspace[] = []
    for (const workspace of this.terminal.listWorkspaces()) {
      const panes = collectTerminalPaneLeaves(workspace.layout)
        .filter((pane) => present.has(pane.sessionId))
        .map((pane) => ({
          paneId: clampSummaryText(pane.paneId, MOBILE_FRAME_LIMITS.maxSummaryIdLength),
          sessionId: clampSummaryText(pane.sessionId, MOBILE_FRAME_LIMITS.maxSummaryIdLength),
        }))
      if (panes.length < 2) continue
      tabs.push({
        id: clampSummaryText(workspace.id, MOBILE_FRAME_LIMITS.maxSummaryIdLength),
        groupId: clampSummaryText(workspace.groupId, MOBILE_FRAME_LIMITS.maxSummaryIdLength),
        title: clampSummaryText(workspace.title, MOBILE_FRAME_LIMITS.maxTitleLength),
        panes,
      })
    }
    return tabs.length > 0 ? tabs : undefined
  }

  private summaryGroups(): MobileSummaryGroup[] {
    return this.terminal.listGroups().map((group) => ({
      id: clampSummaryText(group.id, MOBILE_FRAME_LIMITS.maxSummaryIdLength),
      name: clampSummaryText(group.name, MOBILE_FRAME_LIMITS.maxSummaryGroupNameLength),
    }))
  }

  private async summarySessions(): Promise<MobileSummarySession[]> {
    const sessions = this.terminal.listSessions()
    const rows: MobileSummarySession[] = []
    for (const session of sessions) {
      rows.push({
        id: clampSummaryText(session.id, MOBILE_FRAME_LIMITS.maxSummaryIdLength),
        groupId: clampSummaryText(session.groupId, MOBILE_FRAME_LIMITS.maxSummaryIdLength),
        title: clampSummaryText(session.title, MOBILE_FRAME_LIMITS.maxTitleLength),
        status: session.status,
        attention: { state: session.attention.state, kind: session.attention.kind },
        cwd: clampSummaryText(session.cwd, MOBILE_FRAME_LIMITS.maxSummaryCwdLength),
        cols: session.cols,
        rows: session.rows,
        startedAt: clampSummaryText(session.startedAt, MOBILE_FRAME_LIMITS.maxSummaryStartedAtLength),
        lastLine: clampSummaryText(await this.lastLineFor(session.id), MOBILE_FRAME_LIMITS.maxSummaryLastLineLength),
        lastOutputSeq: session.lastOutputSeq,
        // Named only when a phone holds it, which is how a phone that has been
        // preempted — by the desktop's own handler or by another device — stops
        // believing its grid claim still stands.
        //
        // Omitted rather than clamped if the id does not fit, unlike every other
        // field here. They are display strings, where a truncated one still reads;
        // this one is compared for identity, so a truncated id names no phone at
        // all — and could name a different one. Absence is the honest answer.
        ...(ownerIdForSummary(session) ?? {}),
      })
    }
    return rows
  }

  /**
   * The last line is the most useful thing in a session row, so it is refreshed
   * only for sessions that actually produced output, and only at summary rate.
   *
   * It also becomes the body of a phone notification, which is why decorative
   * lines are skipped: the bottom of a pending permission prompt is a box-drawing
   * border, and "╰──────╯" tells the user nothing.
   */
  private async lastLineFor(sessionId: string): Promise<string> {
    const known = this.lastLineCache.get(sessionId)
    if (known !== undefined && !this.lastLineDirty.has(sessionId)) return known
    this.lastLineDirty.delete(sessionId)
    try {
      const window = await this.terminal.readLineWindow({
        sessionId,
        maxLines: SUMMARY_TAIL_LINES,
      })
      for (let index = window.lines.length - 1; index >= 0; index -= 1) {
        const text = window.lines[index].text.trim()
        if (text && isMeaningfulLine(text)) {
          this.lastLineCache.set(sessionId, text)
          return text
        }
      }
      this.lastLineCache.set(sessionId, "")
      return ""
    } catch {
      return known ?? ""
    }
  }

  /* ------------------------------------------------------------------ *
   * Leases
   * ------------------------------------------------------------------ */

  private scheduleLeaseRenewal(): void {
    if (this.leaseTimer || !this.started) return
    this.leaseTimer = this.setTimer(() => {
      this.leaseTimer = null
      void this.executor.renewLeases()
        .then(() => this.expireIdleClients())
        .catch((error) => this.logWarn("Mobile lease renewal failed.", error))
        .finally(() => this.scheduleLeaseRenewal())
    }, LEASE_RENEW_INTERVAL_MS)
  }

  private async expireIdleClients(): Promise<void> {
    const nowMs = this.nowMs()
    for (const [mobileClientInstanceId, lastAtMs] of [...this.lastActivityByClient]) {
      const idleMs = nowMs - lastAtMs
      // Checked first, and on its own shorter clock: a phone that vanished mid-use
      // should stop deciding the grid long before the gateway forgets it entirely.
      if (idleMs >= SIZE_OWNERSHIP_IDLE_TIMEOUT_MS) {
        this.terminal.releaseSizeOwnershipForClient(mobileClientInstanceId)
      }
      if (idleMs < CLIENT_IDLE_TIMEOUT_MS) continue
      for (const attachment of this.registry.detachClient(mobileClientInstanceId)) {
        await this.releaseAttachmentLease(attachment)
      }
      this.lastActivityByClient.delete(mobileClientInstanceId)
      this.bytesByClient.delete(mobileClientInstanceId)
      this.deps.logger.info("Mobile client expired while idle.", { mobileClientInstanceId })
    }
  }

  private async releaseAttachmentLease(attachment: MobileAttachment): Promise<void> {
    const leaseId = attachment.leaseId
    attachment.leaseId = null
    attachment.leaseExpiresAtMs = 0
    if (!leaseId) return
    try {
      this.terminal.releaseControl(
        { sessionId: attachment.sessionId, leaseId },
        this.controllerFor(attachment),
      )
    } catch {
      // Already expired or taken over; nothing to recover.
    }
  }

  private controllerFor(attachment: MobileAttachment) {
    return {
      clientId: `mobile:${attachment.mobileClientInstanceId}`,
      controllerInstanceId: `mobile:${attachment.mobileClientInstanceId}:${attachment.sessionId}`,
      actorKind: "agent" as const,
    }
  }

  /* ------------------------------------------------------------------ *
   * Authorization and audit
   * ------------------------------------------------------------------ */

  private async authorize(
    action: PermissionAction,
    resource: string,
    context: Record<string, unknown> = {},
  ): Promise<void> {
    let allowed = false
    try {
      const result = await this.deps.permissionGuard.check({
        action,
        actor: MOBILE_GATEWAY_ACTOR,
        resource,
        context,
      })
      allowed = result.allowed
    } catch (error) {
      this.recordAudit(action, resource, "failed")
      throw new MobileIntentError("permission_check_failed", "权限检查没有完成。")
    }
    this.recordAudit(action, resource, allowed ? "allowed" : "denied")
    if (!allowed) {
      throw new MobileIntentError("permission_denied", "本地策略拒绝了这个操作。")
    }
  }

  private recordAudit(
    action: PermissionAction,
    resource: string,
    outcome: "allowed" | "denied" | "failed",
  ): void {
    try {
      this.deps.auditSink.record({
        action,
        actor: MOBILE_GATEWAY_ACTOR,
        resource,
        outcome,
        metadata: { source: "core.mobile-gateway" },
      })
    } catch (error) {
      // Auditing must never take down the operation it is recording.
      this.logWarn("Mobile gateway audit failed.", error)
    }
  }

  /* ------------------------------------------------------------------ *
   * Plumbing
   * ------------------------------------------------------------------ */

  private sendIntentResult(mobileClientInstanceId: string, result: MobileIntentResult): void {
    const transport = this.transport
    if (!transport) return
    transport.sendIntentResult(mobileClientInstanceId, result)
  }

  private nowMs(): number {
    return (this.deps.now?.() ?? new Date()).getTime()
  }

  private clearTimerIfSet(kind: "flush" | "summary" | "lease"): void {
    const handle = kind === "flush" ? this.flushTimer : kind === "summary" ? this.summaryTimer : this.leaseTimer
    if (!handle) return
    this.clearTimer(handle)
    if (kind === "flush") this.flushTimer = null
    else if (kind === "summary") this.summaryTimer = null
    else this.leaseTimer = null
  }

  private logWarn(message: string, error: unknown, extra: Record<string, unknown> = {}): void {
    this.deps.logger.warn(message, {
      ...extra,
      errorName: error instanceof Error ? error.name : typeof error,
      code: error instanceof MobileIntentError ? error.code : undefined,
    })
  }
}

export function createMobileGatewayService(deps: MobileGatewayServiceDeps): MobileGatewayService {
  return new MobileGatewayService(deps)
}

/** One summary's content, before the revision the transport assigns at send time. */
type MobileSummaryContent = {
  readonly groups: readonly MobileSummaryGroup[]
  readonly workspaces?: readonly MobileSummaryWorkspace[]
  readonly sessions: readonly MobileSummarySession[]
}

/** What the socket will have to carry, measured the same way the budget is stated. */
function summaryBytes(content: MobileSummaryContent): number {
  return Buffer.byteLength(JSON.stringify(content), "utf8")
}

/**
 * The grid owner to name for one session, as a field to spread, or nothing.
 *
 * Spread-shaped so the absent case adds no key at all: most sessions are the
 * desktop's own, and a summary that carried `gridOwnerId: undefined` for every one
 * of them would cost the byte budget a field it does not need. See the call site
 * for why an id too long to send is left out rather than clipped.
 */
function ownerIdForSummary(session: {
  readonly sizeOwner?: { readonly kind: string; readonly mobileClientInstanceId: string }
}): { readonly gridOwnerId: string } | null {
  const owner = session.sizeOwner
  if (owner?.kind !== "mobile") return null
  const id = owner.mobileClientInstanceId
  return id.length > 0 && id.length <= MOBILE_FRAME_LIMITS.maxSummaryGridOwnerIdLength
    ? { gridOwnerId: id }
    : null
}

/**
 * Trims one summary field to its wire bound.
 *
 * These bounds are the shared package's contract rather than a local preference:
 * the relay validates against the same numbers, and a summary that fails validation
 * is answered with a closed connection instead of a dropped message. Clamping here
 * is what makes the summary's byte budget provable rather than hopeful, since a
 * session title and a working directory are otherwise unbounded.
 */
export function clampSummaryText(value: string, maxLength: number): string {
  if (value.length <= maxLength) return value
  const clipped = value.slice(0, maxLength)
  // Never leave half a surrogate pair behind; JSON.stringify would escape it and
  // the phone would render a replacement character.
  return /[\uD800-\uDBFF]$/.test(clipped) ? clipped.slice(0, -1) : clipped
}

/**
 * Rejects box-drawing borders and block/rule glyphs, which are how TUIs frame
 * themselves and carry no information on their own.
 */
const DECORATION_PATTERN = /^[\s─-╿▀-▟■-◿‐-―_=~\-—–]+$/u

export function isMeaningfulLine(text: string): boolean {
  return !DECORATION_PATTERN.test(text)
}
