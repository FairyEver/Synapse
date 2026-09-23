import { MOBILE_FRAME_LIMITS } from "@synapse/shared/mobile-live-constants"
import type {
  MobileGitStatus,
  MobileGroupCommand,
  MobileGroupCommandsEntry,
  MobileIntent,
  MobileIntentResult,
  MobileModelTier,
  MobileQuickPhrase,
  MobileToolbarButton,
  MobileSummaryAgentGroup,
  MobileSummaryAgentProvider,
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
import type { ClipboardSyncEntry } from "./clipboard-sync-service"
import type { TerminalGitService } from "./terminal-git/terminal-git-service"
import type { TerminalGitSnapshot } from "./terminal-git/terminal-git-types"
import type { MobileAttachment } from "./mobile-gateway/attachment-registry"
import { AttachmentRegistry } from "./mobile-gateway/attachment-registry"
import { MOBILE_GATEWAY_ACTOR } from "./mobile-gateway/controller"
import type { MobileFileRelay } from "./mobile-gateway/file-relay"
import { buildSnapshotFrames, buildTerminalFrames } from "./mobile-gateway/frame-builder"
import type { ClaudeCodeConversationLaunch, MobileGatewayLogger } from "./mobile-gateway/intent-executor"
import { createMobileGitIntentRunner, type MobileGitIntentRunner } from "./mobile-gateway/git-intent"
import { MobileIntentError, MobileIntentExecutor } from "./mobile-gateway/intent-executor"
import type { MobileGatewayTransport } from "./mobile-gateway/transport"

export type { MobileGatewayTransport, MobileSummaryDraft } from "./mobile-gateway/transport"

/**
 * What one read of a terminal's visible tail returns.
 *
 * Taken from the service rather than declared again, so a change to the window's
 * shape cannot leave this file describing a window that no longer exists.
 */
type TerminalLineWindow = Awaited<ReturnType<TerminalService["readLineWindow"]>>

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

/**
 * How long a read of the project and Provider directories is reused.
 *
 * Those two lists come out of the user's stored configuration, and reading them costs
 * a sanitize-and-clone of the whole config plus a project listing — roughly a thousand
 * times more work than everything else a summary tick does, for data that changes only
 * when the user renames a project or edits a Provider. The summary runs at 1 Hz for as
 * long as *any* terminal is printing, whether or not a phone is listening, so loading
 * them every tick is a permanent background cost for a list nobody is changing.
 *
 * Fifteen seconds is the bound on how stale a change can be on a phone: a directory
 * edited while a phone is already connected and idle reaches it within one tick of the
 * cache expiring. The common case is fresher than that — a phone sends `sync` as it
 * connects, which clears the cache outright (see `resendSummary`), so a rename made
 * before the phone was picked up is on its first screen.
 */
export const MOBILE_AGENT_DIRECTORY_CACHE_MS = 15_000

/**
 * Slack for the fields a toolbar payload carries besides its buttons.
 *
 * The gateway builds a draft and the live connection appends the computer's identity
 * and wraps it in an envelope, so the bytes measured here are not quite the bytes
 * sent. A kilobyte is far more than those cost and far less than the gap between this
 * budget and the socket underneath it — see `maxToolbarBytes`.
 */
const TOOLBAR_ENVELOPE_ALLOWANCE_BYTES = 1_024

/** 同 `TOOLBAR_ENVELOPE_ALLOWANCE_BYTES`：给信封与字段名留的余量。 */
const GROUP_COMMANDS_ENVELOPE_ALLOWANCE_BYTES = 1_024

/** The same slack, on the same terms, for the 快捷输入 payload. */
const QUICK_PHRASES_ENVELOPE_ALLOWANCE_BYTES = 1_024

/** The same slack, on the same terms, for the clipboard payload. */
const CLIPBOARD_ENVELOPE_ALLOWANCE_BYTES = 1_024

/**
 * Lines read per step when hunting for the line a session row shows.
 *
 * The bottom of a full-screen program is furniture: Claude Code spends its last
 * rows on the input box and the hint under it, so a tail of a few lines can be
 * nothing but borders.
 */
const SUMMARY_LAST_LINE_STEP_LINES = 24

/**
 * How far up that hunt may go before it gives up.
 *
 * Past a few screens a line is history rather than "now", and the row claims to
 * say what the terminal is doing right now. It is also what bounds the work: a
 * program that prints nothing but rules must not make every summary tick walk the
 * whole 5,000-line scrollback.
 */
const SUMMARY_LAST_LINE_SCAN_LIMIT_LINES = 240

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
  /**
   * 按终端当前目录跑 git 的那一层。
   *
   * 只认路径：它不认识「代码仓库」注册表，也不产生那本账上的条目。手机端看到的
   * Git 是「这个目录恰好是个 Git 仓库」，不是「用户添加过的仓库」。
   */
  readonly terminalGit: TerminalGitService
  readonly fileRelay: MobileFileRelay
  readonly permissionGuard: PermissionGuard
  readonly auditSink: AuditSink
  readonly logger: MobileGatewayLogger
  /**
   * Starts the bundled Claude Code for a phone that asked for one.
   *
   * Supplied by the bootstrap rather than imported here: the launcher lives in the
   * agent module, and this service has no other reason to depend on it. See
   * `IntentExecutorDeps.createClaudeCodeConversation`.
   */
  readonly createClaudeCodeConversation: (
    input: ClaudeCodeConversationLaunch,
  ) => Promise<{ readonly id: string }>
  /**
   * The desktop's own project directory — the same list the sidebar's 新建 offers.
   *
   * A phone's new-conversation panel is drawn from this, so it is the desktop's answer
   * to "which projects exist" and not a second one. Injected rather than reached for,
   * for the reason the launcher is: the agent capability owns that list.
   */
  readonly listAgentConversationGroups: () => Promise<readonly MobileGatewayAgentGroup[]>
  /**
   * Every Provider a conversation may be started with, already reduced to what a phone
   * may know. The reduction happens on the far side of this call, where the provider
   * record is — nothing with an endpoint or a credential in it crosses over.
   */
  readonly listAgentConversationProviders: () => Promise<readonly MobileGatewayAgentProvider[]>
  /**
   * The sentences the user keeps in the desktop's own 快捷输入 app.
   *
   * Injected rather than reached for, like the two lists above: the quick-input App
   * owns that data, and this service has no other reason to depend on it. Read-only
   * on purpose — a phone taps a sentence into its composer and sends what it likes;
   * nothing writes back to the computer's table from here.
   */
  readonly listQuickPhrases: () => Promise<readonly MobileQuickPhrase[]>
  /**
   * The text this computer has copied recently, newest first.
   *
   * Injected rather than reached for, like the three lists above. Unlike them this
   * one is a snapshot of the collector's in-memory ring rather than a read of
   * something stored, which is exactly why it is passed as a function: the ring
   * changes under this service, and holding a copy here would be a second, staler
   * answer to "what has this computer copied".
   */
  readonly listClipboard: () => Promise<readonly ClipboardSyncEntry[]>
  readonly now?: () => Date
  readonly setTimeout?: (callback: () => void, delayMs: number) => NodeJS.Timeout
  readonly clearTimeout?: (handle: NodeJS.Timeout) => void
  readonly lineWindowLines?: number
}

