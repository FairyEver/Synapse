/**
 * Wire protocol for the mobile terminal relay.
 *
 * The desktop owns the terminal; the phone only sees a derived view of it. Three
 * message families flow over the existing live socket:
 *
 * - `mobile.summary` desktop → cloud → phone (fanned out per desktop)
 * - `mobile.frame`   desktop → cloud → one phone (only for the attached session)
 * - `mobile.intent`  phone → cloud → one desktop, answered by `mobile.intentResult`
 *
 * Producers are self-bounded, and they are bounded separately because they fail
 * differently. A frame that is too large is split; a *summary* cannot be split —
 * a phone treats every summary it receives as the whole list, so a summary that
 * outgrows the socket must never be produced at all. `maxPayloadBytes` bounds one
 * frame, `maxSummaryBytes` bounds one summary, and the sockets' `maxPayload` sits
 * above both (see the comment on `maxSummaryBytes`).
 */

/**
 * The numeric contract the desktop and the phone both encode.
 *
 * Declared here *and* in `mobile-live-constants.cjs`, which exists because the
 * Electron main process is CommonJS and cannot import this module. The two are
 * kept honest by `mobile-live.test.ts` rather than by an import between them:
 * the renderer loads this package through Vite, which cannot extract named
 * exports from a `.cjs` file. `drive.ts` and `drive-sync-constants.cjs` are
 * duplicated for the same reason.
 */
export const MOBILE_PROTOCOL_VERSION = 1

export const MOBILE_FRAME_LIMITS = {
  /** Hard ceiling for one serialized frame. A phone renders far less; the split point is here. */
  maxPayloadBytes: 8 * 1024,
  /** Steady-state uplink budget. Excess frames become a fresh snapshot instead. */
  maxBytesPerSecond: 64 * 1024,
  maxLinesPerFrame: 512,
  /** Upper bound for one history page; the client asks for less in practice. */
  maxHistoryLines: 500,
  /** A single line longer than this is truncated; real terminals wrap far below it. */
  maxLineLength: 8 * 1024,
  maxRunsPerLine: 256,
  maxSummarySessions: 256,
  maxSummaryGroups: 128,
  /**
   * Tab layer. A tab holds at most eight panes — `TERMINAL_WORKSPACE_PANE_LIMIT` in
   * the terminal capability — and there can never be more non-empty tabs than there
   * are sessions, since every pane names one.
   */
  maxSummaryWorkspaces: 256,
  maxSummaryWorkspacePanes: 8,
  /**
   * Summary field bounds. Every one of these is the *producer's* clamp as well as
   * the relay's guard, so a field can never be long enough to fail validation.
   *
   * `cwd` and `lastLine` are display strings — a phone row shows a fraction of
   * them — which is why they are clamped far below what a terminal can hold.
   */
  maxSummaryIdLength: 48,
  maxSummaryCwdLength: 128,
  maxSummaryLastLineLength: 120,
  maxSummaryStartedAtLength: 48,
  /** Group names are capped at 80 by the terminal schema; this only restates it. */
  maxSummaryGroupNameLength: 80,
  /**
   * Byte budget for one serialized summary payload, measured without the envelope.
   *
   * The desktop's producer must never exceed this. It cannot: with every field at
   * the limits above, the largest summary the wire admits — 256 sessions and 128
   * groups — serializes to 218 KiB. The boundary test in `mobile-live.test.ts`
   * pins that arithmetic down, and `live-desktop.gateway.spec.ts` asserts the
   * socket clears it.
   *
   * The constraint that makes this a *correctness* constant rather than a tuning
   * knob is the sockets' `maxPayload`. Both the desktop→cloud hop and the phone hop
   * must carry a summary in one message, because a phone treats each one as the
   * whole list; the `ws` layer answers an oversized message by closing the
   * connection, which a user sees as their computer going offline. The desktop hop
   * is the binding one and is set to 256 KiB in
   * `server/src/live/live-desktop.gateway.ts`; raise that first, and keep this
   * below it.
   */
  maxSummaryBytes: 224 * 1024,
  maxIntentTextLength: 8 * 1024,
  maxKeyActions: 128,
  maxTitleLength: 200,
  /** ASR 引擎标识，腾讯云目前最长的是 `Hy-ASR-3.0-preview`。 */
  maxEngineModelTypeLength: 64,
  /** 已签名的 wss URL。签名本身约 60 字符，其余是主机、路径与握手参数。 */
  maxSignedAsrUrlLength: 2048,
  maxAsrVoiceIdLength: 120,
  /**
   * Grid bounds a phone may ask the desktop to adopt.
   *
   * Restated from `terminalResizeSessionInputSchema`, which is the terminal
   * capability's own ceiling — the gateway validates before the service does, so a
   * request that is rejected here never reaches the layer that would explain why.
   * Keep the two in step.
   */
  maxResizeCols: 500,
  maxResizeRows: 200,
  /**
   * A phone's own name, shown on the desktop badge that says which device set the
   * size. Display-only, so it is clamped well below what a device name can hold.
   */
  maxDeviceLabelLength: 40,
  /**
   * Relay ceilings for the phone → cloud → desktop file hand-off.
   *
   * The bytes travel over HTTP rather than this socket, but both ends still have
   * to agree on the size: the phone refuses a selection over this bound before it
   * uploads, and the desktop refuses again before it writes anything to the user's
   * disk. A drive id is a cuid, so 64 is generous; the file name is clamped at
   * what a real file name holds, well under the drive's own 255.
   */
  maxRelayedFileBytes: 100 * 1024 * 1024,
  maxRelayedFileNameLength: 120,
  maxUploadDriveItemIdLength: 64,
} as const

