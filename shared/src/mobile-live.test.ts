import { describe, expect, it } from "vitest"
import {
  LIVE_MESSAGE_TYPES,
  createLiveEnvelope,
  isLiveDesktopClientMessage,
  isLiveDesktopServerMessage,
  isLiveMobileServerMessage,
} from "./live.js"
import {
  MOBILE_DEFAULT_COLOR,
  MOBILE_FRAME_LIMITS,
  MOBILE_KEYS,
  MOBILE_PROTOCOL_VERSION,
  MOBILE_RUN_FLAGS,
  MOBILE_TRUECOLOR_BASE,
  encodeMobileTruecolor,
  isMobileFramePayload,
  isMobileIntent,
  isMobileIntentResult,
  isMobileSummaryPayload,
  isMobileTerminalFrame,
  isMobileTransferProgressPayload,
  type MobileIntent,
  type MobileSummaryAgentGroup,
  type MobileSummaryAgentProvider,
  type MobileSummaryPayload,
  type MobileSummaryWorkspace,
  type MobileTerminalFrame,
} from "./mobile-live.js"

const envelopeMeta = { id: "msg-1", sentAt: "2026-09-15T10:00:00.000Z" }

function frame(overrides: Partial<MobileTerminalFrame> = {}): MobileTerminalFrame {
  return {
    v: MOBILE_PROTOCOL_VERSION,
    sessionId: "sess-1",
    kind: "suffix",
    from: 0,
    lines: [["hello"]],
    total: 1,
    cursor: { row: 0, col: 5, visible: true },
    alt: false,
    truncated: false,
    seq: 3,
    sizeRevision: 1,
    ...overrides,
  }
}

function summary(overrides: Partial<MobileSummaryPayload> = {}): MobileSummaryPayload {
  return {
    desktopClientInstanceId: "desktop-1",
    desktopName: "MacBook Pro",
    revision: 1,
    groups: [{ id: "g1", name: "前端开发" }],
    sessions: [{
      id: "sess-1",
      groupId: "g1",
      title: "dev-server",
      status: "running",
      attention: { state: "not_waiting", kind: "unknown" },
      cwd: "/Users/liy/code",
      cols: 80,
      rows: 24,
      startedAt: "2026-09-15T09:00:00.000Z",
      lastLine: "ready in 312 ms",
      lastOutputSeq: 12,
    }],
    ...overrides,
  }
}