/**
 * One project a phone may start a conversation in, as the desktop's sidebar sees it.
 *
 * Deliberately not the capability's own type: this is the wire shape's input, and the
 * two agreeing structurally is what lets the bootstrap pass one to the other without
 * either module importing the other.
 */
export type MobileGatewayAgentGroup = {
  readonly projectId: string
  readonly name: string
  readonly isDefault: boolean
}

/**
 * One Provider a phone may start a conversation with.
 *
 * There is no `baseUrl` and no credential field here, and there is no version of the
 * provider record in which one could arrive: the field list is fixed at the point the
 * value is built, on the other side of the injection.
 */
export type MobileGatewayAgentProvider = {
  readonly id: string
  readonly name: string
  readonly isDefault: boolean
  readonly defaultTier: MobileModelTier
  readonly models: Partial<Record<MobileModelTier, string>>
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
  private readonly gitIntent: MobileGitIntentRunner
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
  /**
   * The last directory read, with the time it was taken; `null` means "read now".
   *
   * Held separately from `lastSummaryContent` because the two answer different
   * questions: the fingerprint says whether the payload changed, this says whether it
   * is worth looking at the configuration again. See `MOBILE_AGENT_DIRECTORY_CACHE_MS`
   * for the bound and `resendSummary` for the one caller that overrides it.
   */
  private agentGroupsCache:
    { readonly readAtMs: number; readonly groups: readonly MobileSummaryAgentGroup[] } | null = null
  private agentProvidersCache:
    { readonly readAtMs: number; readonly providers: readonly MobileSummaryAgentProvider[] } | null = null
  /**
   * Fingerprint of the last toolbar sent, kept apart from the summary's.
   *
   * Separate on purpose: the two change on entirely different occasions — the session
   * list churns constantly, the button list only when the user edits it — so sharing
   * one fingerprint would make every terminal that printed a line look like a reason
   * to re-send the buttons.
   */
  private toolbarRevision = 0
  private lastToolbarContent = ""
  /**
   * 分组命令列表的指纹，与上面那个分开。
   *
   * 分开的理由是它们的**变更时机**不同：按钮只在用户改工具栏时变，而这一份只在用户
   * 改分组命令时变，两者互不相干。共用一个指纹会让任何一次工具栏编辑顺带重发一遍
   * 分组命令，反之亦然。
   */
  private groupCommandsRevision = 0
  private lastGroupCommandsContent = ""
  /**
   * Fingerprint of the last 快捷输入 list sent, kept apart from both of the above.
   *
   * The third occasion in its own right: the sentences change when the user edits
   * the quick-input app, which is neither a terminal event nor a command edit. A
   * shared fingerprint would re-send every one of them whenever anything else moved.
   */
  private quickPhrasesRevision = 0
  private lastQuickPhrasesContent = ""
  /**
   * Fingerprint of the last clipboard snapshot sent, kept apart from all three above.
   *
   * The fourth occasion in its own right: the clipboard changes when the user copies
   * something, which is none of a terminal event, a command edit or a quick-input
   * edit. This is also the only one whose producer already deduplicates — the
   * collector emits only when the text actually changed — so this fingerprint is a
   * second gate rather than the first, and it is here for the same reason the others
   * are: `resendClipboard` needs a comparison to clear.
   */
  private clipboardRevision = 0
  private lastClipboardContent = ""
  /**
   * 上一次算过的是哪个目录，按「哪台手机 + 哪个会话」记。
   *
   * 就一个目录字符串：它是那道具名昭著的廉价闸门 —— 摘要在有输出时是 1 Hz，
   * 而这一份要跑一次 `git status`，不比目录就等于每秒 spawn 一次 git。
   * 见 `flushGitStatus`，那里写了为什么「再比一次内容」是多余的。
   *
   * 按手机分开记，因为这份状态是点对点发的：两台手机可能停在不同会话上。
   */
  private readonly gitStatusSeen = new Map<string, string>()
  private gitStatusRevision = 0
  private gitStatusFlushing = false
  private gitStatusResendPending = false
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
    this.gitIntent = createMobileGitIntentRunner({
      terminal: deps.terminal,
      terminalGit: deps.terminalGit,
      authorize: (action, resource, context) => this.authorize(action, resource, context),
    })
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
      sendToolbar: () => this.resendToolbar(),
      sendQuickPhrases: () => this.resendQuickPhrases(),
      sendGroupCommands: () => this.resendGroupCommands(),
      sendClipboard: () => this.resendClipboard(),
      pushSnapshot: (attachment, reason) => this.pushSnapshot(attachment, reason),
      sendHistory: (attachment, before, limit) => this.sendHistory(attachment, before, limit),
      reportTransferProgress: (mobileClientInstanceId, intentId, completedBytes, totalBytes) =>
        this.reportTransferProgress(mobileClientInstanceId, intentId, completedBytes, totalBytes),
      createClaudeCodeConversation: (input) => deps.createClaudeCodeConversation(input),
      runGitIntent: (request) => this.gitIntent(request),
      sendGitStatus: (mobileClientInstanceId, sessionId) =>
        this.resendGitStatus(mobileClientInstanceId, sessionId),
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
    this.lastToolbarContent = ""
    this.lastQuickPhrasesContent = ""
    this.lastClipboardContent = ""
    this.gitStatusSeen.clear()
    this.agentGroupsCache = null
    this.agentProvidersCache = null
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
    // One read of a session's window per flush, however many phones are watching it.
    // `readLineWindow` rebuilds up to 500 styled lines, so N attachments on one
    // session used to cost N full rebuilds of the same window in the same tick — the
    // phone count multiplied the most expensive thing this service does. The cache
    // lives exactly as long as the loop: reusing a window across flushes would need a
    // cheap "has the terminal changed since" accessor, and that belongs to the
    // emulator rather than here.
    const windows = new Map<string, Promise<TerminalLineWindow>>()
    for (const attachment of this.registry.all()) {
      if (!attachment.dirty) continue
      attachment.dirty = false
      try {
        await this.flushAttachment(attachment, windows)
      } catch (error) {
        this.logWarn("Mobile frame flush failed.", error, { sessionId: attachment.sessionId })
      }
    }
  }

  /**
   * The shared read. Cached as a promise rather than as a value so that two reads
   * cannot be in flight at once for one session even if a future caller stops
   * awaiting them in sequence.
   */
  private readFlushWindow(
    cache: Map<string, Promise<TerminalLineWindow>>,
    sessionId: string,
  ): Promise<TerminalLineWindow> {
    let window = cache.get(sessionId)
    if (!window) {
      window = this.terminal.readLineWindow({ sessionId, maxLines: this.lineWindowLines })
      cache.set(sessionId, window)
    }
    return window
  }

  private async flushAttachment(
    attachment: MobileAttachment,
    windows: Map<string, Promise<TerminalLineWindow>>,
  ): Promise<void> {
    const transport = this.transport
    if (!transport) return
    const window = await this.readFlushWindow(windows, attachment.sessionId)
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

    const shared = {
      sessionId: attachment.sessionId,
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
      seq: window.throughOutputSeq,
      sizeRevision: window.sizeRevision,
    }
    // A snapshot carries a whole window and has to arrive newest-first, or the
    // phone watches it reassemble itself from the far end. An ordinary update is
    // already in the order it should be read.
    const frames = mustSnapshot
      ? buildSnapshotFrames(shared)
      : buildTerminalFrames({ ...shared, kind: "suffix", truncated: content.truncated })
    // Serialized once, here: the budget is charged these bytes, the log lines report
    // them, and the transport sends these exact strings. See `serializeFrames`.
    const wire = serializeFrames(frames)

    // A snapshot is the recovery path, so it always goes out. Ordinary updates are
    // subject to the uplink budget: past it, the update is dropped and the next
    // flush sends a fresh window instead of queueing frames the phone will never
    // catch up on. On a metered link the latest screen always beats a full history.
    if (!mustSnapshot && !this.consumeBudget(attachment.mobileClientInstanceId, wireBytes(wire))) {
      // The snapshot that replaces this update only exists on the next flush, and
      // flush scheduling rides on `markDirty` — which rides on terminal output. A
      // drop therefore strands the phone whenever the burst it landed on was the
      // session's last: the update is gone, nothing is left to trigger the repair,
      // and the phone keeps that screen for good. Arm the timer here instead, so
      // the recovery owes nothing to output that may never come.
      attachment.needsSnapshot = true
      attachment.dirty = true
      this.scheduleFlush()
      this.deps.logger.warn("Mobile update dropped by the uplink budget; a snapshot replaces it.", {
        sessionId: attachment.sessionId,
        frames: frames.length,
        bytes: wireBytes(wire),
        windowLines: content.lines.length,
      })
      return
    }
    // Frame-level logging is a **decision** log, not a traffic log.
    //
    // Both entries below are the two halves of one causal chain: an update is dropped
    // because the uplink budget is spent, and the next flush replaces it with a whole
    // window. That chain is what a phone sees as an unbounded stream of resets — and
    // until this existed there was nothing in the desktop's log to read it off.
    //
    // The ordinary update path deliberately logs nothing: on a healthy session it runs
    // every 60 ms, and "nothing happened" is the absence of these lines.
    if (mustSnapshot) {
      this.deps.logger.info("Mobile frame flush: full window snapshot.", {
        sessionId: attachment.sessionId,
        frames: frames.length,
        windowLines: content.lines.length,
        bytes: wireBytes(wire),
      })
    }

    for (const frameJson of wire) {
      transport.sendFrame(attachment.mobileClientInstanceId, frameJson)
    }
  }

  /** Sends one full window immediately, for attach and for post-reconnect resync. */
  private async pushSnapshot(
    attachment: MobileAttachment,
    reason: "attach" | "sync",
  ): Promise<void> {
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
    const frames = buildSnapshotFrames({
      sessionId: attachment.sessionId,
      from: snapshot.from,
      lines: snapshot.lines,
      total: snapshot.total,
      cursor: {
        row: snapshot.from + window.cursor.row,
        col: window.cursor.col,
        visible: window.cursor.visible,
      },
      alt: window.alt,
      seq: window.throughOutputSeq,
      sizeRevision: window.sizeRevision,
    })
    const wire = serializeFrames(frames)
    this.consumeBudget(attachment.mobileClientInstanceId, wireBytes(wire))
    // 谁把这一整窗推出去的。手机侧看到的是"又一轮 reset + 十几块 history"，
    // 而这一行是它唯一的解释：attach / sync 各一条通路。
    this.deps.logger.info("Mobile window pushed.", {
      sessionId: attachment.sessionId,
      reason,
      frames: frames.length,
      windowLines: snapshot.lines.length,
      bytes: wireBytes(wire),
    })
    for (const frameJson of wire) {
      this.transport?.sendFrame(attachment.mobileClientInstanceId, frameJson)
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
      // 空页 = 电脑说"没有更早的了"。它与"请求丢了"在手机上长得一样，所以这条也要记。
      this.deps.logger.info("Mobile history page empty.", {
        sessionId: attachment.sessionId,
        before,
        limit,
        windowStart: attachment.tracker.oldestIndex,
      })
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
    this.deps.logger.info("Mobile history page served.", {
      sessionId: attachment.sessionId,
      before,
      limit,
      lines: range.lines.length,
    })
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
    for (const frameJson of serializeFrames(frames)) {
      transport.sendFrame(attachment.mobileClientInstanceId, frameJson)
    }
  }

  private consumeBudget(mobileClientInstanceId: string, bytes: number): boolean {
    const nowMs = this.nowMs()
    let entry = this.bytesByClient.get(mobileClientInstanceId)
    if (!entry || nowMs - entry.windowStartedMs >= 1_000) {
      entry = { windowStartedMs: nowMs, bytes: 0 }
      this.bytesByClient.set(mobileClientInstanceId, entry)
    }
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
    // The one caller that overrides the directory cache's clock. A `sync` comes from a
    // phone that has just connected and is about to draw this list, so it is both the
    // moment a stale project name is most visible and the moment the cost of reading
    // it again buys the most. Everything else — the 1 Hz tick that any printing
    // terminal keeps alive — reuses the read for up to `MOBILE_AGENT_DIRECTORY_CACHE_MS`.
    this.agentGroupsCache = null
    this.agentProvidersCache = null
    this.scheduleSummary()
  }

  /* ------------------------------------------------------------------ *
   * Toolbar
   * ------------------------------------------------------------------ */

  /**
   * Sends the computer's command buttons in the same shape as everything else here:
   * a full snapshot, fingerprinted so an idle desktop produces no traffic.
   *
   * The list only changes when the user edits a command, which is not a terminal
   * event and does not reach this service. Rather than watch for it — which would
   * cost a listener the budget does not have — it is refreshed at the three moments
   * it can be seen: a phone connecting, a phone opening a terminal, and any tick
   * that sends a summary. The gap that leaves is a desktop whose user edits a
   * command while a phone is already connected, idle, and looking at nothing; the
   * phone learns on its next reconnect, terminal, or session activity, and until
   * then it is not on a screen where the difference shows.
   */
  private flushToolbar(): void {
    const transport = this.transport
    if (!transport) return
    try {
      const buttons = this.fitToolbarToBudget(this.terminal.listMobileToolbarButtons())
      // Compared without the revision, so an unchanged list produces nothing at all.
      const serialized = JSON.stringify(buttons)
      if (serialized === this.lastToolbarContent) return
      this.lastToolbarContent = serialized
      this.toolbarRevision += 1
      transport.sendToolbar({ revision: this.toolbarRevision, buttons })
    } catch (error) {
      // A phone without a toolbar is a phone without a toolbar; the terminals it can
      // still drive are the part that matters.
      this.logWarn("Mobile toolbar flush failed.", error)
    }
  }

  /** Sends even when nothing changed, for a caller that has nothing yet. */
  private resendToolbar(): void {
    this.lastToolbarContent = ""
    this.flushToolbar()
  }

  /**
   * Drops trailing buttons until the payload fits `maxToolbarBytes`.
   *
   * The tail goes rather than the last button being cut in half, and that is the
   * whole point of the rule: half a command is a command the phone would run
   * differently from the computer, and a destructive one is exactly the kind a user
   * writes a button for. A button that is not there is merely absent.
   *
   * Unreachable for any list the product can produce — the desktop's own limit is 50
   * actions and a real command is tens of bytes — so this exists for the case where
   * it is not, and prefers losing buttons to losing the connection.
   */
  private fitToolbarToBudget(buttons: readonly MobileToolbarButton[]): readonly MobileToolbarButton[] {
    const budget = MOBILE_FRAME_LIMITS.maxToolbarBytes - TOOLBAR_ENVELOPE_ALLOWANCE_BYTES
    const kept: MobileToolbarButton[] = []
    for (const button of buttons) {
      const candidate = [...kept, button]
      if (Buffer.byteLength(JSON.stringify(candidate), "utf8") > budget) break
      kept.push(button)
    }
    return kept
  }

  /**
   * Sends the group command list in the same shape as everything else here: a full
   * snapshot, fingerprinted so an idle desktop produces no traffic.
   *
   * 骑在摘要那个 1 Hz 的 tick 上，而不是给命令的增删改挂监听器：终端事件发射器已经
   * 到了 Node 的监听器上限，这张名单不许再长（见 `start()` 那条注释）。代价是一秒一次
   * 的字符串比较。
   *
   * 那个 tick **不是常驻的** —— `flushSummary` 结束时不重新武装计时器，
   * `SUMMARY_INTERVAL_MS` 只表示「有终端在打字时 1 Hz」。所以电脑上改完命令之后：有
   * 任何终端正在输出，约一秒内手机就看到；桌面完全空闲，则要等到下一次 `sync`（手机
   * 重连）、`attach`（在手机上打开一个终端），或那台电脑上任何终端再打出一行。
   *
   * 这个空窗是接受的，与 `flushToolbar` 那条注释里的空窗同源，代价比它更小：手机拿不到
   * 新命令时，分组行只是没有箭头，点一下仍然直接建终端。
   */
  private flushGroupCommands(): void {
    const transport = this.transport
    if (!transport) return
    try {
      const groups = this.fitGroupCommandsToBudget(this.terminal.listMobileGroupCommands())
      // Compared without the revision, so an unchanged list produces nothing at all.
      const serialized = JSON.stringify(groups)
      if (serialized === this.lastGroupCommandsContent) return
      this.lastGroupCommandsContent = serialized
      this.groupCommandsRevision += 1
      transport.sendGroupCommands({ revision: this.groupCommandsRevision, groups })
    } catch (error) {
      // 一份拿不到的分组命令列表，只意味着新建面板上的分组行没有箭头 —— 点一下照样
      // 能建终端，那是这条路上真正要紧的部分。
      this.logWarn("Mobile group command flush failed.", error)
    }
  }

  /** Sends even when nothing changed, for a caller that has nothing yet. */
  private resendGroupCommands(): void {
    this.lastGroupCommandsContent = ""
    this.flushGroupCommands()
  }

  /**
   * 从尾部整条丢命令，直到这份列表放得下 `maxGroupCommandsBytes`。
   *
   * 丢整条而不是把一条命令截一半：半条命令在手机上是一条「本该在、却不在」的选项，
   * 而它出现在哪个分组、叫什么名字都是确定的事实 —— 没有半个名字这种东西。
   * 一个分组被丢空就连它一起去掉：留着它会在手机上画出一个点开是空列表的箭头。
   *
   * 第一条放不下的命令之后的一切都不发，与 `fitToolbarToBudget` 的 `break` 同一条
   * 规则 —— 不做「跳过大的、塞进后面小的」这种聪明事：那会让被丢掉的东西取决于预算
   * 还剩多少字节，而谁都不知道自己在列表的哪一段。
   *
   * 真实账号到不了这里（64 KiB 约合四百多条命令行），它存在是为了那种不是的账号：
   * 宁可少几条命令，不可丢连接。
   */
  private fitGroupCommandsToBudget(
    entries: readonly MobileGroupCommandsEntry[],
  ): readonly MobileGroupCommandsEntry[] {
    const budget = MOBILE_FRAME_LIMITS.maxGroupCommandsBytes - GROUP_COMMANDS_ENVELOPE_ALLOWANCE_BYTES
    const kept: { groupId: string; commands: MobileGroupCommand[] }[] = []
    for (const entry of entries) {
      const target = { groupId: entry.groupId, commands: [] as MobileGroupCommand[] }
      // 这一组有没有命令放不下；整组被丢空也算截断了。
      let truncated = false
      for (const command of entry.commands) {
        target.commands.push(command)
        if (Buffer.byteLength(JSON.stringify([...kept, target]), "utf8") <= budget) continue
        target.commands.pop()
        truncated = true
        break
      }
      if (target.commands.length > 0) kept.push(target)
      // 放不下的命令之后**整个列表**都到此为止，不只是这一组：外层跟着停，与
      // `fitToolbarToBudget` 那一个 `break` 同形。整组都放得下的分组不算截断，列表继续。
      if (truncated) break
    }
    return kept
  }

  private async flushSummary(): Promise<void> {
    const transport = this.transport
    if (!transport) return
    // Piggy-backed on this tick rather than on a listener of its own: the terminal
    // event emitter is at Node's default limit of ten listeners and this list is not
    // allowed to grow. See the note on `start()`.
    this.flushToolbar()
    // 同样骑在这个 tick 上，理由见 `flushToolbar` 与 `flushGitStatus`。
    this.flushGroupCommands()
    // Piggy-backed on this tick rather than on a listener of its own — see `flushGitStatus`.
    void this.flushGitStatus()
    try {
      const sessions = await this.summarySessions()
      const [agentGroups, agentProviders] = await Promise.all([
        this.summaryAgentGroups(),
        this.summaryAgentProviders(),
      ])
      const content = this.fitSummaryToBudget({
        groups: this.summaryGroups(),
        workspaces: this.summaryWorkspaces(sessions),
        sessions,
        // Spread rather than assigned so an unreadable source adds no key at all: the
        // phone tells "nothing to choose from" (an empty list) apart from "this
        // computer cannot say" (no key), and only the first offers an empty panel.
        ...(agentGroups === undefined ? {} : { agentGroups }),
        ...(agentProviders === undefined ? {} : { agentProviders }),
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
   * The optional blocks go in order of what their loss costs. The tab layer is
   * sacrificed first because losing it degrades to precisely the flat list the phone
   * rendered before the layer existed. The project and Provider directories go next:
   * without them the phone cannot start a new Claude Code conversation, but every
   * conversation it already has is still there. Dropping sessions would make terminals
   * disappear, and sending an oversized payload would take the whole connection with
   * it. If even the bare list does not fit, the summary is not sent and the phone keeps
   * the list it already has.
   */
  private fitSummaryToBudget(content: MobileSummaryContent): MobileSummaryContent | null {
    if (summaryBytes(content) <= MOBILE_FRAME_LIMITS.maxSummaryBytes) return content
    const withoutTabs: MobileSummaryContent = {
      groups: content.groups,
      sessions: content.sessions,
      ...(content.agentGroups === undefined ? {} : { agentGroups: content.agentGroups }),
      ...(content.agentProviders === undefined ? {} : { agentProviders: content.agentProviders }),
    }
    if (summaryBytes(withoutTabs) <= MOBILE_FRAME_LIMITS.maxSummaryBytes) return withoutTabs
    // The directories go next, and for the same reason the tab layer did: a phone
    // without them can still see, open and type into every conversation it has — it
    // just cannot start a new Claude Code one until the list shrinks again. Dropping a
    // session would make a terminal disappear, which is the one thing this must never do.
    const withoutDirectories: MobileSummaryContent = {
      groups: withoutTabs.groups,
      sessions: withoutTabs.sessions,
    }
    const bytes = summaryBytes(withoutDirectories)
    if (bytes <= MOBILE_FRAME_LIMITS.maxSummaryBytes) return withoutDirectories
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

  /**
   * The projects a phone may start a conversation in, or nothing when unreadable.
   *
   * Clamped per field and then truncated to the count the wire admits, so the block can
   * never be long enough to fail validation — which matters more here than for a
   * session, because a summary that is rejected is answered by a closed connection
   * rather than a dropped field.
   *
   * `undefined` when the directory could not be read at all. An empty array would tell
   * the user they have no projects, which is a different and worse lie than saying
   * nothing; the sessions in the same payload are unaffected either way.
   */
  private async summaryAgentGroups(): Promise<readonly MobileSummaryAgentGroup[] | undefined> {
    const cached = this.agentGroupsCache
    if (cached && this.nowMs() - cached.readAtMs < MOBILE_AGENT_DIRECTORY_CACHE_MS) return cached.groups
    try {
      const groups = (await this.deps.listAgentConversationGroups())
        .slice(0, MOBILE_FRAME_LIMITS.maxSummaryAgentGroups)
        .map((group) => ({
          projectId: clampSummaryText(group.projectId, MOBILE_FRAME_LIMITS.maxSummaryIdLength),
          name: clampSummaryText(group.name, MOBILE_FRAME_LIMITS.maxSummaryAgentNameLength),
          isDefault: group.isDefault,
        }))
      // Only a read that worked is remembered. A directory that could not be read is
      // not worth caching — it is the one case where trying again on the next tick is
      // exactly what should happen, and there is nothing to serve in the meantime.
      this.agentGroupsCache = { readAtMs: this.nowMs(), groups }
      return groups
    } catch (error) {
      this.logWarn("Mobile summary could not read the project directory.", error)
      return undefined
    }
  }

  /**
   * The Providers a phone may start a conversation with, or nothing when unreadable.
   *
   * The rows arrive already reduced — no endpoint, no credential, and no field for one
   * to arrive in — so this only has to bound them for the wire. The model names come
   * out of the provider's own configuration, which is a setting a person typed, so each
   * is clamped like any other display string.
   */
  private async summaryAgentProviders(): Promise<readonly MobileSummaryAgentProvider[] | undefined> {
    const cached = this.agentProvidersCache
    if (cached && this.nowMs() - cached.readAtMs < MOBILE_AGENT_DIRECTORY_CACHE_MS) return cached.providers
    try {
      const providers = (await this.deps.listAgentConversationProviders())
        .slice(0, MOBILE_FRAME_LIMITS.maxSummaryAgentProviders)
        .map((provider) => ({
          id: clampSummaryText(provider.id, MOBILE_FRAME_LIMITS.maxSummaryIdLength),
          name: clampSummaryText(provider.name, MOBILE_FRAME_LIMITS.maxSummaryAgentNameLength),
          isDefault: provider.isDefault,
          defaultTier: provider.defaultTier,
          models: Object.fromEntries(
            Object.entries(provider.models)
              .filter((entry): entry is [MobileModelTier, string] => typeof entry[1] === "string")
              .map(([tier, model]) => [tier, clampSummaryText(model, MOBILE_FRAME_LIMITS.maxSummaryModelNameLength)]),
          ),
        }))
      this.agentProvidersCache = { readAtMs: this.nowMs(), providers }
      return providers
    } catch (error) {
      this.logWarn("Mobile summary could not read the Provider directory.", error)
      return undefined
    }
  }

  /**
   * 会话当前所在的目录，读不出来就退回它的启动目录。
   *
   * 这是**同步的纯读**（OSC 7 → 兜底探测的缓存 → 排一次后台探测 → 会话启动目录），
   * 在这里等任何 IO 都是错的：它走的是一条 1 Hz 的路。手机打开 Git 面板那一刻要的是
   * 一个确定的答案，那走的是可等待的 `probeCurrentWorkingDirectory`，不在这一条上。
   */
  private currentWorkingDirectoryFor(sessionId: string, fallback: string): string {
    try {
      return this.terminal.getCurrentWorkingDirectory(sessionId)
    } catch {
      // 会话没了：摘要那一轮本来也会把它从列表里去掉。
      return fallback
    }
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
        cwd: clampSummaryText(
          this.currentWorkingDirectoryFor(session.id, session.cwd),
          MOBILE_FRAME_LIMITS.maxSummaryCwdLength,
        ),
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
      const text = await this.scanForLastLine(sessionId)
      this.lastLineCache.set(sessionId, text)
      return text
    } catch {
      return known ?? ""
    }
  }

  /**
   * Walks up the screen for the nearest line that says something, and returns it.
   *
   * Skipping decoration is not enough on its own if the walk stops before it
   * reaches any text. A row left empty because the tail happens to be a box is
   * indistinguishable, on the phone, from a terminal that has gone quiet — and it
   * is not quiet, its text is three rows further up. So the walk keeps going
   * until it finds words, runs out of buffer, or passes
   * `SUMMARY_LAST_LINE_SCAN_LIMIT_LINES`, whichever comes first.
   *
   * An empty answer therefore means the whole scanned screen is blank or
   * furniture. That is a real thing to report, and no longer a claim about a
   * terminal that was busy all along.
   */
  private async scanForLastLine(sessionId: string): Promise<string> {
    const tail = await this.terminal.readLineWindow({
      sessionId,
      maxLines: SUMMARY_LAST_LINE_STEP_LINES,
    })
    const last = lastMeaningfulLine(tail.lines)
    if (last) return last

    let above = tail.startIndex
    let scanned = tail.lines.length
    while (above > 0 && scanned < SUMMARY_LAST_LINE_SCAN_LIMIT_LINES) {
      const step = Math.min(SUMMARY_LAST_LINE_STEP_LINES, SUMMARY_LAST_LINE_SCAN_LIMIT_LINES - scanned)
      const window = await this.terminal.readLineRange({ sessionId, from: above - step, maxLines: step })
      const found = lastMeaningfulLine(window.lines)
      if (found) return found
      // A read that comes back empty, or that reports a start no higher than the one
      // already reached, has nothing above it to walk into. Stopping is the only exit
      // from this loop that cannot spin.
      if (window.lines.length === 0 || window.startIndex >= above) break
      above = window.startIndex
      scanned += window.lines.length
    }
    return ""
  }

  /* ------------------------------------------------------------------ *
   * Git status
   * ------------------------------------------------------------------ */

  /**
   * 终端当前目录的 Git 状态，推给正开着这个终端的那台手机。
   *
   * **搭在既有的摘要 tick 上，不新增任何 `terminal.events` 监听器。** 这一条不是
   * 省事，是预算：网关 4 个（`start()` 里那四个）加终端 IPC 层的 6 个，正好是 Node
   * 默认的十个，`start()` 上的注释写着这份清单不应再增长，全仓没有一处
   * `setMaxListeners`。目录变化本身也没有专属事件可搭 —— `cd` 不 emit
   * `sessionChanged`（那个只在 `updateSessionState` 里发），`workingDirectoryChanged`
   * 倒是存在、也确实是我们想要的，但它**已经被终端 IPC 层订阅了**，再订一次就是
   * 第 11 个，与是不是同一个事件无关。
   *
   * 能跟上 `cd` 的原因：终端每输出一个 chunk 都会同时 emit `data` 与 `stateChanged`，
   * 网关转手就 `scheduleSummary()` —— 所以「有终端在打字时 1 Hz」这个心跳本来就活着，
   * `cd` 之后的提示符重绘一定落在它上面，延迟不超过一个 tick。
   *
   * 代价闸门只有一道，就是**目录**：它同时是「要不要跑 git」与「要不要发」的判据。
   *
   * 实现计划里写的是「先比目录、再比内容」两道，这里合成了一道，因为这道比内容更严：
   * `MobileGitStatus.cwd` 就在 payload 里，所以「内容一模一样」蕴含「目录一模一样」，
   * 内容那道闸永远轮不到它拦人 —— 留着它只会是一段看起来在工作、其实一次都不会命中的
   * 判断。省下的也正是那一次 `JSON.stringify`。
   *
   * 代价是明确的：在终端里手工 `git commit` 不会让第二行动，要等目录变了、手机重新
   * attach、或手机自己发起一次 Git 动作。这是这条路必然的取舍 —— 仓库变化在这条线上
   * 没有事件可搭（监听器预算已满，见上），剩下的办法只有定时重算，而那正是这道闸要
   * 防的东西。
   */
  private async flushGitStatus(): Promise<void> {
    const transport = this.transport
    if (!transport) return
    // 一次算一轮就够。`git status` 在一个大仓库上可能超过一个 tick，没有这道闸
    // 会让两轮叠在一起算同一个目录。
    if (this.gitStatusFlushing) {
      this.gitStatusResendPending = true
      return
    }
    this.gitStatusFlushing = true
    try {
      for (const attachment of this.registry.all()) {
        try {
          await this.flushAttachmentGitStatus(attachment)
        } catch (error) {
          // 一台手机的 Git 状态读不出来，不该带走别的手机的这一轮。
          this.logWarn("Mobile git status flush failed.", error, { sessionId: attachment.sessionId })
        }
      }
    } finally {
      this.gitStatusFlushing = false
    }
    if (!this.gitStatusResendPending) return
    // 本轮跑的时候有人要求重发（手机刚 attach / sync，或刚做完一个写动作）：
    // 它清掉的那条记录已经被这一轮又写回去了，所以必须再走一遍。
    this.gitStatusResendPending = false
    await this.flushGitStatus()
  }

  private async flushAttachmentGitStatus(attachment: MobileAttachment): Promise<void> {
    const transport = this.transport
    if (!transport) return
    const key = gitStatusKey(attachment.mobileClientInstanceId, attachment.sessionId)
    // 同步的纯读：1 Hz 这条路上绝不能藏 IO。兜底探测在这里只是「排一次后台任务」，
    // 结果下一次读就有；真正要等一个答案的时刻是手机打开面板，那走的是 intent。
    let cwd: string
    try {
      cwd = this.terminal.getCurrentWorkingDirectory(attachment.sessionId)
    } catch {
      // 会话已经不在了。它自己的清理走 attach 的别的路，这里没有可做的。
      this.gitStatusSeen.delete(key)
      return
    }
    // 目录没变就不跑 git、也不发：这一条就是全部的去重。摘要在有输出时是 1 Hz，
    // 少了它就等于每秒 spawn 一次 `git status`。
    if (this.gitStatusSeen.get(key) === cwd) return
    this.gitStatusSeen.set(key, cwd)

    const snapshot = await this.deps.terminalGit.getSnapshot(cwd)
    const status = toMobileGitStatus(snapshot)
    this.gitStatusRevision += 1
    transport.sendGitStatus({
      mobileClientInstanceId: attachment.mobileClientInstanceId,
      sessionId: attachment.sessionId,
      revision: this.gitStatusRevision,
      status,
    })
  }

  /**
   * 清掉记录再推一次，给「刚到的」与「刚做完的」两种调用方。
   *
   * 与 `resendToolbar` 同一个套路，理由也一样：`flushGitStatus` 比的是「上次发过什么」，
   * 而那个比较只对**收到过**的一方有意义。刚连上的手机什么都没收到；刚做完一个写动作的
   * 手机拿到的还是动作之前那份。两种都不该被指纹挡住。
   */
  private resendGitStatus(mobileClientInstanceId: string, sessionId: string): void {
    this.gitStatusSeen.delete(gitStatusKey(mobileClientInstanceId, sessionId))
    void this.flushGitStatus()
  }

  /* ------------------------------------------------------------------ *
   * Quick phrases
   * ------------------------------------------------------------------ */

  /**
   * Sends the desktop's 快捷输入 sentences to its phones: a full snapshot, fingerprinted
   * so an idle desktop produces no traffic.
   *
   * Unlike the toolbar, this one has a real change signal — the quick-input service
   * emits `changed` whenever the user edits the table — so it is pushed rather than
   * polled on the summary tick. The two arrivals the event cannot cover are a phone
   * connecting and a phone opening a terminal, and those call `resendQuickPhrases`
   * directly, the way they already do for the toolbar.
   *
   * The list is read through an injected function rather than held here, so there is
   * no second copy of the user's table to drift from the first.
   *
   * Public because the change signal arrives as an event rather than as one of this
   * service's own calls: the bootstrap subscribes the quick-input app's `changed` to
   * this method. The event says "look again", not "something differs" — `update`
   * emits it on every save, including one that rewrote the same sentence — which is
   * precisely the difference the fingerprint below is here to absorb.
   */
  async flushQuickPhrases(): Promise<void> {
    const transport = this.transport
    if (!transport) return
    try {
      const phrases = this.fitQuickPhrasesToBudget(await this.deps.listQuickPhrases())
      // Compared without the revision, so an unchanged list produces nothing at all.
      const serialized = JSON.stringify(phrases)
      if (serialized === this.lastQuickPhrasesContent) return
      this.lastQuickPhrasesContent = serialized
      this.quickPhrasesRevision += 1
      transport.sendQuickPhrases({ revision: this.quickPhrasesRevision, phrases })
    } catch (error) {
      // A phone without the sentences still has the command buttons and the terminal
      // itself; failing to read one app's table is not a reason to lose either.
      this.logWarn("Mobile quick phrases flush failed.", error)
    }
  }

  /**
   * Sends even when nothing changed, for a caller that has nothing yet.
   *
   * `flushQuickPhrases` compares against what was last sent, which is what keeps an
   * idle desktop from producing traffic — but "last sent" only means something to a
   * listener that was there. A phone that has just connected received nothing, and
   * the sentences it needs may have gone to a previous cloud process. Clearing the
   * comparison first is what makes this an answer to that phone rather than to the
   * fingerprint.
   */
  resendQuickPhrases(): void {
    this.lastQuickPhrasesContent = ""
    void this.flushQuickPhrases()
  }

  /**
   * Drops what does not fit, entry by entry, without ever shortening an entry.
   *
   * Two limits, applied for the same reason: the phone's composer is about to hold
   * this sentence and its user is about to send it believing it is the one they
   * wrote. A sentence trimmed to fit would leave that belief intact and be wrong,
   * which is worse than the sentence being visibly absent — so an over-long one is
   * dropped whole and *said so*, and the byte budget drops the tail rather than
   * cutting the entry it lands on.
   *
   * Unreachable for any table the product produces — the app bounds nothing, but a
   * person does not write sixty-five sentences — so like the toolbar's budget this
   * exists for the case where it is not, and prefers losing entries to losing the
   * connection.
   */
  private fitQuickPhrasesToBudget(phrases: readonly MobileQuickPhrase[]): readonly MobileQuickPhrase[] {
    const budget = MOBILE_FRAME_LIMITS.maxQuickPhrasesBytes - QUICK_PHRASES_ENVELOPE_ALLOWANCE_BYTES
    const kept: MobileQuickPhrase[] = []
    for (const phrase of phrases) {
      if (phrase.content.length > MOBILE_FRAME_LIMITS.maxQuickPhraseLength) {
        this.logWarn("Mobile quick phrase dropped for exceeding the wire limit.", {
          phraseId: phrase.id,
          length: phrase.content.length,
        })
        continue
      }
      if (kept.length >= MOBILE_FRAME_LIMITS.maxQuickPhrases) break
      const candidate = [...kept, phrase]
      if (Buffer.byteLength(JSON.stringify(candidate), "utf8") > budget) break
      kept.push(phrase)
    }
    return kept
  }

  /* ------------------------------------------------------------------ *
   * Clipboard
   * ------------------------------------------------------------------ */

  /**
   * Sends the collector's ring when it differs from what was last sent.
   *
   * The comparison is the point, exactly as it is for the three above: the collector
   * emits once per copy, and without a fingerprint here every copy would also be a
   * send even when a phone is looking at a computer it is not the one for.
   */
  async flushClipboard(): Promise<void> {
    const transport = this.transport
    if (!transport) return
    try {
      const entries = this.fitClipboardToBudget(await this.deps.listClipboard())
      // Compared without the revision, so an unchanged ring produces nothing at all.
      const serialized = JSON.stringify(entries)
      if (serialized === this.lastClipboardContent) return
      this.lastClipboardContent = serialized
      this.clipboardRevision += 1
      transport.sendClipboard({ revision: this.clipboardRevision, entries })
    } catch (error) {
      // A phone without the clipboard still has the terminal and every other
      // snapshot; failing to read one line of text is not a reason to lose them.
      this.logWarn("Mobile clipboard flush failed.", error)
    }
  }

  /**
   * Sends even when nothing changed, for a caller that has nothing yet.
   *
   * `resendQuickPhrases`' reasoning, and this is the family that needs it most: a
   * phone merges what arrives into a list it keeps across launches, so the snapshot
   * it gets after reconnecting is how it fills the gap left by everything copied
   * while it was away.
   */
  resendClipboard(): void {
    this.lastClipboardContent = ""
    void this.flushClipboard()
  }

  /**
   * Drops what does not fit, entry by entry, without ever shortening an entry.
   *
   * The same rule as the toolbar's and the phrases' budgets, for a reason that is
   * sharper here: a phone is about to put this text on its own clipboard, and its
   * user is about to paste it somewhere believing it is what they copied. A trimmed
   * entry would make that belief wrong in a way nothing on the screen reveals. The
   * tail is dropped rather than the oversized entry, because newest-first means the
   * tail is the oldest — and the phone already has its own copy of anything that old.
   *
   * The per-entry check should be unreachable: the collector drops over-long text by
   * the same constant. It is here so that the two constants coming apart shows up as
   * a warning rather than as a payload the phone silently refuses.
   */
  private fitClipboardToBudget(entries: readonly ClipboardSyncEntry[]): readonly ClipboardSyncEntry[] {
    const budget = MOBILE_FRAME_LIMITS.maxClipboardBytes - CLIPBOARD_ENVELOPE_ALLOWANCE_BYTES
    const kept: ClipboardSyncEntry[] = []
    for (const entry of entries) {
      if (entry.text.length > MOBILE_FRAME_LIMITS.maxClipboardTextLength) {
        this.logWarn("Mobile clipboard entry dropped for exceeding the wire limit.", {
          entryId: entry.id,
          length: entry.text.length,
        })
        continue
      }
      if (kept.length >= MOBILE_FRAME_LIMITS.maxClipboardEntries) break
      const candidate = [...kept, entry]
      if (Buffer.byteLength(JSON.stringify(candidate), "utf8") > budget) break
      kept.push(entry)
    }
    return kept
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

  /**
   * Dropped rather than queued when there is no transport: the next tick carries
   * the same story, and a bar that arrives after its file has landed is noise.
   */
  private reportTransferProgress(
    mobileClientInstanceId: string,
    intentId: string,
    completedBytes: number,
    totalBytes: number,
  ): void {
    const transport = this.transport
    if (!transport) return
    transport.sendTransferProgress({ mobileClientInstanceId, intentId, completedBytes, totalBytes })
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
  readonly agentGroups?: readonly MobileSummaryAgentGroup[]
  readonly agentProviders?: readonly MobileSummaryAgentProvider[]
}

/** What the socket will have to carry, measured the same way the budget is stated. */
function summaryBytes(content: MobileSummaryContent): number {
  return Buffer.byteLength(JSON.stringify(content), "utf8")
}

/**
 * Serializes a batch of frames once, for everything that needs the bytes.
 *
 * The budget is stated in bytes on the wire, and the wire form of a frame *is*
 * `JSON.stringify`'s output — so the string produced here is what the decision is made
 * on, what the log lines report, and what the transport sends. The alternative, which
 * this replaces, was to serialize each frame to count it and then let the envelope
 * serialize the same frame again on the way out: two full escaping passes over up to
 * 8 KiB of terminal text per frame, and two places that could disagree about how many
 * bytes a frame costs.
 */
function serializeFrames(frames: readonly MobileTerminalFrame[]): string[] {
  return frames.map((frame) => JSON.stringify(frame))
}

/**
 * The bytes those serialized frames cost, measured the way the budget is stated.
 *
 * One implementation rather than two: the budget spends these bytes and the log line
 * reports them, and a log that disagrees with the number the decision was made on is
 * worse than no log at all.
 */
function wireBytes(serialized: readonly string[]): number {
  let bytes = 0
  for (const frame of serialized) bytes += Buffer.byteLength(frame, "utf8")
  return bytes
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

/** 一台手机在一个会话上算过的那一笔，只认这一对。 */
function gitStatusKey(mobileClientInstanceId: string, sessionId: string): string {
  return `${mobileClientInstanceId}\x00${sessionId}`
}

/**
 * 服务层的快照 → 线上的那份状态。
 *
 * **`changes` 不上这条线**：手机端不接收任何文件清单（设计文档决策六），它只回答
 * 「有几个改动」这一个数。这不是「暂时没做」，是一条口径 —— 省的是流量，也是
 * 「用户在手机上不会以为自己能挑文件提交」。
 *
 * 不是仓库时整份是 `null`，而不是一个字段都空的对象：手机端要用它把「这里不是
 * 仓库」（第二行退回版本号）与「还没收到回答」（维持现状）分开，两者在屏幕上长得
 * 一样但含义完全不同。
 */
function toMobileGitStatus(snapshot: TerminalGitSnapshot): MobileGitStatus | null {
  if (!snapshot.isRepository) return null
  return {
    cwd: clampSummaryText(snapshot.cwd, MOBILE_FRAME_LIMITS.maxGitPathLength),
    branch: snapshot.branch === null
      ? null
      : clampSummaryText(snapshot.branch, MOBILE_FRAME_LIMITS.maxGitRefNameLength),
    ...(snapshot.detachedSha === null
      ? {}
      : { detachedSha: clampSummaryText(snapshot.detachedSha, MOBILE_FRAME_LIMITS.maxGitShortShaLength) }),
    upstream: snapshot.upstream === null
      ? null
      : clampSummaryText(snapshot.upstream, MOBILE_FRAME_LIMITS.maxGitRefNameLength),
    ahead: snapshot.ahead,
    behind: snapshot.behind,
    changeCount: snapshot.changeCount,
    hasConflicts: snapshot.hasConflicts,
  }
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

/** The lowest line of a window with words in it, or `""` when none of them has any. */
function lastMeaningfulLine(lines: readonly TerminalStyledLine[]): string {
  for (let index = lines.length - 1; index >= 0; index -= 1) {
    const text = lines[index].text.trim()
    if (text && isMeaningfulLine(text)) return text
  }
  return ""
}
