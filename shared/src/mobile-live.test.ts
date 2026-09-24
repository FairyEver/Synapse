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
  isMobileClipboardPayload,
  isMobileFramePayload,
  isMobileIntent,
  isMobileIntentResult,
  isMobileGitStatusPayload,
  isMobileGroupCommandsPayload,
  isMobileQuickPhrasesPayload,
  isMobileSummaryPayload,
  isMobileTerminalFrame,
  isMobileToolbarPayload,
  isMobileTransferProgressPayload,
  type MobileClipboardPayload,
  type MobileGitStatusPayload,
  type MobileGroupCommandsPayload,
  type MobileIntent,
  type MobileQuickPhrasesPayload,
  type MobileSummaryAgentGroup,
  type MobileSummaryAgentProvider,
  type MobileSummaryPayload,
  type MobileSummaryWorkspace,
  type MobileTerminalFrame,
  type MobileToolbarPayload,
} from "./mobile-live.js"

const envelopeMeta = { id: "msg-1", sentAt: "2026-09-15T10:00:00.000Z" }

/** 一份最普通的 `mobile.gitStatus`：一台电脑上、一个终端当前目录的 Git 状态。 */
function gitStatusPayload(
  overrides: Partial<MobileGitStatusPayload> = {},
): MobileGitStatusPayload {
  return {
    desktopClientInstanceId: "client-a",
    mobileClientInstanceId: "phone-1",
    sessionId: "sess-1",
    revision: 1,
    status: {
      cwd: "/Users/liy/code/Synapse",
      branch: "main",
      upstream: "origin/main",
      ahead: 2,
      behind: 0,
      changeCount: 3,
      hasConflicts: false,
    },
    ...overrides,
  }
}

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

function toolbar(overrides: Partial<MobileToolbarPayload> = {}): MobileToolbarPayload {
  return {
    desktopClientInstanceId: "desktop-1",
    revision: 1,
    buttons: [
      { id: "enter", label: "回车", group: "key", action: { type: "key", key: "Enter" } },
      { id: "slash-exit", label: "/exit", group: "command", action: { type: "text", text: "/exit", pressEnter: true } },
      { id: "c1", label: "部署", group: "custom", action: { type: "text", text: "pnpm deploy", pressEnter: false } },
    ],
    ...overrides,
  }
}

function groupCommands(overrides: Partial<MobileGroupCommandsPayload> = {}): MobileGroupCommandsPayload {
  return {
    desktopClientInstanceId: "desktop-1",
    revision: 1,
    groups: [
      { groupId: "g1", commands: [{ id: "c1", name: "Claude" }, { id: "c2", name: "Codex" }] },
      { groupId: "g2", commands: [{ id: "c3", name: "小慧日报" }] },
    ],
    ...overrides,
  }
}

function quickPhrases(overrides: Partial<MobileQuickPhrasesPayload> = {}): MobileQuickPhrasesPayload {
  return {
    desktopClientInstanceId: "desktop-1",
    revision: 1,
    phrases: [
      { id: "q1", content: "用 Easy Worklog 初始化今天的工作日志" },
      { id: "q2", content: "这次改动整理成提交说明，中文，说清楚改了什么" },
    ],
    ...overrides,
  }
}

