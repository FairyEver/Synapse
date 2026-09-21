import { describe, expect, it } from "vitest"
import { MOBILE_FRAME_LIMITS, MOBILE_RUN_FLAGS, isMobileTerminalFrame } from "@synapse/shared"

import type { TerminalStyledLine } from "../../../app-capabilities/terminal/main/emulator"
import {
  buildSnapshotFrames,
  buildTerminalFrames,
  toLineWire,
  toWireColor,
  toWireFlags,
  truncateToBytes,
} from "../mobile-gateway/frame-builder"

function plain(text: string): TerminalStyledLine {
  return { text }
}

// `runs` is a readonly array, so the conditional has to match the readonly form
// too — `(infer R)[]` alone never matches it and collapses the parameter to `never`.
function styled(text: string, overrides: Partial<TerminalStyledLine["runs"] extends readonly (infer R)[] | undefined ? R : never> = {}) {
  return {
    text,
    runs: [{
      start: 0,
      length: text.length,
      foreground: -1,
      background: -1,
      bold: false,
      italic: false,
      underline: false,
      dim: false,
      inverse: false,
      ...overrides,
    }],
  } as TerminalStyledLine
}

const base = {
  sessionId: "sess-1",
  kind: "suffix" as const,
  from: 0,
  total: 1,
  cursor: { row: 0, col: 0, visible: true },
  alt: false,
  truncated: false,
  seq: 1,
  sizeRevision: 1,
}