/** Style attribute bits packed into the fifth element of a run tuple. */
export const MOBILE_RUN_FLAGS = {
  bold: 1 << 0,
  italic: 1 << 1,
  underline: 1 << 2,
  dim: 1 << 3,
  inverse: 1 << 4,
} as const

/** `-1` for the terminal default, `0..255` for a palette index, `0x1000000 | rgb` for truecolor. */
export const MOBILE_DEFAULT_COLOR = -1
export const MOBILE_TRUECOLOR_BASE = 0x100_0000

/**
 * The only keys the terminal service can encode, and therefore the complete
 * vocabulary of the phone's accessory bar.
 */
export const MOBILE_KEYS = [
  "Enter",
  "Tab",
  "Escape",
  "ArrowUp",
  "ArrowDown",
  "ArrowLeft",
  "ArrowRight",
  "Backspace",
  "Ctrl+C",
  "Ctrl+D",
] as const

export const MOBILE_MESSAGE_TYPES = {
  summary: "mobile.summary",
  frame: "mobile.frame",
  intent: "mobile.intent",
  intentResult: "mobile.intentResult",
  detached: "mobile.detached",
} as const

/* ------------------------------------------------------------------ *
 * Terminal frame
 * ------------------------------------------------------------------ */

/**
 * Compact line encoding. `runs` is omitted entirely for unstyled lines, which is
 * the overwhelming majority of log output and roughly halves the payload.
 */
export type MobileLineWire = readonly [text: string] | readonly [text: string, runs: readonly MobileRunWire[]]

/**
 * `[startOffset, length, foreground, background, flags]`.
 *
 * Colors are `-1` for the terminal default, `0..255` for a palette index, or
 * `0x1000000 | (r << 16) | (g << 8) | b` for a truecolor value.
 */
export type MobileRunWire = readonly [
  start: number,
  length: number,
  foreground: number,
  background: number,
  flags: number,
]

export function encodeMobileTruecolor(red: number, green: number, blue: number): number {
  return MOBILE_TRUECOLOR_BASE | ((red & 0xff) << 16) | ((green & 0xff) << 8) | (blue & 0xff)
}

/**
 * A frame is a *suffix replacement*: "the content from absolute line `from`
 * onwards is exactly this, and anything after it is void".
 *
 * That semantic makes frames idempotent (safe to replay after a flaky send) and
 * self-healing (a client that missed frames converges on the next one that starts
 * at or before its highest known line). Neither acknowledgements nor sequence
 * numbers are needed, which is deliberate — both are liabilities on mobile networks.
 */
export interface MobileTerminalFrame {
  readonly v: typeof MOBILE_PROTOCOL_VERSION
  readonly sessionId: string
  /**
   * - `suffix` replaces everything from `from` onward
   * - `reset` does the same and also discards anything before `from`
   * - `history` replaces exactly `[from, from + lines.length)` and leaves the
   *   rest of the client's buffer untouched, so older lines can be filled in
   *   without the client losing the newer ones it already has.
   */
  readonly kind: "suffix" | "reset" | "history"
  /** Absolute line index of `lines[0]`. Monotonic within a session; scrollback does not shift it. */
  readonly from: number
  readonly lines: readonly MobileLineWire[]
  /** Current total line count; the client truncates anything beyond `from + lines.length`. */
  readonly total: number
  readonly cursor: MobileTerminalCursor
  /** True while the session is on the alternate screen (TUI programs). */
  readonly alt: boolean
  /** True when lines before `from` are unavailable and the client must discard them. */
  readonly truncated: boolean
  /** Output watermark of the underlying session, used by `readSession` to refill gaps. */
  readonly seq: number
  readonly sizeRevision: number
}

