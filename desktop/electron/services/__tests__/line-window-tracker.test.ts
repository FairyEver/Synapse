import { describe, expect, it } from "vitest"

import type { TerminalStyledLine } from "../../../app-capabilities/terminal/main/emulator"
import {
  LineWindowTracker,
  findEvictionOffset,
} from "../mobile-gateway/line-window-tracker"

function line(text: string): TerminalStyledLine {
  return { text }
}

function lines(...texts: string[]): TerminalStyledLine[] {
  return texts.map(line)
}

/** A window long enough to clear the tracker's minimum overlap guard. */
function windowOf(prefix: string, count: number, startIndex = 0): TerminalStyledLine[] {
  return Array.from({ length: count }, (_, index) => line(`${prefix}-${startIndex + index}`))
}

describe("LineWindowTracker", () => {
  it("reports no update when the terminal is idle", () => {
    const tracker = new LineWindowTracker()
    expect(tracker.push(lines("a", "b"))).not.toBeNull()
    expect(tracker.push(lines("a", "b"))).toBeNull()
  })

  it("sends only the appended tail", () => {
    const tracker = new LineWindowTracker()
    tracker.push(lines("a", "b"))

    const update = tracker.push(lines("a", "b", "c"))

    expect(update).toMatchObject({
      from: 2,
      total: 3,
      newWindowStart: 0,
      truncated: false,
    })
    expect(update?.lines.map((entry) => entry.text)).toEqual(["c"])
  })

  it("resumes at the divergence point when a line is rewritten in place", () => {
    const tracker = new LineWindowTracker()
    tracker.push(lines("a", "b", "c", "d"))

    // What a progress bar or an in-place status line does: same line count, new content.
    const update = tracker.push(lines("a", "b", "c!", "d!"))

    expect(update).toMatchObject({ from: 2, total: 4, truncated: false })
    expect(update?.lines.map((entry) => entry.text)).toEqual(["c!", "d!"])
  })

  it("advances the index past lines that scrolled out of the emulator", () => {
    const tracker = new LineWindowTracker()
    tracker.push(windowOf("row", 10))

    // One line scrolled off the top and one was appended, as xterm's ring buffer does
    // once scrollback is full. A naive diff would resend the whole window here.
    const update = tracker.push(windowOf("row", 10, 1))

    expect(update?.truncated).toBe(true)
    expect(update?.newWindowStart).toBe(1)
    expect(update?.lines.map((entry) => entry.text)).toEqual(["row-10"])
    expect(update?.total).toBe(11)
  })

  it("keeps the index continuous across repeated evictions", () => {
    const tracker = new LineWindowTracker()
    tracker.push(windowOf("row", 20))

    let update = tracker.push(windowOf("row", 20, 3))
    expect(update?.newWindowStart).toBe(3)
    update = tracker.push(windowOf("row", 20, 7))
    expect(update?.newWindowStart).toBe(7)

    // A client that applied every update holds a gap-free run ending at `total`.
    expect(tracker.snapshot().total).toBe(27)
  })

  it("does not claim an eviction from a short coincidental overlap", () => {
    // Only one line bridges the two windows, which duplicate content makes possible
    // by accident. Trusting it would skip content the client never received.
    expect(findEvictionOffset(lines("a", "b"), lines("b", "c"))).toBe(0)

    const tracker = new LineWindowTracker()
    tracker.push(lines("a", "b"))
    const update = tracker.push(lines("x", "y"))
    expect(update).toMatchObject({ from: 0, truncated: true })
    expect(update?.lines.map((entry) => entry.text)).toEqual(["x", "y"])
  })

  it("restarts from the window when the screens share nothing", () => {
    const tracker = new LineWindowTracker()
    tracker.push(windowOf("before", 10))

    // An alternate-screen switch or `clear` replaces everything at once.
    const update = tracker.push(windowOf("after", 4))

    expect(update?.newWindowStart).toBe(0)
    expect(update?.from).toBe(0)
    expect(update?.truncated).toBe(true)
    expect(update?.lines).toHaveLength(4)
  })

  it("handles a shrinking window without reporting an eviction", () => {
    const tracker = new LineWindowTracker()
    tracker.push(windowOf("row", 12))

    const update = tracker.push(windowOf("row", 5))

    expect(update?.newWindowStart).toBe(0)
    expect(update?.from).toBe(5)
    expect(update?.lines).toHaveLength(0)
    expect(update?.total).toBe(5)
  })

  it("compares styling, not just text", () => {
    const tracker = new LineWindowTracker()
    tracker.push([{ text: "hello" }])

    const update = tracker.push([{
      text: "hello",
      runs: [{
        start: 0,
        length: 5,
        foreground: 2,
        background: -1,
        bold: false,
        italic: false,
        underline: false,
        dim: false,
        inverse: false,
      }],
    }])

    expect(update).toMatchObject({ from: 0 })
  })

  it("exposes a full snapshot for a fresh client", () => {
    const tracker = new LineWindowTracker()
    tracker.push(windowOf("row", 6))

    expect(tracker.snapshot()).toMatchObject({ from: 0, total: 6, truncated: false })
    expect(tracker.snapshot().lines).toHaveLength(6)
  })

  it("forgets everything on reset", () => {
    const tracker = new LineWindowTracker()
    tracker.push(windowOf("row", 6))

    tracker.reset()

    expect(tracker.snapshot()).toMatchObject({ from: 0, total: 0 })
  })

  it("grows from an empty buffer on the first read", () => {
    const tracker = new LineWindowTracker()
    const update = tracker.push(lines("first"))

    expect(update).toMatchObject({ from: 0, total: 1, truncated: true })
  })
})