describe("terminal frame builder", () => {
  it("omits runs for unstyled lines", () => {
    expect(toLineWire(plain("hello"))).toEqual(["hello"])
  })

  it("keeps runs and omits them for default styling", () => {
    expect(toLineWire(styled("hello", { foreground: 2 }))).toEqual([
      "hello",
      [[0, 5, 2, -1, 0]],
    ])
  })

  it("packs attributes into the flag bitfield", () => {
    expect(toWireFlags({
      start: 0,
      length: 1,
      foreground: -1,
      background: -1,
      bold: true,
      italic: false,
      underline: true,
      dim: false,
      inverse: true,
    })).toBe(MOBILE_RUN_FLAGS.bold | MOBILE_RUN_FLAGS.underline | MOBILE_RUN_FLAGS.inverse)
  })

  it("translates the emulator's colour encoding onto the wire encoding", () => {
    expect(toWireColor(-1)).toBe(-1)
    expect(toWireColor(7)).toBe(7)
    // 0x1000000 | rgb on both sides, expressed through the emulator's constant.
    expect(toWireColor(0x1000000 | 0x123456)).toBe(0x1000000 | 0x123456)
  })

  it("splits an oversized update into bounded frames that stay under the socket budget", () => {
    const lines = Array.from({ length: 2000 }, (_, index) => plain(`line ${index} ${"x".repeat(40)}`))

    const frames = buildTerminalFrames({ ...base, lines, from: 0, total: 2000 })

    expect(frames.length).toBeGreaterThan(1)
    for (const frame of frames) {
      expect(Buffer.byteLength(JSON.stringify(frame), "utf8"))
        .toBeLessThanOrEqual(MOBILE_FRAME_LIMITS.maxPayloadBytes)
      expect(frame.lines.length).toBeLessThanOrEqual(MOBILE_FRAME_LIMITS.maxLinesPerFrame)
      expect(isMobileTerminalFrame(frame)).toBe(true)
    }
  })

  it("keeps frames contiguous so an in-order client converges", () => {
    const lines = Array.from({ length: 900 }, (_, index) => plain(`line ${index}`))

    const frames = buildTerminalFrames({ ...base, lines, total: lines.length })

    let expected = 0
    for (const frame of frames) {
      expect(frame.from).toBe(expected)
      expected += frame.lines.length
    }
    expect(expected).toBe(lines.length)
  })

  it("splits by line count even when every line is tiny", () => {
    const lines = Array.from({ length: MOBILE_FRAME_LIMITS.maxLinesPerFrame * 2 + 5 }, () => plain("x"))

    const frames = buildTerminalFrames({ ...base, lines, total: lines.length })

    expect(frames).toHaveLength(3)
    expect(frames[0].lines).toHaveLength(MOBILE_FRAME_LIMITS.maxLinesPerFrame)
  })

  it("emits one state-carrying frame when there are no lines", () => {
    const frames = buildTerminalFrames({ ...base, lines: [], total: 42 })

    expect(frames).toHaveLength(1)
    expect(frames[0].lines).toEqual([])
    expect(frames[0].total).toBe(42)
  })

  it("discards once when a reset is split, not once per frame", () => {
    // A reset means "throw away everything you hold". A client that reads that on
    // every chunk ends up holding the last chunk alone, so the window has to
    // arrive as one discard followed by amendments.
    const lines = Array.from({ length: 900 }, (_, index) => plain(`line ${index}`))

    const frames = buildTerminalFrames({ ...base, kind: "reset", lines, total: lines.length })

    expect(frames.length).toBeGreaterThan(1)
    expect(frames.map((frame) => frame.kind)).toEqual([
      "reset",
      ...frames.slice(1).map(() => "suffix"),
    ])

    // Contiguity is what makes the amendments land on top of the discard, and it
    // is also what proves the chunks still tile the whole window.
    let expected = 0
    for (const frame of frames) {
      expect(frame.from).toBe(expected)
      expected += frame.lines.length
    }
    expect(expected).toBe(lines.length)
  })

  it("declares the truncation boundary once, on the frame that defines it", () => {
    // `truncated` means "everything before this frame's `from` is gone". Only the
    // first chunk's `from` is that boundary; on the followers the same flag lands
    // inside the window the leading chunks just delivered, and a client that
    // honours it discards them and keeps the tail of an update it was sent whole.
    const lines = Array.from({ length: 900 }, (_, index) => plain(`line ${index}`))

    const frames = buildTerminalFrames({ ...base, truncated: true, lines, total: lines.length })

    expect(frames.length).toBeGreaterThan(1)
    expect(frames[0].truncated).toBe(true)
    expect(frames.slice(1).map((frame) => frame.truncated)).toEqual(frames.slice(1).map(() => false))
  })

  it("leaves a split suffix and a split history alone", () => {
    const lines = Array.from({ length: 900 }, (_, index) => plain(`line ${index}`))

    for (const kind of ["suffix", "history"] as const) {
      const frames = buildTerminalFrames({ ...base, kind, lines, total: lines.length })

      expect(frames.length).toBeGreaterThan(1)
      expect(frames.every((frame) => frame.kind === kind)).toBe(true)
    }
  })

  it("gives every chunk the whole update's end, never its own", () => {
    // The client truncates at `total`. A suffix frame voids everything at or past
    // the line it stands up, and on a chunk that line is the chunk's own end — so a
    // `total` recomputed per chunk would make the first one delete every line the
    // followers are about to deliver, and the screen would collapse to one chunk's
    // worth until they land. This asserts the contract the phone relies on rather
    // than a bug that was ever here (see TerminalStoreSplitUpdateTests).
    const lines = Array.from({ length: 900 }, (_, index) => plain(`line ${index}`))

    const frames = buildTerminalFrames({ ...base, lines, total: 900 })

    expect(frames.length).toBeGreaterThan(1)
    expect(frames.every((frame) => frame.total === 900)).toBe(true)
    // And the first chunk really does end short of it — which is the whole reason
    // its own end cannot be the boundary.
    expect(frames[0].from + frames[0].lines.length).toBeLessThan(900)
  })

  it("truncates a pathological line instead of dropping the frame", () => {
    const frames = buildTerminalFrames({
      ...base,
      lines: [plain("界".repeat(4000))],
      total: 1,
    })

    expect(frames).toHaveLength(1)
    const text = frames[0].lines[0][0] as string
    expect(Buffer.byteLength(text, "utf8")).toBeLessThanOrEqual(2048)
    expect(text.length).toBeGreaterThan(0)
  })

  it("never emits an unpaired surrogate when truncating", () => {
    const emoji = "😀".repeat(1000)
    const cut = truncateToBytes(emoji, 101)

    expect(cut.length % 2).toBe(0)
    expect(cut).toBe("😀".repeat(25))
    expect(JSON.parse(JSON.stringify({ cut })).cut).toBe(cut)
  })

  it("drops runs that fall outside a truncated line", () => {
    const line: TerminalStyledLine = {
      text: "abcdefghij",
      runs: [{
        start: 8,
        length: 2,
        foreground: 3,
        background: -1,
        bold: false,
        italic: false,
        underline: false,
        dim: false,
        inverse: false,
      }],
    }

    expect(toLineWire(line)).toEqual(["abcdefghij", [[8, 2, 3, -1, 0]]])
  })
})