export interface MobileTerminalCursor {
  /**
   * Absolute gateway line index of the cursor, in the same space as the frame's
   * `from`/`total` — not an offset into `lines`. A split update therefore carries
   * a cursor that stays valid across every frame it was split into.
   */
  readonly row: number
  readonly col: number
  readonly visible: boolean
}

/* ------------------------------------------------------------------ *
 * Summary
 * ------------------------------------------------------------------ */

export interface MobileSummaryGroup {
  readonly id: string
  readonly name: string
}

/** One split inside a tab: the pane's own identity, and the conversation it shows. */
export interface MobileSummaryWorkspacePane {
  readonly paneId: string
  readonly sessionId: string
}

/**
 * A tab — the layer between a group and its conversations.
 *
 * Panes come in the order the desktop lays them out, which is the split tree's own
 * left-to-right, top-to-bottom order, so a client that renders them in array order
 * matches the desktop without needing the tree. The geometry (split direction and
 * ratio) is deliberately absent: it describes a screen a phone does not have.
 */
export interface MobileSummaryWorkspace {
  readonly id: string
  readonly groupId: string
  readonly title: string
  readonly panes: readonly MobileSummaryWorkspacePane[]
}

export interface MobileSummaryAttention {
  readonly state: "waiting" | "not_waiting" | "unknown"
  readonly kind: "shell_ready" | "agent_question" | "approval" | "password" | "other_interaction" | "unknown"
}

export interface MobileSummarySession {
  readonly id: string
  readonly groupId: string
  readonly title: string
  readonly status: "running" | "stopping" | "ended" | "failed" | "lost"
  readonly attention: MobileSummaryAttention
  readonly cwd: string
  readonly cols: number
  readonly rows: number
  readonly startedAt: string
  /** Last non-blank rendered line, so the list is useful without opening the session. */
  readonly lastLine: string
  readonly lastOutputSeq: number
}

/**
 * Content-driven, not tick-driven: the desktop only sends this when the rendered
 * snapshot actually differs from the previous one, so an idle terminal costs nothing.
 *
 * It is the one message that cannot be split — a phone replaces its whole list with
 * whatever arrives — so its size is bounded by `MOBILE_FRAME_LIMITS.maxSummaryBytes`
 * and the sockets are sized above that.
 */
export interface MobileSummaryPayload {
  readonly desktopClientInstanceId: string
  readonly desktopName: string
  readonly revision: number
  readonly groups: readonly MobileSummaryGroup[]
  /**
   * Present only when some tab actually holds more than one pane.
   *
   * A desktop gives every new conversation its own tab, so with no splits the flat
   * `sessions` list already *is* the hierarchy and restating it would be pure
   * overhead. Omitting it keeps the common payload byte-for-byte what it was before
   * this layer existed, and leaves a client that ignores the field rendering exactly
   * the same list it always did.
   */
  readonly workspaces?: readonly MobileSummaryWorkspace[]
  readonly sessions: readonly MobileSummarySession[]
}

/* ------------------------------------------------------------------ *
 * Intent
 * ------------------------------------------------------------------ */

export type MobileKey = typeof MOBILE_KEYS[number]

export type MobileKeyAction =
  | { readonly type: "text"; readonly text: string }
  | { readonly type: "key"; readonly key: MobileKey }

/**
 * Every intent carries a client-generated `intentId`. The desktop gateway executes
 * the first one it sees and replays the stored result for repeats, so the phone can
 * resend blindly on a flaky link without risking a duplicate keystroke or command.
 */
