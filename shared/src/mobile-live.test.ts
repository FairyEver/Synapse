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
