import { describe, expect, it } from "vitest"
import {
  LIVE_MESSAGE_TYPES,
  createLiveEnvelope,
  isLiveDesktopClientMessage,
  isLiveDesktopServerMessage,
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
  type MobileIntent,
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

  it("validates the ASR signing intent, which carries no session", () => {
    expect(isMobileIntent({ v: 1, intentId: "i1", kind: "asrSign" })).toBe(true)
    expect(isMobileIntent({
      v: 1, intentId: "i1", kind: "asrSign", engineModelType: "Hy-ASR-3.0-preview",
    })).toBe(true)

    // 校验器只看必需的形状，多带的字段一律忽略 —— 和其他 intent 一致，
    // asrSign 不要求 sessionId，带了也不影响。
    expect(isMobileIntent({ v: 1, intentId: "i1", kind: "asrSign", sessionId: "s1" })).toBe(true)
    expect(isMobileIntent({
      v: 1, intentId: "i1", kind: "asrSign",
      engineModelType: "x".repeat(MOBILE_FRAME_LIMITS.maxEngineModelTypeLength + 1),
    })).toBe(false)
    expect(isMobileIntent({ v: 1, intentId: "i1", kind: "asrSign", engineModelType: "" })).toBe(false)
  })

  it("carries the signed URL back in the intent result, bounded", () => {
    const signed = {
      intentId: "i1",
      outcome: "accepted" as const,
      signedAsrUrl: "wss://asr.cloud.tencent.com/asr/v2/1252371654?secretid=AKID&signature=abc",
      asrVoiceId: "voice-1",
      asrExpiresAt: 1_700_000_300,
    }
    expect(isMobileIntentResult(signed)).toBe(true)

    expect(isMobileIntentResult({
      ...signed, signedAsrUrl: "x".repeat(MOBILE_FRAME_LIMITS.maxSignedAsrUrlLength + 1),
    })).toBe(false)
    expect(isMobileIntentResult({
      ...signed, asrVoiceId: "x".repeat(MOBILE_FRAME_LIMITS.maxAsrVoiceIdLength + 1),
    })).toBe(false)
    expect(isMobileIntentResult({ ...signed, asrExpiresAt: -1 })).toBe(false)
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