export type MobileIntent =
  | (MobileIntentEnvelope<"attach"> & { readonly sessionId: string })
  | (MobileIntentEnvelope<"detach"> & { readonly sessionId: string })
  | MobileIntentEnvelope<"sync">
  /**
   * Liveness only. The desktop holds a write lease for as long as a phone keeps a
   * terminal open, so it needs a signal that the phone is still there; without one
   * a crashed client would pin the lease until it expired.
   */
  | MobileIntentEnvelope<"ping">
  /**
   * Takes the write lease back after the desktop's own user typed, which preempts
   * the phone by design. It grants nothing on its own: a phone that opened a
   * terminal can already type into it.
   */
  | (MobileIntentEnvelope<"unlock"> & { readonly sessionId: string })
  | (MobileIntentEnvelope<"command"> & { readonly sessionId: string; readonly text: string })
  | (MobileIntentEnvelope<"keys"> & {
    readonly sessionId: string
    readonly actions: readonly MobileKeyAction[]
  })
  | (MobileIntentEnvelope<"stop"> & { readonly sessionId: string })
  /**
   * Removes a terminal. The service refuses to delete one that is still running,
   * so a live session is stopped first — and a stop is itself what removes it,
   * because the PTY exiting destroys the session on its own.
   */
  | (MobileIntentEnvelope<"delete"> & { readonly sessionId: string })
  /**
   * Asks for `limit` lines immediately before `before` (the client's oldest
   * known gateway index). Only one terminal can be scrolled at a time, so this
   * is deliberately not part of the frame stream.
   */
  | (MobileIntentEnvelope<"history"> & {
    readonly sessionId: string
    readonly before: number
    readonly limit: number
  })
  | MobileIntentEnvelope<"stopAll">
  | (MobileIntentEnvelope<"rename"> & { readonly sessionId: string; readonly title: string })
  /**
   * The phone sets the PTY grid, for the display mode where the phone drives the
   * size so its own rendering is exact rather than wrapped.
   *
   * This is a UI resize, not an automated one: ADR 0063 allows a user or UI resize
   * without a lease because it neither takes input control nor revokes a lease the
   * desktop holds. The desktop tracks who set the size so it can say so and offer
   * to take it back, and any resize from anywhere else clears that ownership.
   *
   * `deviceLabel` is what the desktop badge shows. The id is what makes the owner
   * unambiguous when more than one phone is attached.
   */
  | (MobileIntentEnvelope<"resize"> & {
    readonly sessionId: string
    readonly cols: number
    readonly rows: number
    readonly deviceLabel: string
  })
  /**
   * Hands the grid back to the desktop.
   *
   * Sent when the reader leaves the mode where the phone drives the size. The phone
   * cannot restore the desktop's own grid itself — it only ever heard the size the
   * PTY currently has, which is the phone's — so it releases the claim and lets the
   * desktop's layout decide again.
   */
  | (MobileIntentEnvelope<"releaseGrid"> & { readonly sessionId: string })
  | (MobileIntentEnvelope<"create"> & {
    readonly groupId: string
    readonly title?: string
    /**
     * Initial grid, so the session is born the right shape.
     *
     * Resizing after creation is too late: a shell prints its banner, prompt and
     * first `git status` within the opening milliseconds, laid out for whatever
     * width the PTY had at the time. Those lines stay in scrollback at the old
     * width forever. ADR 0063 requires explicit initial dimensions to be
     * authorized as both a creation and a resize.
     */
    readonly cols?: number
    readonly rows?: number
    /**
     * Only meaningful together with the dimensions, and only for the badge the
     * desktop shows while the phone owns the size.
     */
    readonly deviceLabel?: string
  })
  | (MobileIntentEnvelope<"launchCommand"> & { readonly groupId: string; readonly commandId: string })
  /**
   * 手机要一条已经签好名的腾讯云实时语音识别 URL。
   *
   * 只有桌面的主进程持有 SecretKey，手机从头到尾不接触密钥。签名原文只覆盖握手
   * 参数、不含音频数据，所以可以预签：桌面签好完整 URL 下发，手机拿它直连腾讯云。
   *
   * 不挂 sessionId —— 语音输入与具体终端无关，签名也不需要终端上下文。结果里带
   * voiceId，每次连接都要换新的，中断后旧的一律作废。
   */
  | (MobileIntentEnvelope<"asrSign"> & { readonly engineModelType?: string })
  /**
   * One file the phone has already put in the user's drive, to be brought down to
   * this computer and named in the terminal.
   *
   * The bytes deliberately do not travel over this socket. The phone uploads them
   * to the drive over HTTP and this intent carries only the reference, which is
   * what keeps the relay free of a data plane — a file here would otherwise have
   * to be chunked, checksummed and quota'd against `maxIntentTextLength`.
   *
   * One intent per file rather than one per batch, for two reasons: the per-file
   * result is what the phone needs to report which file failed, and `intentId`
   * replay protection then covers each file on its own, so a retry after a flaky
   * link can never re-type a path that already landed.
   *
   * The desktop deletes the cloud copy once the file is on its disk. A session
   * that has ended in the meantime is not a failure: the file still lands, and the
   * result says the path was not typed.
   */
  | (MobileIntentEnvelope<"fileUpload"> & {
    readonly sessionId: string
    /** The uploaded copy in the user's drive; the desktop deletes it after the file lands. */
    readonly driveItemId: string
    /**
     * Bare file name to write on the computer. The phone sets it, having already
     * converted HEIC to JPEG and fixed the extension; the desktop sanitizes it
     * again before touching the filesystem.
     */
    readonly fileName: string
  })