function clipboard(overrides: Partial<MobileClipboardPayload> = {}): MobileClipboardPayload {
  return {
    desktopClientInstanceId: "desktop-1",
    revision: 1,
    entries: [
      { id: "a".repeat(64), text: "pnpm mobile:install", copiedAt: "2026-09-21T10:00:00.000Z" },
      { id: "b".repeat(64), text: "这次改动整理成提交说明", copiedAt: "2026-09-21T09:58:00.000Z" },
    ],
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
    expect(isMobileTerminalFrame(frame({ lines: [["start", [], 2], ["end", [], 1]] }))).toBe(true)
    expect(isMobileTerminalFrame(frame({ lines: [["bad", [], 4]] as unknown as MobileTerminalFrame["lines"] })))
      .toBe(false)
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
    // A key the terminal service has no bytes for. `Ctrl+I` rather than a name like
    // `F13`, because it is one a client could plausibly send — it is the chord the
    // full-keyboard page draws — and it is refused precisely so that `Tab` stays the
    // only name for `\x09`. `MOBILE_KEYS` is where the boundary is written down;
    // this checks that the boundary is enforced at all. `F13` is the other shape of
    // the same thing: a name a newer panel could draw that no desktop has bytes for.
    expect(isMobileIntent({ v: 1, intentId: "i1", kind: "keys", sessionId: "s1", actions: [{ type: "key", key: "Ctrl+I" }] }))
      .toBe(false)
    expect(isMobileIntent({ v: 1, intentId: "i1", kind: "keys", sessionId: "s1", actions: [{ type: "key", key: "F13" }] }))
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
        defaultTier: "opus" as const,
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
      isDefault: true,
      defaultTier: "opus",
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
      // The tier is what makes the row's model name mean something: without it the
      // phone would have to derive one, which is exactly what it must not do.
      { ...provider, defaultTier: undefined },
      { ...provider, defaultTier: "gpt" },
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

  it("routes the toolbar through both sides of the relay", () => {
    // One guard each way, and the two failures look nothing alike from the phone:
    // rejected on the desktop's hop, the cloud answers with a 1003 close and the
    // computer simply goes offline; rejected on the phone's hop, the list never
    // arrives and every phone quietly shows its own fallback buttons.
    expect(isLiveDesktopClientMessage(createLiveEnvelope(
      LIVE_MESSAGE_TYPES.mobileToolbar,
      toolbar(),
      envelopeMeta,
    ))).toBe(true)
    expect(isLiveMobileServerMessage(createLiveEnvelope(
      LIVE_MESSAGE_TYPES.mobileToolbar,
      toolbar(),
      envelopeMeta,
    ))).toBe(true)
  })

  it("accepts both toolbar action shapes, and a computer with no buttons", () => {
    expect(isMobileToolbarPayload(toolbar())).toBe(true)
    // An empty list is a computer saying "I have none", which is a different answer
    // from the one a computer too old to send this message gives — the phone shows
    // an empty bar for the first and its own built-ins for the second.
    expect(isMobileToolbarPayload(toolbar({ buttons: [] }))).toBe(true)
    // Both text arms are legitimate: with Enter is the desktop's own click, without
    // it is a button that only types, and the flag is what tells them apart.
    expect(isMobileToolbarPayload(toolbar({
      buttons: [
        { id: "a", label: "只输入", group: "custom", action: { type: "text", text: "lsof -i :3001", pressEnter: false } },
        { id: "b", label: "执行", group: "custom", action: { type: "text", text: "pnpm deploy", pressEnter: true } },
      ],
    }))).toBe(true)
  })

  it("rejects a malformed toolbar payload", () => {
    const button = toolbar().buttons[0]

    // Absent rather than empty: without it a phone cannot tell which of its
    // computers the list belongs to.
    const withoutDesktop: Record<string, unknown> = { ...toolbar() }
    delete withoutDesktop.desktopClientInstanceId
    expect(isMobileToolbarPayload(withoutDesktop)).toBe(false)
    expect(isMobileToolbarPayload(toolbar({ desktopClientInstanceId: "" }))).toBe(false)
    expect(isMobileToolbarPayload(toolbar({ revision: -1 }))).toBe(false)
    expect(isMobileToolbarPayload(toolbar({ revision: 1.5 }))).toBe(false)
    expect(isMobileToolbarPayload({ ...toolbar(), buttons: "none" })).toBe(false)

    const limits = MOBILE_FRAME_LIMITS
    const many = Array.from({ length: limits.maxToolbarButtons + 1 }, (_value, index) => ({
      ...button, id: `b${index}`,
    }))
    expect(isMobileToolbarPayload(toolbar({ buttons: many }))).toBe(false)
    // The bounds the desktop's own schema enforces, restated on the wire.
    expect(isMobileToolbarPayload(toolbar({
      buttons: [{ ...button, label: "l".repeat(limits.maxToolbarLabelLength + 1) }],
    }))).toBe(false)
    expect(isMobileToolbarPayload(toolbar({
      buttons: [{ ...button, id: "i".repeat(limits.maxToolbarButtonIdLength + 1) }],
    }))).toBe(false)
    expect(isMobileToolbarPayload(toolbar({
      buttons: [{
        ...button,
        action: { type: "text", text: "t".repeat(limits.maxToolbarTextLength + 1), pressEnter: true },
      }],
    }))).toBe(false)

    const malformedButtons = [
      // A group the phone would have no separator rule for.
      { ...button, group: "builtin" },
      { ...button, group: undefined },
      // A label or an id a user could never have stored.
      { ...button, label: "" },
      { ...button, id: "" },
      // A key outside the vocabulary the terminal service can encode.
      { ...button, action: { type: "key", key: "F13" } },
      { ...button, action: { type: "key", key: "Ctrl+I" } },
      { ...button, action: { type: "key", key: "Ctrl+M" } },
      { ...button, action: { type: "key" } },
      // An action shape neither side knows how to execute.
      { ...button, action: { type: "script", text: "rm -rf /" } },
      { ...button, action: { type: "text", text: "/exit" } },
      { ...button, action: { type: "text", text: "/exit", pressEnter: "yes" } },
      { ...button, action: { type: "text", text: "", pressEnter: true } },
      { ...button, action: undefined },
      { ...button, action: null },
    ]
    for (const malformed of malformedButtons) {
      expect(isMobileToolbarPayload(toolbar({
        buttons: [malformed] as unknown as MobileToolbarPayload["buttons"],
      }))).toBe(false)
    }
  })

  it("keeps the toolbar's vocabulary to the keys the terminal service can encode", () => {
    // Every key the panel can draw has to be one the desktop's `KEY_BYTES` can turn
    // into bytes; a name that is only in this list would be accepted by the cloud and
    // then rejected by the computer, which reads to a user as a key that does nothing.
    expect(MOBILE_KEYS).toHaveLength(51)
    expect(MOBILE_KEYS).toEqual([
      // The original twenty-three, in the order they were first released in.
      "Enter", "Tab", "Escape", "ArrowUp", "ArrowDown", "ArrowLeft", "ArrowRight",
      "Backspace", "Ctrl+C", "Ctrl+D",
      "Home", "End", "PageUp", "PageDown", "Delete",
      "Ctrl+A", "Ctrl+E", "Ctrl+U", "Ctrl+K", "Ctrl+W", "Ctrl+L", "Ctrl+R", "Ctrl+Z",
      // The full-keyboard page's additions, appended rather than sorted in: the
      // list is append-only, and a name's position is not what identifies it.
      "Ctrl+B", "Ctrl+F", "Ctrl+G", "Ctrl+H", "Ctrl+J", "Ctrl+N", "Ctrl+O",
      "Ctrl+P", "Ctrl+Q", "Ctrl+S", "Ctrl+T", "Ctrl+V", "Ctrl+X", "Ctrl+Y",
      "Shift+Tab",
      // The function keys and `Insert`, appended for the same reason.
      "F1", "F2", "F3", "F4", "F5", "F6", "F7", "F8", "F9", "F10", "F11", "F12",
      "Insert",
    ])
    expect(new Set<string>(MOBILE_KEYS).size).toBe(MOBILE_KEYS.length)
    // `Ctrl+I` and `Ctrl+M` are the two letters of the alphabet missing from the
    // `Ctrl+` run, and they have to stay missing: `I` is `\x09` and `M` is `\x0d`,
    // which `Tab` and `Enter` already name. A second name for either byte would make
    // the desktop's reverse lookup pick one of them silently.
    expect(MOBILE_KEYS).not.toContain("Ctrl+I")
    expect(MOBILE_KEYS).not.toContain("Ctrl+M")
  })

  it("routes the group command list through both sides of the relay", () => {
    // 两个方向各一道闸，失败的样子完全不同：在电脑那一跳被拒，云端回一个 1003 关闭，
    // 用户看到的是电脑掉线；在手机那一跳被拒，这份列表永远到不了，所有分组行都不带箭头。
    expect(isLiveDesktopClientMessage(createLiveEnvelope(
      LIVE_MESSAGE_TYPES.mobileGroupCommands,
      groupCommands(),
      envelopeMeta,
    ))).toBe(true)
    expect(isLiveMobileServerMessage(createLiveEnvelope(
      LIVE_MESSAGE_TYPES.mobileGroupCommands,
      groupCommands(),
      envelopeMeta,
    ))).toBe(true)
  })

  it("accepts a group command list, including one with no groups", () => {
    expect(isMobileGroupCommandsPayload(groupCommands())).toBe(true)
    // 空列表是一台电脑说「一个分组都没配」，这是一句合法的话：手机对它的表现和不带
    // 箭头的分组一样，但它与「这台电脑太旧、从没发过这条消息」不是同一件事。
    expect(isMobileGroupCommandsPayload(groupCommands({ groups: [] }))).toBe(true)
    // 只有一个分组、一条命令也是合法的：这正是最常见的账号。
    expect(isMobileGroupCommandsPayload(groupCommands({
      groups: [{ groupId: "g1", commands: [{ id: "c1", name: "Claude" }] }],
    }))).toBe(true)
  })

  it("rejects a malformed group command list", () => {
    const entry = groupCommands().groups[0]

    // 缺了它，手机无法知道这份列表是哪台电脑的。
    const withoutDesktop: Record<string, unknown> = { ...groupCommands() }
    delete withoutDesktop.desktopClientInstanceId
    expect(isMobileGroupCommandsPayload(withoutDesktop)).toBe(false)
    expect(isMobileGroupCommandsPayload(groupCommands({ desktopClientInstanceId: "" }))).toBe(false)
    expect(isMobileGroupCommandsPayload(groupCommands({ revision: -1 }))).toBe(false)
    expect(isMobileGroupCommandsPayload(groupCommands({ revision: 1.5 }))).toBe(false)
    expect(isMobileGroupCommandsPayload({ ...groupCommands(), groups: "none" })).toBe(false)

    const limits = MOBILE_FRAME_LIMITS
    const tooManyGroups = Array.from(
      { length: limits.maxGroupCommandGroups + 1 },
      (_value, index) => ({ ...entry, groupId: `g${index}` }),
    )
    expect(isMobileGroupCommandsPayload(groupCommands({ groups: tooManyGroups }))).toBe(false)
    // 分组里命令太多
    expect(isMobileGroupCommandsPayload(groupCommands({
      groups: [{
        groupId: "g1",
        commands: Array.from(
          { length: limits.maxGroupCommandsPerGroup + 1 },
          (_value, index) => ({ id: `c${index}`, name: "n" }),
        ),
      }],
    }))).toBe(false)
    // 名字与 id 的上限，和电脑自己的 schema、摘要里的分组名同值
    expect(isMobileGroupCommandsPayload(groupCommands({
      groups: [{ groupId: "g1", commands: [{ id: "c1", name: "n".repeat(limits.maxGroupCommandNameLength + 1) }] }],
    }))).toBe(false)
    expect(isMobileGroupCommandsPayload(groupCommands({
      groups: [{ groupId: "g1", commands: [{ id: "i".repeat(limits.maxSummaryIdLength + 1), name: "Claude" }] }],
    }))).toBe(false)

    // 一个分组缺了 groupId，或一条命令缺了名字：整条消息作废。这两个字段在电脑上都是
    // 非空的，产生端不出来的东西，也不该被线上放过去。
    expect(isMobileGroupCommandsPayload(groupCommands({
      groups: [{ commands: [{ id: "c1", name: "Claude" }] }],
    }))).toBe(false)
    expect(isMobileGroupCommandsPayload(groupCommands({
      groups: [{ groupId: "g1", commands: [{ id: "c1" }] }],
    }))).toBe(false)
    expect(isMobileGroupCommandsPayload(groupCommands({
      groups: [{ groupId: "g1", commands: "none" }],
    }))).toBe(false)
  })

  it("routes the quick phrases through both sides of the relay", () => {
    // One guard each way, and the two failures are the toolbar's two: rejected on the
    // desktop's hop the cloud closes the socket and the computer reads as offline;
    // rejected on the phone's hop the sentences never arrive, and a computer that has
    // none looks exactly like one too old to have the feature.
    expect(isLiveDesktopClientMessage(createLiveEnvelope(
      LIVE_MESSAGE_TYPES.mobileQuickPhrases,
      quickPhrases(),
      envelopeMeta,
    ))).toBe(true)
    expect(isLiveMobileServerMessage(createLiveEnvelope(
      LIVE_MESSAGE_TYPES.mobileQuickPhrases,
      quickPhrases(),
      envelopeMeta,
    ))).toBe(true)
  })

  it("accepts a computer with no phrases, and rejects a malformed one", () => {
    expect(isMobileQuickPhrasesPayload(quickPhrases())).toBe(true)
    // `[]` is a computer saying "I have none", which the phone draws its segments for
    // and answers with an empty state. It is deliberately not the same answer as the
    // message never arriving — that one leaves the phone with no second segment at
    // all, because a computer too old to send this cannot have been asked about.
    expect(isMobileQuickPhrasesPayload(quickPhrases({ phrases: [] }))).toBe(true)

    // Absent rather than empty: without it a phone cannot tell which of its computers
    // the sentences belong to.
    const withoutDesktop: Record<string, unknown> = { ...quickPhrases() }
    delete withoutDesktop.desktopClientInstanceId
    expect(isMobileQuickPhrasesPayload(withoutDesktop)).toBe(false)
    expect(isMobileQuickPhrasesPayload(quickPhrases({ desktopClientInstanceId: "" }))).toBe(false)
    expect(isMobileQuickPhrasesPayload(quickPhrases({ revision: -1 }))).toBe(false)
    expect(isMobileQuickPhrasesPayload(quickPhrases({ revision: 1.5 }))).toBe(false)
    expect(isMobileQuickPhrasesPayload({ ...quickPhrases(), phrases: "none" })).toBe(false)
    expect(isMobileQuickPhrasesPayload(quickPhrases({
      phrases: undefined as unknown as MobileQuickPhrasesPayload["phrases"],
    }))).toBe(false)

    const limits = MOBILE_FRAME_LIMITS
    const many = Array.from({ length: limits.maxQuickPhrases + 1 }, (_value, index) => ({
      id: `p${index}`,
      content: "整理成提交说明",
    }))
    expect(isMobileQuickPhrasesPayload(quickPhrases({ phrases: many }))).toBe(false)

    const phrase = quickPhrases().phrases[0]
    const malformed = [
      // A sentence the computer could never have stored, and therefore could not have
      // sent: its own entry validator requires a non-blank id and a non-blank body.
      { ...phrase, id: "" },
      { ...phrase, content: "" },
      { ...phrase, content: "   " },
      // Over the ceiling the phone's one-line row cannot hold, dropped whole rather
      // than truncated — see `maxQuickPhraseLength`.
      { ...phrase, content: "s".repeat(limits.maxQuickPhraseLength + 1) },
      { ...phrase, content: undefined },
      { ...phrase, id: "i".repeat(limits.maxToolbarButtonIdLength + 1) },
      // Shapes neither end knows how to draw.
      "整理成提交说明",
      null,
    ]
    for (const malformedPhrase of malformed) {
      expect(isMobileQuickPhrasesPayload(quickPhrases({
        phrases: [malformedPhrase] as unknown as MobileQuickPhrasesPayload["phrases"],
      }))).toBe(false)
    }

    // Every field is required and none arrived with a default, so the payload the
    // desktop builds and the one this test builds serialize to the same bytes.
    expect(Object.keys(quickPhrases())).toEqual(["desktopClientInstanceId", "revision", "phrases"])
    expect(Object.keys(quickPhrases().phrases[0])).toEqual(["id", "content"])
  })

  it("routes the clipboard through both sides of the relay", () => {
    // One guard each way, and the two failures are the toolbar's two: rejected on the
    // desktop's hop the cloud closes the socket and the computer reads as offline;
    // rejected on the phone's hop the entries never arrive, and a phone that has
    // never seen this message from this computer draws an empty list it cannot tell
    // apart from a computer that has copied nothing.
    expect(isLiveDesktopClientMessage(createLiveEnvelope(
      LIVE_MESSAGE_TYPES.mobileClipboard,
      clipboard(),
      envelopeMeta,
    ))).toBe(true)
    expect(isLiveMobileServerMessage(createLiveEnvelope(
      LIVE_MESSAGE_TYPES.mobileClipboard,
      clipboard(),
      envelopeMeta,
    ))).toBe(true)
  })

  it("accepts a computer that has copied nothing, and rejects a malformed clipboard", () => {
    // `[]` is a computer that has just started and copied nothing yet. Unlike the
    // phrases, this one has no second meaning to keep apart: the phone's own bucket
    // is what it draws, so an empty snapshot is just "nothing new to merge".
    expect(isMobileClipboardPayload(clipboard({ entries: [] }))).toBe(true)

    // Absent rather than empty: without it the phone cannot tell which of its
    // computers these entries belong to.
    const withoutDesktop: Record<string, unknown> = { ...clipboard() }
    delete withoutDesktop.desktopClientInstanceId
    expect(isMobileClipboardPayload(withoutDesktop)).toBe(false)
    expect(isMobileClipboardPayload(clipboard({ desktopClientInstanceId: "" }))).toBe(false)
    expect(isMobileClipboardPayload(clipboard({ revision: -1 }))).toBe(false)
    expect(isMobileClipboardPayload(clipboard({ revision: 1.5 }))).toBe(false)
    expect(isMobileClipboardPayload({ ...clipboard(), entries: "none" })).toBe(false)

    const limits = MOBILE_FRAME_LIMITS
    // One past the ring the desktop keeps. A snapshot longer than that could not
    // have been produced by this wire's own producer.
    const many = Array.from({ length: limits.maxClipboardEntries + 1 }, (_value, index) => ({
      id: `c${index}`,
      text: "pnpm mobile:install",
      copiedAt: "2026-09-21T10:00:00.000Z",
    }))
    expect(isMobileClipboardPayload(clipboard({ entries: many }))).toBe(false)

    const entry = clipboard().entries[0]
    const malformed = [
      { ...entry, id: "" },
      { ...entry, text: undefined },
      { ...entry, copiedAt: undefined },
      { ...entry, copiedAt: "t".repeat(limits.maxSummaryStartedAtLength + 1) },
      // Over the ceiling the desktop's own collector drops whole rather than
      // truncating — see `maxClipboardTextLength`.
      { ...entry, text: "s".repeat(limits.maxClipboardTextLength + 1) },
      { ...entry, id: "i".repeat(limits.maxToolbarButtonIdLength + 1) },
      "pnpm mobile:install",
      null,
    ]
    for (const malformedEntry of malformed) {
      expect(isMobileClipboardPayload(clipboard({
        entries: [malformedEntry] as unknown as MobileClipboardPayload["entries"],
      }))).toBe(false)
    }

    // Whitespace-only is rejected by `boundedString`, which trims before judging.
    // That is only defensible because the desktop's collector makes the same call:
    // it drops text that is empty *or* all whitespace. If the producer could emit
    // one, this validator would be the reason a phone threw away a whole snapshot —
    // twenty entries — over a single row of spaces.
    expect(isMobileClipboardPayload(clipboard({
      entries: [{ ...entry, text: "   " }],
    }))).toBe(false)

    // Every field is required and none arrived with a default, so the payload the
    // desktop builds and the one this test builds serialize to the same bytes.
    expect(Object.keys(clipboard())).toEqual(["desktopClientInstanceId", "revision", "entries"])
    expect(Object.keys(clipboard().entries[0])).toEqual(["id", "text", "copiedAt"])
  })

  it("routes the git status through both sides of the relay", () => {
    /*
     * 一条新消息要在四个地方各写一次：常量表、电脑上行联合、手机下行联合、两个校验
     * 分支。漏掉任何一个都有明确症状，而且都不是「报个错」：漏在电脑上行那侧，服务端
     * 收到不认识的类型会**直接切断电脑的连接**（用户看到的是「设备莫名离线」，日志里
     * 只有一句校验失败）；漏在手机下行那侧，消息到不了手机，第二行永远停在原样。
     *
     * 两个联合是类型层的事 —— 少了哪一条这里根本编译不过（`createLiveEnvelope` 的
     * 类型参数对不上）。这个用例守的是能跑到的那两个：常量与两个校验分支。
     */
    expect(isLiveDesktopClientMessage(createLiveEnvelope(
      LIVE_MESSAGE_TYPES.mobileGitStatus,
      gitStatusPayload(),
      envelopeMeta,
    ))).toBe(true)
    expect(isLiveMobileServerMessage(createLiveEnvelope(
      LIVE_MESSAGE_TYPES.mobileGitStatus,
      gitStatusPayload(),
      envelopeMeta,
    ))).toBe(true)
  })

  it("answers 「不是仓库」 as an answer, and rejects a malformed git status", () => {
    expect(isMobileGitStatusPayload(gitStatusPayload())).toBe(true)
    // `null` 是一个答案：这个目录不是 Git 仓库，第二行据此退回显示版本号。
    expect(isMobileGitStatusPayload(gitStatusPayload({ status: null }))).toBe(true)
    // 游离 HEAD：没有分支名，但有短 sha。
    expect(isMobileGitStatusPayload(gitStatusPayload({
      status: {
        cwd: "/tmp", branch: null, detachedSha: "0a1b2c3", upstream: null,
        ahead: 0, behind: 0, changeCount: 0, hasConflicts: true,
      },
    }))).toBe(true)

    const limits = MOBILE_FRAME_LIMITS
    const status = gitStatusPayload().status as NonNullable<MobileGitStatusPayload["status"]>
    const malformed: unknown[] = [
      // 缺席不是「不是仓库」：手机分不清它与「从来没收到过」，而这两者在屏幕上不同 ——
      // 一个退回版本号，一个保持现状不动。
      { ...gitStatusPayload(), status: undefined },
      { ...gitStatusPayload(), status: "main" },
      { ...gitStatusPayload(), revision: -1 },
      { ...gitStatusPayload(), sessionId: "" },
      { ...gitStatusPayload(), mobileClientInstanceId: undefined },
      { ...gitStatusPayload(), status: { ...status, branch: undefined } },
      { ...gitStatusPayload(), status: { ...status, upstream: undefined } },
      { ...gitStatusPayload(), status: { ...status, ahead: 0.5 } },
      { ...gitStatusPayload(), status: { ...status, changeCount: -1 } },
      { ...gitStatusPayload(), status: { ...status, hasConflicts: "no" } },
      { ...gitStatusPayload(), status: { ...status, cwd: 7 } },
      { ...gitStatusPayload(), status: { ...status, branch: "b".repeat(limits.maxGitRefNameLength + 1) } },
      { ...gitStatusPayload(), status: { ...status, cwd: "c".repeat(limits.maxGitPathLength + 1) } },
      { ...gitStatusPayload(), status: { ...status, detachedSha: "d".repeat(limits.maxGitShortShaLength + 1) } },
    ]
    for (const value of malformed) expect(isMobileGitStatusPayload(value)).toBe(false)
  })

  it("validates the git intent, whose action is an enum rather than a command string", () => {
    /*
     * `action` 只接受这八个词，不接受任何命令字符串 —— 这是「不得新增通用 shell.exec」
     * 在协议层的落点：电脑侧按枚举分派，这条线上不存在一条「把手机给的字符串当命令跑」
     * 的路。所以 `action` 不在枚举里，必须在这里就被拒掉。
     */
    const base = { v: MOBILE_PROTOCOL_VERSION, intentId: "i1", kind: "git", sessionId: "sess-1" }
    const limits = MOBILE_FRAME_LIMITS

    expect(isMobileIntent({ ...base, action: "status" })).toBe(true)
    expect(isMobileIntent({ ...base, action: "branches" })).toBe(true)
    expect(isMobileIntent({ ...base, action: "checkout", branch: "main", discardChanges: true })).toBe(true)
    expect(isMobileIntent({ ...base, action: "createBranch", branch: "feature", fromBranch: "main" })).toBe(true)
    expect(isMobileIntent({ ...base, action: "commit", message: "只改一行", pushAfterCommit: true })).toBe(true)
    expect(isMobileIntent({ ...base, action: "push" })).toBe(true)
    expect(isMobileIntent({ ...base, action: "sync" })).toBe(true)
    expect(isMobileIntent({ ...base, action: "merge", branch: "release", direction: "outOfCurrent" })).toBe(true)
    expect(isMobileIntent({ ...base, action: "remoteBranches" })).toBe(true)
    expect(isMobileIntent({ ...base, action: "fetchRemotes" })).toBe(true)
    expect(isMobileIntent({ ...base, action: "checkoutRemote", remote: "origin", branch: "dev" })).toBe(true)
    // 要另一个本地名的那一次重发：`localBranch` 与 `remote` 一起带回来。
    expect(isMobileIntent({
      ...base, action: "checkoutRemote", remote: "origin", branch: "dev", localBranch: "dev-copy",
    })).toBe(true)
    // 远端名本身可以含 `/`（`team/fork`）—— 拆开是电脑的事，协议这层只按 ref 名的上界收。
    expect(isMobileIntent({ ...base, action: "checkoutRemote", remote: "team/fork", branch: "dev" })).toBe(true)

    // 没有终端就不知道在哪个目录上跑。
    expect(isMobileIntent({ ...base, sessionId: undefined, action: "status" })).toBe(false)
    // 不在枚举里的动作。
    expect(isMobileIntent({ ...base, action: "log" })).toBe(false)
    expect(isMobileIntent({ ...base, action: "rm -rf /" })).toBe(false)
    expect(isMobileIntent({ ...base, action: "status " })).toBe(false)
    expect(isMobileIntent({ ...base, action: undefined })).toBe(false)
    expect(isMobileIntent({ ...base, action: 8 })).toBe(false)
    // 类型不对 / 超界的可选字段。
    expect(isMobileIntent({ ...base, action: "commit", message: 42 })).toBe(false)
    expect(isMobileIntent({ ...base, action: "commit", message: "" })).toBe(false)
    expect(isMobileIntent({ ...base, action: "commit", message: "m".repeat(limits.maxIntentTextLength + 1) })).toBe(false)
    expect(isMobileIntent({ ...base, action: "commit", pushAfterCommit: "yes" })).toBe(false)
    expect(isMobileIntent({ ...base, action: "checkout", branch: "" })).toBe(false)
    expect(isMobileIntent({ ...base, action: "checkout", branch: "b".repeat(limits.maxGitRefNameLength + 1) })).toBe(false)
    expect(isMobileIntent({ ...base, action: "merge", direction: "sideways" })).toBe(false)
    expect(isMobileIntent({ ...base, action: "checkout", discardChanges: "true" })).toBe(false)
    // 新加的两个字段同样要过类型与上界：空串不是「没给」，超长的 ref 名不是 ref 名。
    expect(isMobileIntent({
      ...base, action: "checkoutRemote", remote: "o".repeat(limits.maxGitRefNameLength + 1), branch: "dev",
    })).toBe(false)
    expect(isMobileIntent({ ...base, action: "checkoutRemote", remote: 8, branch: "dev" })).toBe(false)
    expect(isMobileIntent({ ...base, action: "checkoutRemote", remote: "", branch: "dev" })).toBe(false)
    expect(isMobileIntent({
      ...base, action: "checkoutRemote", remote: "origin", branch: "dev",
      localBranch: "l".repeat(limits.maxGitRefNameLength + 1),
    })).toBe(false)
  })

  it("carries the git answers back, and refuses an empty block", () => {
    // 「要用户先选一个走法」的结论带着一句要显示的话，所以它在 `rejected` 那一支上 ——
    // 但校验器只看块内形状，不看它与 `outcome` 的搭配：那是电脑侧的业务判断。
    expect(isMobileIntentResult({
      intentId: "i1",
      outcome: "rejected",
      message: "当前目录里有未提交的改动。",
      git: { needsDecision: "dirty" },
    })).toBe(true)
    expect(isMobileIntentResult({
      intentId: "i1",
      outcome: "accepted",
      git: { branches: [{ name: "main", current: true }, { name: "release", current: false }] },
    })).toBe(true)
    expect(isMobileIntentResult({
      intentId: "i1",
      outcome: "rejected",
      git: {
        conflict: {
          source: "feature",
          target: "main",
          files: ["a.txt"],
          summaryText: "【Synapse · Git 合并冲突】\n",
        },
      },
    })).toBe(true)
    // 「要另一个本地名」与「脏工作区」是同一类回答的两个取值：都不是失败，都要显示一句话。
    expect(isMobileIntentResult({
      intentId: "i1",
      outcome: "rejected",
      message: "本地已有 feature-x，它跟踪的是 origin/other。",
      git: { needsDecision: "localBranchName" },
    })).toBe(true)
    expect(isMobileIntentResult({
      intentId: "i1",
      outcome: "accepted",
      git: { remoteBranches: [{ remote: "origin", name: "main" }, { remote: "origin", name: "dev" }] },
    })).toBe(true)
    // 远端名本身可以含 `/`（`team/fork`）；两段各自都按 ref 名的上界收。
    expect(isMobileIntentResult({
      intentId: "i1",
      outcome: "accepted",
      git: { remoteBranches: [{ remote: "team/fork", name: "dev" }] },
    })).toBe(true)

    // 空对象不是一份结果：电脑要么有话说，要么什么都不填。
    expect(isMobileIntentResult({ intentId: "i1", outcome: "accepted", git: {} })).toBe(false)
    expect(isMobileIntentResult({ intentId: "i1", outcome: "accepted", git: { needsDecision: "later" } })).toBe(false)
    // 空列表**是合法的**：一个没有远端的仓库就该回一个空列表，而不是什么都不回 ——
    // 手机端要靠它把「还没有远端分支」那种空态画出来。
    expect(isMobileIntentResult({
      intentId: "i1", outcome: "accepted", git: { remoteBranches: [] },
    })).toBe(true)
    // 两段缺一段、空串、类型不对、超量都不收。超量这一条要紧 —— 校验器拒掉就是整条结果
    // 作废，手机上表现为「电脑一直没有回答」，所以产生端必须先截断。
    expect(isMobileIntentResult({
      intentId: "i1", outcome: "accepted", git: { remoteBranches: [{ remote: "origin" }] },
    })).toBe(false)
    expect(isMobileIntentResult({
      intentId: "i1", outcome: "accepted", git: { remoteBranches: [{ remote: "", name: "dev" }] },
    })).toBe(false)
    expect(isMobileIntentResult({
      intentId: "i1", outcome: "accepted", git: { remoteBranches: "origin/dev" },
    })).toBe(false)
    expect(isMobileIntentResult({
      intentId: "i1",
      outcome: "accepted",
      git: {
        remoteBranches: Array.from(
          { length: MOBILE_FRAME_LIMITS.maxGitBranches + 1 },
          (_, index) => ({ remote: "origin", name: `b${index}` }),
        ),
      },
    })).toBe(false)
    expect(isMobileIntentResult({ intentId: "i1", outcome: "accepted", git: { branches: "main" } })).toBe(false)
    expect(isMobileIntentResult({ intentId: "i1", outcome: "accepted", git: { branches: [{ name: "main" }] } })).toBe(false)
    expect(isMobileIntentResult({ intentId: "i1", outcome: "accepted", git: { branches: [null] } })).toBe(false)
    expect(isMobileIntentResult({
      intentId: "i1",
      outcome: "rejected",
      git: { conflict: { source: "a", target: "b", files: [], summaryText: "" } },
    })).toBe(false)
    expect(isMobileIntentResult({
      intentId: "i1",
      outcome: "rejected",
      git: { conflict: { source: "", target: "b", files: [], summaryText: "x" } },
    })).toBe(false)

    const limits = MOBILE_FRAME_LIMITS
    expect(isMobileIntentResult({
      intentId: "i1",
      outcome: "rejected",
      git: {
        conflict: {
          source: "a",
          target: "b",
          files: Array.from({ length: limits.maxGitConflictFiles + 1 }, (_value, index) => `f${index}`),
          summaryText: "x",
        },
      },
    })).toBe(false)
    expect(isMobileIntentResult({
      intentId: "i1",
      outcome: "rejected",
      git: {
        conflict: {
          source: "a",
          target: "b",
          files: [],
          summaryText: "s".repeat(limits.maxGitConflictTextLength + 1),
        },
      },
    })).toBe(false)
  })

  it("keeps the widest conflict text the producer can build inside its declared bound", () => {
    /*
     * 这条例用把那个上界的算式钉住。产生端（`terminal-git-integration.ts` 的
     * `buildConflict`）把文件清单截到 `maxGitConflictFiles` 项、每项截到
     * `maxGitPathLength` 字节，所以最宽的文本是「128 项 × 每项 516 字节 + 抬头结尾」。
     *
     * 上界为什么不能随便加：`mobile.intentResult` 走的是电脑那条 `maxPayload` 为
     * 256 KiB 的套接字，装不下就是**断连**，不是丢一条消息。
     */
    const limits = MOBILE_FRAME_LIMITS
    const files = Array.from({ length: limits.maxGitConflictFiles }, () =>
      "p".repeat(limits.maxGitPathLength))
    const summaryText = [
      "【Synapse · Git 合并冲突】",
      "仓库目录：/tmp",
      "操作：把分支 feature 合并到 main",
      "结果：检测到冲突，已自动取消合并并回退（git merge --abort），仓库回到了合并前的状态。",
      `冲突文件（共 ${String(files.length)} 个）：`,
      ...files.map((file) => `- ${file}`),
      "（清单只列了前 128 个，另有 3 个未列出）",
      "",
      "请帮我解决这些冲突。",
      "",
    ].join("\n")

    expect(summaryText.length).toBeLessThanOrEqual(limits.maxGitConflictTextLength)

    const result = {
      intentId: "i1",
      outcome: "rejected" as const,
      git: { conflict: { source: "feature", target: "main", files, summaryText } },
    }
    expect(isMobileIntentResult(result)).toBe(true)
    // 一条消息，不是一条流：整份 JSON 远在那条套接字之下，也给信封留足了余地。
    expect(Buffer.byteLength(JSON.stringify(result), "utf8")).toBeLessThan(200 * 1024)
  })

  it("adds no bytes to the messages that predate the toolbar", () => {
    /*
     * The toolbar is a family of its own precisely so that nothing already on the
     * wire grows, and this is what holds that line. Each shape below is serialized
     * exactly as its producer sends it, so a field that arrived with a default — or
     * one that became required — moves a number here even though every existing
     * client would still parse it.
     */
    const shapes: readonly { readonly name: string; readonly payload: unknown; readonly bytes: number }[] = [
      { name: "summary", payload: summary(), bytes: 393 },
      { name: "frame", payload: frame(), bytes: 180 },
      {
        name: "intent",
        payload: {
          desktopClientInstanceId: "desktop-1",
          mobileClientInstanceId: "phone-1",
          intent: { v: MOBILE_PROTOCOL_VERSION, intentId: "i1", kind: "sync" },
        },
        bytes: 121,
      },
      {
        name: "intentResult",
        payload: { mobileClientInstanceId: "phone-1", result: { intentId: "i1", outcome: "accepted" } },
        bytes: 84,
      },
      {
        name: "transferProgress",
        payload: { mobileClientInstanceId: "phone-1", intentId: "i1", completedBytes: 0, totalBytes: 0 },
        bytes: 86,
      },
      { name: "presence", payload: { desktopClientInstanceIds: ["desktop-1"] }, bytes: 42 },
      { name: "detached", payload: { mobileClientInstanceId: "phone-1", reason: "closed" }, bytes: 54 },
    ]

    for (const shape of shapes) {
      expect({ name: shape.name, bytes: Buffer.byteLength(JSON.stringify(shape.payload), "utf8") })
        .toEqual({ name: shape.name, bytes: shape.bytes })
    }

    // The one field a phone tells "no buttons" apart from "too old to say" by: it is
    // on the toolbar's own message, and nowhere else.
    expect(JSON.stringify(summary())).not.toContain("toolbar")
    expect(JSON.stringify(frame())).not.toContain("toolbar")

    // And the same holds on the new message itself: every field is required, none
    // arrived with a default, so the button the desktop builds and the button this
    // test builds serialize to the same bytes.
    expect(Object.keys(toolbar())).toEqual(["desktopClientInstanceId", "revision", "buttons"])
    expect(Object.keys(toolbar().buttons[0])).toEqual(["id", "label", "group", "action"])
    expect(Object.keys(toolbar().buttons[0].action)).toEqual(["type", "key"])
    expect(Object.keys(toolbar().buttons[2].action)).toEqual(["type", "text", "pressEnter"])
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
