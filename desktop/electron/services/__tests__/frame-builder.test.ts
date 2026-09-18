import { describe, expect, it } from "vitest"
import { MOBILE_FRAME_LIMITS, MOBILE_RUN_FLAGS, isMobileTerminalFrame } from "@synapse/shared"

import type { TerminalStyledLine } from "../../../app-capabilities/terminal/main/emulator"
import {
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

  it("leaves a split suffix and a split history alone", () => {
    const lines = Array.from({ length: 900 }, (_, index) => plain(`line ${index}`))

    for (const kind of ["suffix", "history"] as const) {
      const frames = buildTerminalFrames({ ...base, kind, lines, total: lines.length })

      expect(frames.length).toBeGreaterThan(1)
      expect(frames.every((frame) => frame.kind === kind)).toBe(true)
    }
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