type MobileIntentEnvelope<TKind extends string> = {
  readonly v: typeof MOBILE_PROTOCOL_VERSION
  readonly intentId: string
  readonly kind: TKind
}

export type MobileIntentKind = MobileIntent["kind"]

/**
 * Three-valued on purpose. The terminal service has genuinely uncertain outcomes
 * (`partial`, `delivery_uncertain`); the gateway resolves those into a definite
 * `accepted` or `rejected` before replying, because a phone cannot make a sound
 * decision about an uncertain side effect.
 */
export interface MobileIntentResult {
  readonly intentId: string
  readonly outcome: "accepted" | "rejected" | "no_op"
  readonly code?: string
  readonly message?: string
  readonly sessionId?: string
  /** Set for `create` and `launchCommand`, so the phone can open the new session immediately. */
  readonly createdSessionId?: string
  /**
   * Set for `fileUpload`, once the file is on the computer's disk.
   *
   * The phone cannot derive this: the directory a file lands in is the computer's
   * fact, not the phone's. It needs the path to offer an undo — which is a
   * backspace per character — and to say truthfully where the file went.
   */
  readonly landedPath?: string
  /**
   * Set for `asrSign`: 一条可直接连接的腾讯云实时语音识别 URL，以及配套的 voiceId。
   *
   * URL 里已经带上 signature，密钥本身不在里面 —— 手机拿到的只是一次性的入场券。
   */
  readonly signedAsrUrl?: string
  readonly asrVoiceId?: string
  /** 签名过期时刻（epoch 秒）；客户端据此在过期后重新要一条。 */
  readonly asrExpiresAt?: number
}

/* ------------------------------------------------------------------ *
 * Routing payloads
 * ------------------------------------------------------------------ */

export interface MobileFramePayload {
  readonly desktopClientInstanceId: string
  readonly mobileClientInstanceId: string
  readonly frame: MobileTerminalFrame
}

export interface MobileIntentPayload {
  readonly desktopClientInstanceId: string
  readonly mobileClientInstanceId: string
  readonly intent: MobileIntent
}

export interface MobileIntentResultPayload {
  readonly mobileClientInstanceId: string
  readonly result: MobileIntentResult
}

/**
 * Which of the user's computers a phone can reach right now.
 *
 * The phone's socket is to the cloud, not to a computer, so a desktop signing in
 * or dropping out is invisible to it otherwise — it would only ever learn from
 * asking. This is the pushed answer, sent on every change rather than on a
 * schedule.
 *
 * The list is the whole truth, not a delta: a phone replaces what it has, so a
 * dropped message costs nothing beyond waiting for the next change.
 */
export interface MobilePresencePayload {
  readonly desktopClientInstanceIds: readonly string[]
}

/**
 * Sent by the cloud to a desktop when a phone's connection drops.
 *
 * Without it the desktop would keep renewing that phone's write lease until its
 * idle timeout, leaving a window in which nobody can type into the terminal.
 */
export interface MobileDetachedPayload {
  readonly mobileClientInstanceId: string
  readonly reason: string
}

/* ------------------------------------------------------------------ *
 * Validation
 * ------------------------------------------------------------------ *
 *
 * The cloud relays frames it does not interpret, so validation stays shallow but
 * bounded: enough to route safely and to keep a hostile payload from becoming an
 * amplification or memory vector, without making the relay pay per-line costs.
 */