describe("mobile live protocol", () => {
  it("routes mobile messages through the desktop live whitelist", () => {
    // The desktop drops anything the shared guard rejects, so a missing case here
    // would silently disable the whole feature rather than fail loudly.
    expect(isLiveDesktopClientMessage(createLiveEnvelope(
      LIVE_MESSAGE_TYPES.mobileSummary,
      summary(),
      envelopeMeta,
    ))).toBe(true)

    expect(isLiveDesktopClientMessage(createLiveEnvelope(
      LIVE_MESSAGE_TYPES.mobileFrame,
      { desktopClientInstanceId: "desktop-1", mobileClientInstanceId: "phone-1", frame: frame() },
      envelopeMeta,
    ))).toBe(true)

    expect(isLiveDesktopClientMessage(createLiveEnvelope(
      LIVE_MESSAGE_TYPES.mobileIntentResult,
      { mobileClientInstanceId: "phone-1", result: { intentId: "i1", outcome: "accepted" } },
      envelopeMeta,
    ))).toBe(true)

    expect(isLiveDesktopClientMessage(createLiveEnvelope(
      LIVE_MESSAGE_TYPES.mobileTransferProgress,
      { mobileClientInstanceId: "phone-1", intentId: "i1", completedBytes: 0, totalBytes: 0 },
      envelopeMeta,
    ))).toBe(true)

    // The desktop sends progress and the phone receives it, so the phone's own
    // whitelist is the one this has to clear.
    expect(isLiveMobileServerMessage(createLiveEnvelope(
      LIVE_MESSAGE_TYPES.mobileTransferProgress,
      { mobileClientInstanceId: "phone-1", intentId: "i1", completedBytes: 512, totalBytes: 4096 },
      envelopeMeta,
    ))).toBe(true)

    expect(isLiveDesktopServerMessage(createLiveEnvelope(
      LIVE_MESSAGE_TYPES.mobileIntent,
      {
        desktopClientInstanceId: "desktop-1",
        mobileClientInstanceId: "phone-1",
        intent: { v: MOBILE_PROTOCOL_VERSION, intentId: "i1", kind: "sync" },
      },
      envelopeMeta,
    ))).toBe(true)
  })

  it("accepts compact lines with and without style runs", () => {
    expect(isMobileTerminalFrame(frame({ lines: [["plain"], ["styled", [[0, 6, 2, -1, 1]]]] }))).toBe(true)
  })

  it("rejects malformed frames", () => {
    expect(isMobileTerminalFrame(frame({ v: 2 as unknown as typeof MOBILE_PROTOCOL_VERSION }))).toBe(false)
    expect(isMobileTerminalFrame(frame({ from: -1 }))).toBe(false)
    expect(isMobileTerminalFrame(frame({ kind: "patch" as unknown as "suffix" }))).toBe(false)
    expect(isMobileTerminalFrame(frame({ lines: [[] as unknown as readonly [string]] }))).toBe(false)
    expect(isMobileTerminalFrame(frame({ cursor: { row: 0, col: 0 } as unknown as MobileTerminalFrame["cursor"] })))
      .toBe(false)
  })

  it("bounds frames at the socket budget", () => {
    const tooMany = new Array<readonly [string]>(MOBILE_FRAME_LIMITS.maxLinesPerFrame + 1).fill(["x"])
    expect(isMobileTerminalFrame(frame({ lines: tooMany }))).toBe(false)

    const tooLong = frame({ lines: [[ "x".repeat(MOBILE_FRAME_LIMITS.maxLineLength + 1) ]] })
    expect(isMobileTerminalFrame(tooLong)).toBe(false)

    const tooManyRuns = frame({
      lines: [["x", new Array(MOBILE_FRAME_LIMITS.maxRunsPerLine + 1).fill([0, 1, -1, -1, 0])]],
    })
    expect(isMobileTerminalFrame(tooManyRuns)).toBe(false)
  })

  it("validates each intent shape and its required fields", () => {
    expect(isMobileIntent({ v: 1, intentId: "i1", kind: "sync" })).toBe(true)
    expect(isMobileIntent({ v: 1, intentId: "i1", kind: "stopAll" })).toBe(true)
    expect(isMobileIntent({ v: 1, intentId: "i1", kind: "attach", sessionId: "s1" })).toBe(true)
    expect(isMobileIntent({ v: 1, intentId: "i1", kind: "command", sessionId: "s1", text: "ls" })).toBe(true)
    expect(isMobileIntent({
      v: 1,
      intentId: "i1",
      kind: "keys",
      sessionId: "s1",
      actions: [{ type: "key", key: "Ctrl+C" }, { type: "text", text: "y" }],
    })).toBe(true)
    expect(isMobileIntent({ v: 1, intentId: "i1", kind: "create", groupId: "g1" })).toBe(true)
    expect(isMobileIntent({ v: 1, intentId: "i1", kind: "rename", sessionId: "s1", title: "api" })).toBe(true)
    expect(isMobileIntent({ v: 1, intentId: "i1", kind: "delete", sessionId: "s1" })).toBe(true)

    expect(isMobileIntent({ v: 1, intentId: "i1", kind: "attach" })).toBe(false)
    // A delete has to name the terminal it removes, like every other
    // session-scoped intent.
    expect(isMobileIntent({ v: 1, intentId: "i1", kind: "delete" })).toBe(false)
    expect(isMobileIntent({ v: 1, intentId: "i1", kind: "command", sessionId: "s1" })).toBe(false)
    expect(isMobileIntent({ v: 1, intentId: "i1", kind: "keys", sessionId: "s1", actions: [{ type: "key", key: "Ctrl+Z" }] }))
      .toBe(false)
    expect(isMobileIntent({ v: 1, intentId: "i1", kind: "close", sessionId: "s1" })).toBe(false)
    // A raw control byte must never be expressible as a key.
    expect(isMobileIntent({ v: 1, intentId: "i1", kind: "keys", sessionId: "s1", actions: [{ type: "key", key: "" }] }))
      .toBe(false)
  })

  it("validates the resize intent and its grid bounds", () => {
    expect(isMobileIntent({
      v: 1, intentId: "i1", kind: "resize",
      sessionId: "s1", cols: 54, rows: 37, deviceLabel: "iPhone",
    })).toBe(true)

    // Every part is load-bearing. A resize with no terminal, no grid, or no name
    // for the device claiming it cannot be acted on or reported.
    expect(isMobileIntent({ v: 1, intentId: "i1", kind: "resize", cols: 54, rows: 37, deviceLabel: "iPhone" })).toBe(false)
    expect(isMobileIntent({ v: 1, intentId: "i1", kind: "resize", sessionId: "s1", rows: 37, deviceLabel: "iPhone" })).toBe(false)
    expect(isMobileIntent({ v: 1, intentId: "i1", kind: "resize", sessionId: "s1", cols: 54, deviceLabel: "iPhone" })).toBe(false)
    expect(isMobileIntent({ v: 1, intentId: "i1", kind: "resize", sessionId: "s1", cols: 54, rows: 37 })).toBe(false)

    // The ceiling restates the terminal capability's own, so a request refused
    // here is one the service would have refused anyway.
    expect(isMobileIntent({
      v: 1, intentId: "i1", kind: "resize", sessionId: "s1",
      cols: MOBILE_FRAME_LIMITS.maxResizeCols + 1, rows: 37, deviceLabel: "iPhone",
    })).toBe(false)
    expect(isMobileIntent({
      v: 1, intentId: "i1", kind: "resize", sessionId: "s1",
      cols: 54, rows: MOBILE_FRAME_LIMITS.maxResizeRows + 1, deviceLabel: "iPhone",
    })).toBe(false)

    // A grid is whole cells, and no terminal has zero of either dimension.
    expect(isMobileIntent({
      v: 1, intentId: "i1", kind: "resize", sessionId: "s1", cols: 54.5, rows: 37, deviceLabel: "iPhone",
    })).toBe(false)
    expect(isMobileIntent({
      v: 1, intentId: "i1", kind: "resize", sessionId: "s1", cols: 0, rows: 37, deviceLabel: "iPhone",
    })).toBe(false)
    expect(isMobileIntent({
      v: 1, intentId: "i1", kind: "resize", sessionId: "s1", cols: 54, rows: -1, deviceLabel: "iPhone",
    })).toBe(false)
    expect(isMobileIntent({
      v: 1, intentId: "i1", kind: "resize", sessionId: "s1", cols: 54, rows: 37,
      deviceLabel: "x".repeat(MOBILE_FRAME_LIMITS.maxDeviceLabelLength + 1),
    })).toBe(false)
  })

  it("validates the file upload intent against both name and item bounds", () => {
    expect(isMobileIntent({
      v: 1, intentId: "i1", kind: "fileUpload",
      sessionId: "s1", driveItemId: "clx0abc123", fileName: "报错截图.png",
    })).toBe(true)

    // All three name something the desktop cannot do the job without: where to
    // type, what to fetch, and what to call the result.
    expect(isMobileIntent({ v: 1, intentId: "i1", kind: "fileUpload", driveItemId: "clx0abc123", fileName: "a.png" }))
      .toBe(false)
    expect(isMobileIntent({ v: 1, intentId: "i1", kind: "fileUpload", sessionId: "s1", fileName: "a.png" }))
      .toBe(false)
    expect(isMobileIntent({ v: 1, intentId: "i1", kind: "fileUpload", sessionId: "s1", driveItemId: "clx0abc123" }))
      .toBe(false)
    // An empty name is not a name the desktop could write.
    expect(isMobileIntent({
      v: 1, intentId: "i1", kind: "fileUpload", sessionId: "s1", driveItemId: "clx0abc123", fileName: "",
    })).toBe(false)

    expect(isMobileIntent({
      v: 1, intentId: "i1", kind: "fileUpload", sessionId: "s1", driveItemId: "clx0abc123",
      fileName: "x".repeat(MOBILE_FRAME_LIMITS.maxRelayedFileNameLength + 1),
    })).toBe(false)
    expect(isMobileIntent({
      v: 1, intentId: "i1", kind: "fileUpload", sessionId: "s1",
      driveItemId: "x".repeat(MOBILE_FRAME_LIMITS.maxUploadDriveItemIdLength + 1), fileName: "a.png",
    })).toBe(false)
  })

  it("accepts a grid release, and only with a terminal to release", () => {
    expect(isMobileIntent({ v: 1, intentId: "i1", kind: "releaseGrid", sessionId: "s1" })).toBe(true)
    // Handing back a grid nobody named is not expressible.
    expect(isMobileIntent({ v: 1, intentId: "i1", kind: "releaseGrid" })).toBe(false)
  })

  it("accepts starting dimensions on create only as a pair", () => {
    expect(isMobileIntent({
      v: 1, intentId: "i1", kind: "create", groupId: "g1", cols: 54, rows: 37, deviceLabel: "iPhone",
    })).toBe(true)
    // Optional, so a phone that never sends them still creates a terminal.
    expect(isMobileIntent({ v: 1, intentId: "i1", kind: "create", groupId: "g1" })).toBe(true)
    expect(isMobileIntent({ v: 1, intentId: "i1", kind: "create", groupId: "g1", title: "api", cols: 80, rows: 24 })).toBe(true)

    // Half a grid is not a grid — the PTY has to be born some shape.
    expect(isMobileIntent({ v: 1, intentId: "i1", kind: "create", groupId: "g1", cols: 54 })).toBe(false)
    expect(isMobileIntent({ v: 1, intentId: "i1", kind: "create", groupId: "g1", rows: 37 })).toBe(false)
    // Same ceiling as an explicit resize, because that is what it becomes.
    expect(isMobileIntent({
      v: 1, intentId: "i1", kind: "create", groupId: "g1",
      cols: MOBILE_FRAME_LIMITS.maxResizeCols + 1, rows: 37,
    })).toBe(false)
  })

  it("validates starting a Claude Code conversation, where the Provider choice is whole or absent", () => {
    expect(isMobileIntent({ v: 1, intentId: "i1", kind: "createAgentConversation", projectId: "p1" })).toBe(true)
    expect(isMobileIntent({
      v: 1, intentId: "i1", kind: "createAgentConversation",
      projectId: "p1", providerId: "anthropic", modelTier: "opus",
    })).toBe(true)
    expect(isMobileIntent({
      v: 1, intentId: "i1", kind: "createAgentConversation", projectId: "p1",
      cols: 54, rows: 37, deviceLabel: "iPhone",
    })).toBe(true)

    // The project is the one thing the desktop cannot supply: its own shortcut
    // reads it off the sidebar row a phone's `＋` does not have.
    expect(isMobileIntent({ v: 1, intentId: "i1", kind: "createAgentConversation" })).toBe(false)
    expect(isMobileIntent({ v: 1, intentId: "i1", kind: "createAgentConversation", projectId: "" })).toBe(false)

    // Half a choice is not a choice. A Provider with no tier names no model, and a
    // tier with no Provider names no endpoint, so neither is expressible — the
    // desktop would otherwise have to guess which half the phone meant.
    expect(isMobileIntent({
      v: 1, intentId: "i1", kind: "createAgentConversation", projectId: "p1", providerId: "anthropic",
    })).toBe(false)
    expect(isMobileIntent({
      v: 1, intentId: "i1", kind: "createAgentConversation", projectId: "p1", modelTier: "opus",
    })).toBe(false)

    // A tier is one of four names the desktop resolves; anything else is not a
    // selection the terminal service could look up.
    expect(isMobileIntent({
      v: 1, intentId: "i1", kind: "createAgentConversation",
      projectId: "p1", providerId: "anthropic", modelTier: "gpt",
    })).toBe(false)
    expect(isMobileIntent({
      v: 1, intentId: "i1", kind: "createAgentConversation",
      projectId: "p1", providerId: "anthropic", modelTier: "Auto",
    })).toBe(false)

    // Same pair rule as `create`: the PTY has to be born some shape, and Claude
    // Code's banner keeps whatever width it had (ADR 0063).
    expect(isMobileIntent({
      v: 1, intentId: "i1", kind: "createAgentConversation", projectId: "p1", cols: 54,
    })).toBe(false)
    expect(isMobileIntent({
      v: 1, intentId: "i1", kind: "createAgentConversation", projectId: "p1", rows: 37,
    })).toBe(false)
    expect(isMobileIntent({
      v: 1, intentId: "i1", kind: "createAgentConversation", projectId: "p1",
      cols: MOBILE_FRAME_LIMITS.maxResizeCols + 1, rows: 37,
    })).toBe(false)
    expect(isMobileIntent({
      v: 1, intentId: "i1", kind: "createAgentConversation", projectId: "p1",
      cols: 54, rows: 37, deviceLabel: "x".repeat(MOBILE_FRAME_LIMITS.maxDeviceLabelLength + 1),
    })).toBe(false)

    // A near-miss kind is not a kind. This is the `default: return false` that the
    // upgrade order exists for — an unknown kind is dropped at the edge in silence,
    // so a new phone talking to an older desktop waits out a timeout rather than
    // being told why. Pinned here so it stays a decision rather than an accident.
    expect(isMobileIntent({
      v: 1, intentId: "i1", kind: "createAgentConversations", projectId: "p1",
    })).toBe(false)

    // The guard is shallow on purpose — it exists to bound what the relay is asked
    // to carry, not to be a schema — so an extra field rides along unread rather
    // than failing an intent the desktop could have executed.
    expect(isMobileIntent({
      v: 1, intentId: "i1", kind: "createAgentConversation", projectId: "p1", tier: "opus",
    })).toBe(true)
  })

  it("bounds intent text", () => {
    expect(isMobileIntent({
      v: 1,
      intentId: "i1",
      kind: "command",
      sessionId: "s1",
      text: "x".repeat(MOBILE_FRAME_LIMITS.maxIntentTextLength + 1),
    })).toBe(false)
  })

  it("validates intent results and rejects unknown outcomes", () => {
    expect(isMobileIntentResult({ intentId: "i1", outcome: "accepted" })).toBe(true)
    expect(isMobileIntentResult({ intentId: "i1", outcome: "rejected", code: "lease_busy", message: "桌面正在输入" }))
      .toBe(true)
    expect(isMobileIntentResult({ intentId: "i1", outcome: "maybe" })).toBe(false)
    expect(isMobileIntentResult({ outcome: "accepted" })).toBe(false)
  })

  it("validates transfer progress, where a zero total is a statement rather than a missing field", () => {
    const progress = (overrides: Record<string, unknown> = {}) => ({
      mobileClientInstanceId: "phone-1",
      intentId: "i1",
      completedBytes: 512,
      totalBytes: 4096,
      ...overrides,
    })

    expect(isMobileTransferProgressPayload(progress())).toBe(true)
    // Zero means "this download declared no length". The phone draws a moving
    // indicator for it instead of a bar, so it has to survive the guard.
    expect(isMobileTransferProgressPayload(progress({ completedBytes: 0, totalBytes: 0 }))).toBe(true)

    expect(isMobileTransferProgressPayload(progress({ completedBytes: -1 }))).toBe(false)
    expect(isMobileTransferProgressPayload(progress({ totalBytes: 1.5 }))).toBe(false)
    expect(isMobileTransferProgressPayload(progress({ completedBytes: "512" }))).toBe(false)
    expect(isMobileTransferProgressPayload(progress({ intentId: "" }))).toBe(false)
    expect(isMobileTransferProgressPayload(progress({ intentId: undefined }))).toBe(false)
    expect(isMobileTransferProgressPayload(progress({ mobileClientInstanceId: undefined }))).toBe(false)
  })

  it("validates the summary and every session inside it", () => {
    expect(isMobileSummaryPayload(summary())).toBe(true)
    expect(isMobileSummaryPayload({ ...summary(), revision: -1 })).toBe(false)
    expect(isMobileSummaryPayload({
      ...summary(),
      sessions: [{ ...summary().sessions[0], status: "paused" }],
    })).toBe(false)
    expect(isMobileSummaryPayload({
      ...summary(),
      sessions: [{ ...summary().sessions[0], attention: { state: "waiting", kind: "vibes" } }],
    })).toBe(false)
  })

  it("rejects a summary once any one of its fields outgrows the wire bound", () => {
    const session = summary().sessions[0]
    const group = summary().groups[0]
    expect(isMobileSummaryPayload(summary({
      sessions: [{ ...session, cwd: "c".repeat(MOBILE_FRAME_LIMITS.maxSummaryCwdLength) }],
    }))).toBe(true)
    expect(isMobileSummaryPayload(summary({
      sessions: [{ ...session, cwd: "c".repeat(MOBILE_FRAME_LIMITS.maxSummaryCwdLength + 1) }],
    }))).toBe(false)
    expect(isMobileSummaryPayload(summary({
      groups: [{ ...group, name: "n".repeat(MOBILE_FRAME_LIMITS.maxSummaryGroupNameLength + 1) }],
    }))).toBe(false)
    expect(isMobileSummaryPayload(summary({
      sessions: [{
        ...session,
        lastLine: "l".repeat(MOBILE_FRAME_LIMITS.maxSummaryLastLineLength + 1),
        startedAt: "2".repeat(MOBILE_FRAME_LIMITS.maxSummaryStartedAtLength + 1),
        id: "s".repeat(MOBILE_FRAME_LIMITS.maxSummaryIdLength + 1),
      }],
    }))).toBe(false)
    // Empty is a legitimate value for a preview, and for a directory we cannot name.
    expect(isMobileSummaryPayload(summary({
      sessions: [{ ...session, cwd: "", lastLine: "" }],
    }))).toBe(true)
  })

  it("carries the phone owning a session's grid, and tolerates its absence", () => {
    // The desktop's own layout decides most terminals, and saying so costs a field
    // on every session of the one message that cannot be split — so an unowned
    // session omits it rather than sending a null.
    expect(isMobileSummaryPayload(summary())).toBe(true)

    const owned = summary({
      sessions: [{ ...summary().sessions[0], gridOwnerId: "a".repeat(MOBILE_FRAME_LIMITS.maxSummaryGridOwnerIdLength) }],
    })
    expect(isMobileSummaryPayload(owned)).toBe(true)

    const tooLong = summary({
      sessions: [{ ...summary().sessions[0], gridOwnerId: "a".repeat(MOBILE_FRAME_LIMITS.maxSummaryGridOwnerIdLength + 1) }],
    })
    expect(isMobileSummaryPayload(tooLong)).toBe(false)
    // Empty names no phone, which is what absence already says.
    expect(isMobileSummaryPayload(summary({
      sessions: [{ ...summary().sessions[0], gridOwnerId: "" }],
    }))).toBe(false)
  })

  it("keeps the largest summary the wire admits inside the declared budget", () => {
    /*
     * A summary is the one message a phone cannot reassemble: it replaces the whole
     * list with whatever arrives, so an oversized one is not a truncated view but a
     * dead socket. The desktop producer clamps to exactly these limits, which makes
     * this the widest summary that can ever exist — so if it fits, every summary fits.
     */
    const limits = MOBILE_FRAME_LIMITS
    const payload: MobileSummaryPayload = {
      desktopClientInstanceId: "d".repeat(120),
      desktopName: "d".repeat(120),
      revision: 1,
      groups: Array.from({ length: limits.maxSummaryGroups }, () => ({
        id: "g".repeat(limits.maxSummaryIdLength),
        name: "n".repeat(limits.maxSummaryGroupNameLength),
      })),
      sessions: Array.from({ length: limits.maxSummarySessions }, () => ({
        id: "s".repeat(limits.maxSummaryIdLength),
        groupId: "g".repeat(limits.maxSummaryIdLength),
        title: "t".repeat(limits.maxTitleLength),
        status: "stopping" as const,
        attention: { state: "not_waiting" as const, kind: "other_interaction" as const },
        cwd: "c".repeat(limits.maxSummaryCwdLength),
        cols: 500,
        rows: 200,
        startedAt: "2".repeat(limits.maxSummaryStartedAtLength),
        lastLine: "l".repeat(limits.maxSummaryLastLineLength),
        lastOutputSeq: 999_999_999,
        // Every session owned at once is unreachable — a grid has one owner and a
        // phone claims what it is looking at — but the budget has to hold for the
        // widest summary the wire admits, not the widest one this app produces.
        gridOwnerId: "o".repeat(limits.maxSummaryGridOwnerIdLength),
      })),
      // The directories count here for the same reason the sessions do: the budget
      // is a property of the wire, and the wire admits these at their own bounds.
      agentGroups: Array.from({ length: limits.maxSummaryAgentGroups }, () => ({
        projectId: "p".repeat(limits.maxSummaryIdLength),
        name: "n".repeat(limits.maxSummaryAgentNameLength),
        isDefault: false,
      })),
      agentProviders: Array.from({ length: limits.maxSummaryAgentProviders }, () => ({
        id: "v".repeat(limits.maxSummaryIdLength),
        name: "n".repeat(limits.maxSummaryAgentNameLength),
        isDefault: false,
        models: {
          default: "m".repeat(limits.maxSummaryModelNameLength),
          opus: "m".repeat(limits.maxSummaryModelNameLength),
          sonnet: "m".repeat(limits.maxSummaryModelNameLength),
          haiku: "m".repeat(limits.maxSummaryModelNameLength),
        },
      })),
    }

    expect(isMobileSummaryPayload(payload)).toBe(true)
    expect(Buffer.byteLength(JSON.stringify(payload), "utf8")).toBeLessThanOrEqual(limits.maxSummaryBytes)
  })

  it("treats the tab layer as optional and validates it when a producer sends one", () => {
    // Absent is the normal case: with no splits the flat list is the hierarchy, and
    // a client that ignores the field must keep working exactly as it did before.
    expect(isMobileSummaryPayload(summary())).toBe(true)

    const tab: MobileSummaryWorkspace = {
      id: "workspace-1",
      groupId: "g1",
      title: "前端开发",
      panes: [{ paneId: "pane-1", sessionId: "sess-1" }],
    }
    expect(isMobileSummaryPayload(summary({ workspaces: [tab] }))).toBe(true)

    const malformed = [
      // A tab that names no pane is not something the phone could draw.
      { ...tab, panes: [] },
      // A pane without its conversation.
      { ...tab, panes: [{ paneId: "pane-1" }] },
      { ...tab, title: "" },
      { ...tab, id: "w".repeat(MOBILE_FRAME_LIMITS.maxSummaryIdLength + 1) },
      {
        ...tab,
        panes: Array.from(
          { length: MOBILE_FRAME_LIMITS.maxSummaryWorkspacePanes + 1 },
          (_, index) => ({ paneId: `pane-${index}`, sessionId: `sess-${index}` }),
        ),
      },
    ]
    for (const workspace of malformed) {
      expect(isMobileSummaryPayload(summary({
        workspaces: [workspace] as unknown as readonly MobileSummaryWorkspace[],
      }))).toBe(false)
    }
    expect(isMobileSummaryPayload(summary({
      workspaces: Array.from(
        { length: MOBILE_FRAME_LIMITS.maxSummaryWorkspaces + 1 },
        () => tab,
      ),
    }))).toBe(false)
  })

  it("carries the project and Provider directories, and treats their absence as a desktop that predates them", () => {
    // Absent is the older desktop, and it has to keep working: this guard is the
    // only gate between a computer's summary and a phone's list.
    expect(isMobileSummaryPayload(summary())).toBe(true)

    // "This computer has no projects" is a different answer from "this computer is
    // too old to say", so an empty block stays on the wire and is accepted.
    expect(isMobileSummaryPayload(summary({ agentGroups: [], agentProviders: [] }))).toBe(true)

    const group: MobileSummaryAgentGroup = { projectId: "p1", name: "Synapse", isDefault: true }
    const provider: MobileSummaryAgentProvider = {
      id: "anthropic",
      name: "Anthropic 官方",
      isDefault: false,
      models: { default: "claude-sonnet-4-5", opus: "claude-opus-4-5" },
    }
    expect(isMobileSummaryPayload(summary({ agentGroups: [group], agentProviders: [provider] }))).toBe(true)

    const malformedGroups = [
      { projectId: "", name: "Synapse", isDefault: true },
      { projectId: "p1", name: "", isDefault: true },
      { projectId: "p1", name: "Synapse" },
      { projectId: "p1", name: "n".repeat(MOBILE_FRAME_LIMITS.maxSummaryAgentNameLength + 1), isDefault: true },
      { projectId: "p".repeat(MOBILE_FRAME_LIMITS.maxSummaryIdLength + 1), name: "Synapse", isDefault: true },
    ]
    for (const bad of malformedGroups) {
      expect(isMobileSummaryPayload(summary({
        agentGroups: [bad] as unknown as readonly MobileSummaryAgentGroup[],
      }))).toBe(false)
    }

    const malformedProviders = [
      // A Provider the phone could pick but not name is not a row it could draw.
      { ...provider, name: "" },
      { ...provider, id: "" },
      // A tier with no model is expressed by leaving the key out; an empty string
      // would be a model name the desktop does not have.
      { ...provider, models: { opus: "" } },
      { ...provider, models: { opus: "m".repeat(MOBILE_FRAME_LIMITS.maxSummaryModelNameLength + 1) } },
      { ...provider, models: undefined },
    ]
    for (const bad of malformedProviders) {
      expect(isMobileSummaryPayload(summary({
        agentProviders: [bad] as unknown as readonly MobileSummaryAgentProvider[],
      }))).toBe(false)
    }

    expect(isMobileSummaryPayload(summary({
      agentGroups: Array.from({ length: MOBILE_FRAME_LIMITS.maxSummaryAgentGroups + 1 }, () => group),
    }))).toBe(false)
    expect(isMobileSummaryPayload(summary({
      agentProviders: Array.from({ length: MOBILE_FRAME_LIMITS.maxSummaryAgentProviders + 1 }, () => provider),
    }))).toBe(false)
  })

  it("adds no bytes to a summary that predates the directories", () => {
    // The gateway fingerprints summaries by their serialized bytes and sends one
    // only when that string changes, so a field that appeared with a default value
    // would make every idle desktop a repeating sender. Optional-rather-than-
    // nullable is what prevents that, and this is the check that keeps it so.
    const before = summary()
    expect(Object.keys(before)).toEqual([
      "desktopClientInstanceId", "desktopName", "revision", "groups", "sessions",
    ])
    expect(Object.keys(before.sessions[0])).toEqual([
      "id", "groupId", "title", "status", "attention", "cwd", "cols", "rows",
      "startedAt", "lastLine", "lastOutputSeq",
    ])
    // The exact bytes this shape produced before either block existed. A field
    // that arrived with a default, or one made required, moves this number.
    expect(Buffer.byteLength(JSON.stringify(before), "utf8")).toBe(393)
    expect(JSON.stringify({ ...before, agentGroups: undefined })).toBe(JSON.stringify(before))
  })

  it("keeps the attachment routing fields required", () => {
    expect(isMobileFramePayload({
      desktopClientInstanceId: "desktop-1",
      mobileClientInstanceId: "phone-1",
      frame: frame(),
    })).toBe(true)
    expect(isMobileFramePayload({
      desktopClientInstanceId: "desktop-1",
      frame: frame(),
    })).toBe(false)
  })

  it("round-trips truecolor encoding without colliding with palette indices", () => {
    const packed = encodeMobileTruecolor(0x12, 0x34, 0x56)
    expect(packed).toBe(0x1000000 | 0x123456)
    expect(packed).toBeGreaterThan(0xff)
  })

  it("keeps intents assignable from a typed producer", () => {
    const intent: MobileIntent = { v: 1, intentId: "i1", kind: "rename", sessionId: "s1", title: "部署" }
    expect(isMobileIntent(intent)).toBe(true)
  })
  it("keeps the ESM constants identical to the CommonJS copy the desktop loads", async () => {
    // The Electron main process cannot import this ESM module, so the numeric
    // contract is declared twice. This is the check that keeps them in step;
    // without it a change to one side would silently desynchronise the phone
    // from the desktop in a way no type checker would notice.
    const cjs = await import("./mobile-live-constants.cjs")
    expect(cjs.MOBILE_PROTOCOL_VERSION).toBe(MOBILE_PROTOCOL_VERSION)
    expect(cjs.MOBILE_FRAME_LIMITS).toEqual(MOBILE_FRAME_LIMITS)
    expect(cjs.MOBILE_RUN_FLAGS).toEqual(MOBILE_RUN_FLAGS)
    expect(cjs.MOBILE_DEFAULT_COLOR).toBe(MOBILE_DEFAULT_COLOR)
    expect(cjs.MOBILE_TRUECOLOR_BASE).toBe(MOBILE_TRUECOLOR_BASE)
    expect([...cjs.MOBILE_KEYS]).toEqual([...MOBILE_KEYS])
  })
})