describe("terminal snapshot frames", () => {
  const window = (count: number) => Array.from({ length: count }, (_, index) => plain(`line ${index}`))

  /// The phone pins to the bottom of whatever it holds, so a client whose buffer is
  /// momentarily only the *oldest* part of the window is a reader looking at the
  /// wrong part of the terminal — which is what a reconnect used to show them, once
  /// per chunk, until the last one landed.
  it("never leaves the client holding a window whose newest line is not the newest", () => {
    const lines = window(900)

    const frames = buildSnapshotFrames({ ...base, lines, from: 0, total: lines.length })

    expect(frames.length).toBeGreaterThan(1)
    let newest = -1
    for (const frame of frames) {
      newest = frame.kind === "reset"
        ? frame.from + frame.lines.length - 1
        : Math.max(newest, frame.from + frame.lines.length - 1)
      expect(newest).toBe(lines.length - 1)
    }
  })

  it("lands the reset on the newest chunk and fills the rest in below it", () => {
    const lines = window(900)

    const frames = buildSnapshotFrames({ ...base, lines, from: 0, total: lines.length })

    expect(frames[0].kind).toBe("reset")
    expect(frames[0].from + frames[0].lines.length).toBe(lines.length)
    // Each frame after it picks up immediately below the one before, so the older
    // chunks read as scrollback arriving above the reader rather than as a rewrite.
    for (let index = 1; index < frames.length; index += 1) {
      expect(frames[index].kind).toBe("history")
      expect(frames[index].from + frames[index].lines.length).toBe(frames[index - 1].from)
    }
  })

  it("still tiles the whole window exactly once", () => {
    const lines = window(500)

    const frames = buildSnapshotFrames({ ...base, lines, from: 4_000, total: 4_500 })

    const covered = frames.flatMap((frame) => frame.lines.map((_, offset) => frame.from + offset))
    expect([...covered].sort((a, b) => a - b))
      .toEqual(Array.from({ length: 500 }, (_, index) => 4_000 + index))
    // And the window's own end is still where `total` says it is.
    expect(frames[0].from + frames[0].lines.length).toBe(4_500)
  })

  it("never claims a truncation boundary, which would drop what it just sent", () => {
    const lines = window(900)

    const frames = buildSnapshotFrames({ ...base, lines, total: lines.length })

    expect(frames.every((frame) => !frame.truncated)).toBe(true)
  })

  it("sends a window that fits as the single frame it is", () => {
    const lines = window(10)

    const frames = buildSnapshotFrames({ ...base, lines, total: lines.length })

    expect(frames).toHaveLength(1)
    expect(frames[0].kind).toBe("reset")
    expect(frames[0].from).toBe(0)
  })

  it("keeps every frame of a snapshot within the socket budget", () => {
    const lines = Array.from({ length: 2_000 }, (_, index) => plain(`line ${index} ${"x".repeat(40)}`))

    for (const frame of buildSnapshotFrames({ ...base, lines, total: lines.length })) {
      expect(isMobileTerminalFrame(frame)).toBe(true)
      expect(Buffer.byteLength(JSON.stringify(frame), "utf8"))
        .toBeLessThanOrEqual(MOBILE_FRAME_LIMITS.maxPayloadBytes)
    }
  })
})