export function isMobileSummaryPayload(value: unknown): value is MobileSummaryPayload {
  if (!isRecord(value)) return false
  if (!boundedString(value.desktopClientInstanceId, 120)) return false
  if (!boundedString(value.desktopName, 120)) return false
  if (!nonNegativeInteger(value.revision)) return false
  if (!boundedArray(value.groups, MOBILE_FRAME_LIMITS.maxSummaryGroups)) return false
  if (!boundedArray(value.sessions, MOBILE_FRAME_LIMITS.maxSummarySessions)) return false
  // Absent is the normal case and always accepted: it means "no tab has a split".
  if (value.workspaces !== undefined) {
    if (!boundedArray(value.workspaces, MOBILE_FRAME_LIMITS.maxSummaryWorkspaces)) return false
    if (!(value.workspaces as readonly unknown[]).every(isSummaryWorkspace)) return false
  }
  return (value.groups as readonly unknown[]).every(isSummaryGroup) &&
    (value.sessions as readonly unknown[]).every(isSummarySession)
}

export function isMobileFramePayload(value: unknown): value is MobileFramePayload {
  if (!isRecord(value)) return false
  return boundedString(value.desktopClientInstanceId, 120) &&
    boundedString(value.mobileClientInstanceId, 120) &&
    isMobileTerminalFrame(value.frame)
}

export function isMobileIntentPayload(value: unknown): value is MobileIntentPayload {
  if (!isRecord(value)) return false
  return boundedString(value.desktopClientInstanceId, 120) &&
    boundedString(value.mobileClientInstanceId, 120) &&
    isMobileIntent(value.intent)
}

export function isMobileIntentResultPayload(value: unknown): value is MobileIntentResultPayload {
  if (!isRecord(value)) return false
  return boundedString(value.mobileClientInstanceId, 120) && isMobileIntentResult(value.result)
}

export function isMobileDetachedPayload(value: unknown): value is MobileDetachedPayload {
  if (!isRecord(value)) return false
  return boundedString(value.mobileClientInstanceId, 120) && boundedString(value.reason, 120)
}

export function isMobilePresencePayload(value: unknown): value is MobilePresencePayload {
  if (!isRecord(value)) return false
  const ids = value.desktopClientInstanceIds
  // A user cannot realistically exceed this, and the bound keeps a malformed or
  // hostile payload from being fanned out to every phone of the account.
  if (!boundedArray(ids, 64)) return false
  return ids.every((id) => boundedString(id, 120))
}

export function isMobileTerminalFrame(value: unknown): value is MobileTerminalFrame {
  if (!isRecord(value)) return false
  if (value.v !== MOBILE_PROTOCOL_VERSION) return false
  if (!boundedString(value.sessionId, 120)) return false
  if (value.kind !== "suffix" && value.kind !== "reset" && value.kind !== "history") return false
  if (!nonNegativeInteger(value.from)) return false
  if (!nonNegativeInteger(value.total)) return false
  if (!nonNegativeInteger(value.seq)) return false
  if (!positiveNumber(value.sizeRevision)) return false
  if (typeof value.alt !== "boolean" || typeof value.truncated !== "boolean") return false
  if (!isCursor(value.cursor)) return false
  if (!boundedArray(value.lines, MOBILE_FRAME_LIMITS.maxLinesPerFrame)) return false
  return (value.lines as readonly unknown[]).every(isLineWire)
}

export function isMobileIntent(value: unknown): value is MobileIntent {
  if (!isRecord(value)) return false
  if (value.v !== MOBILE_PROTOCOL_VERSION) return false
  if (!boundedString(value.intentId, 120)) return false
  switch (value.kind) {
    case "attach":
    case "detach":
    case "unlock":
    case "stop":
    case "delete":
      return boundedString(value.sessionId, 120)
    case "sync":
    case "ping":
    case "stopAll":
      return true
    case "command":
      return boundedString(value.sessionId, 120) &&
        boundedString(value.text, MOBILE_FRAME_LIMITS.maxIntentTextLength)
    case "keys":
      return boundedString(value.sessionId, 120) &&
        boundedArray(value.actions, MOBILE_FRAME_LIMITS.maxKeyActions) &&
        (value.actions as readonly unknown[]).every(isKeyAction)
    case "history":
      return boundedString(value.sessionId, 120) &&
        nonNegativeInteger(value.before) &&
        positiveNumber(value.limit) &&
        (value.limit as number) <= MOBILE_FRAME_LIMITS.maxHistoryLines
    case "rename":
      return boundedString(value.sessionId, 120) &&
        boundedString(value.title, MOBILE_FRAME_LIMITS.maxTitleLength)
    case "releaseGrid":
      return boundedString(value.sessionId, 120)
    case "resize":
      return boundedString(value.sessionId, 120) &&
        boundedCols(value.cols) && boundedRows(value.rows) &&
        boundedString(value.deviceLabel, MOBILE_FRAME_LIMITS.maxDeviceLabelLength)
    case "create":
      return boundedString(value.groupId, 120) &&
        (value.title === undefined || boundedString(value.title, MOBILE_FRAME_LIMITS.maxTitleLength)) &&
        // 尺寸要么两个都给，要么都不给：只给一半的网格没有意义。
        resizeShape(value.cols, value.rows) &&
        (value.deviceLabel === undefined ||
          boundedString(value.deviceLabel, MOBILE_FRAME_LIMITS.maxDeviceLabelLength))
    case "launchCommand":
      return boundedString(value.groupId, 120) && boundedString(value.commandId, 120)
    case "asrSign":
      return value.engineModelType === undefined ||
        boundedString(value.engineModelType, MOBILE_FRAME_LIMITS.maxEngineModelTypeLength)
    case "fileUpload":
      return boundedString(value.sessionId, 120) &&
        boundedString(value.driveItemId, MOBILE_FRAME_LIMITS.maxUploadDriveItemIdLength) &&
        boundedString(value.fileName, MOBILE_FRAME_LIMITS.maxRelayedFileNameLength)
    default:
      return false
  }
}

export function isMobileIntentResult(value: unknown): value is MobileIntentResult {
  if (!isRecord(value)) return false
  if (!boundedString(value.intentId, 120)) return false
  if (value.outcome !== "accepted" && value.outcome !== "rejected" && value.outcome !== "no_op") return false
  if (value.code !== undefined && !boundedString(value.code, 80)) return false
  if (value.message !== undefined && !boundedString(value.message, 500)) return false
  if (value.sessionId !== undefined && !boundedString(value.sessionId, 120)) return false
  if (value.createdSessionId !== undefined && !boundedString(value.createdSessionId, 120)) return false
  if (value.landedPath !== undefined && !boundedString(value.landedPath, 512)) return false
  if (value.signedAsrUrl !== undefined &&
    !boundedString(value.signedAsrUrl, MOBILE_FRAME_LIMITS.maxSignedAsrUrlLength)) return false
  if (value.asrVoiceId !== undefined &&
    !boundedString(value.asrVoiceId, MOBILE_FRAME_LIMITS.maxAsrVoiceIdLength)) return false
  if (value.asrExpiresAt !== undefined && !nonNegativeInteger(value.asrExpiresAt)) return false
  return true
}

export function isMobileKey(value: unknown): value is MobileKey {
  return typeof value === "string" && (MOBILE_KEYS as readonly string[]).includes(value)
}

function isKeyAction(value: unknown): value is MobileKeyAction {
  if (!isRecord(value)) return false
  if (value.type === "key") return isMobileKey(value.key)
  if (value.type === "text") return boundedString(value.text, MOBILE_FRAME_LIMITS.maxIntentTextLength)
  return false
}

function isCursor(value: unknown): value is MobileTerminalCursor {
  if (!isRecord(value)) return false
  return nonNegativeInteger(value.row) &&
    nonNegativeInteger(value.col) &&
    typeof value.visible === "boolean"
}

function isLineWire(value: unknown): value is MobileLineWire {
  if (!Array.isArray(value) || value.length === 0 || value.length > 2) return false
  if (typeof value[0] !== "string" || value[0].length > MOBILE_FRAME_LIMITS.maxLineLength) return false
  if (value.length === 1) return true
  const runs = value[1]
  if (!boundedArray(runs, MOBILE_FRAME_LIMITS.maxRunsPerLine)) return false
  return (runs as readonly unknown[]).every(isRunWire)
}

function isRunWire(value: unknown): value is MobileRunWire {
  if (!Array.isArray(value) || value.length !== 5) return false
  const [start, length, foreground, background, flags] = value as readonly unknown[]
  return nonNegativeInteger(start) &&
    positiveNumber(length) &&
    isFiniteInteger(foreground) &&
    isFiniteInteger(background) &&
    nonNegativeInteger(flags)
}

function isSummaryGroup(value: unknown): value is MobileSummaryGroup {
  return isRecord(value) &&
    boundedString(value.id, MOBILE_FRAME_LIMITS.maxSummaryIdLength) &&
    boundedString(value.name, MOBILE_FRAME_LIMITS.maxSummaryGroupNameLength)
}

function isSummaryWorkspacePane(value: unknown): value is MobileSummaryWorkspacePane {
  if (!isRecord(value)) return false
  return boundedString(value.paneId, MOBILE_FRAME_LIMITS.maxSummaryIdLength) &&
    boundedString(value.sessionId, MOBILE_FRAME_LIMITS.maxSummaryIdLength)
}

function isSummaryWorkspace(value: unknown): value is MobileSummaryWorkspace {
  if (!isRecord(value)) return false
  if (!boundedString(value.id, MOBILE_FRAME_LIMITS.maxSummaryIdLength)) return false
  if (!boundedString(value.groupId, MOBILE_FRAME_LIMITS.maxSummaryIdLength)) return false
  if (!boundedString(value.title, MOBILE_FRAME_LIMITS.maxTitleLength)) return false
  // A tab with no panes would name nothing, so it is not a tab the phone could draw.
  if (!boundedArray(value.panes, MOBILE_FRAME_LIMITS.maxSummaryWorkspacePanes)) return false
  if ((value.panes as readonly unknown[]).length === 0) return false
  return (value.panes as readonly unknown[]).every(isSummaryWorkspacePane)
}

function isSummarySession(value: unknown): value is MobileSummarySession {
  if (!isRecord(value)) return false
  if (!boundedString(value.id, MOBILE_FRAME_LIMITS.maxSummaryIdLength)) return false
  if (!boundedString(value.groupId, MOBILE_FRAME_LIMITS.maxSummaryIdLength)) return false
  if (!boundedString(value.title, MOBILE_FRAME_LIMITS.maxTitleLength)) return false
  if (!isSummaryStatus(value.status)) return false
  if (!isSummaryAttention(value.attention)) return false
  // Unlike the fields above these may legitimately be empty: a session whose
  // directory is unknown, or that has not printed anything yet.
  if (!boundedText(value.cwd, MOBILE_FRAME_LIMITS.maxSummaryCwdLength)) return false
  if (!positiveNumber(value.cols) || !positiveNumber(value.rows)) return false
  if (!boundedString(value.startedAt, MOBILE_FRAME_LIMITS.maxSummaryStartedAtLength)) return false
  if (!boundedText(value.lastLine, MOBILE_FRAME_LIMITS.maxSummaryLastLineLength)) return false
  if (!nonNegativeInteger(value.lastOutputSeq)) return false
  return true
}

function isSummaryStatus(value: unknown): value is MobileSummarySession["status"] {
  return value === "running" || value === "stopping" || value === "ended" ||
    value === "failed" || value === "lost"
}

function isSummaryAttention(value: unknown): value is MobileSummaryAttention {
  if (!isRecord(value)) return false
  if (value.state !== "waiting" && value.state !== "not_waiting" && value.state !== "unknown") return false
  return value.kind === "shell_ready" || value.kind === "agent_question" || value.kind === "approval" ||
    value.kind === "password" || value.kind === "other_interaction" || value.kind === "unknown"
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === "object" && !Array.isArray(value)
}

function nonEmptyString(value: unknown): value is string {
  return typeof value === "string" && value.trim().length > 0
}

function boundedString(value: unknown, maxLength: number): value is string {
  return nonEmptyString(value) && value.length <= maxLength
}

/** Like `boundedString`, but empty is a legitimate value. */
function boundedText(value: unknown, maxLength: number): value is string {
  return typeof value === "string" && value.length <= maxLength
}

function positiveNumber(value: unknown): value is number {
  return typeof value === "number" && Number.isFinite(value) && value > 0
}

function isFiniteInteger(value: unknown): value is number {
  return typeof value === "number" && Number.isSafeInteger(value)
}

function nonNegativeInteger(value: unknown): value is number {
  return typeof value === "number" && Number.isSafeInteger(value) && value >= 0
}

function boundedArray(value: unknown, maxLength: number): value is readonly unknown[] {
  return Array.isArray(value) && value.length <= maxLength
}

function boundedCols(value: unknown): value is number {
  return nonNegativeInteger(value) && value > 0 && value <= MOBILE_FRAME_LIMITS.maxResizeCols
}

function boundedRows(value: unknown): value is number {
  return nonNegativeInteger(value) && value > 0 && value <= MOBILE_FRAME_LIMITS.maxResizeRows
}

/** Dimensions travel as a pair; half a grid is not a grid. */
function resizeShape(cols: unknown, rows: unknown): boolean {
  if (cols === undefined && rows === undefined) return true
  return boundedCols(cols) && boundedRows(rows)
}
