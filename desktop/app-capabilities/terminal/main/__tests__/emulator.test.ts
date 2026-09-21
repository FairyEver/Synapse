import { Buffer } from "node:buffer"
import { Terminal } from "@xterm/headless"
import { describe, expect, it, vi } from "vitest"

import { installTerminalUnicodeWidth } from "../../shared/terminal-unicode-width"
import {
  TERMINAL_STYLE_DEFAULT_COLOR,
  TERMINAL_STYLE_TRUECOLOR_BASE,
  createTerminalCoreEmulator,
} from "../emulator"
import type { TerminalStyledLine, TerminalStyledRun } from "../emulator"

describe("TerminalCoreEmulator renderer snapshots", () => {
  it("reports standard terminal notification OSC sequences without exposing their content", async () => {
    const onNotification = vi.fn()
    const emulator = createTerminalCoreEmulator({
      cols: 80,
      rows: 24,
      sizeRevision: 1,
      onNotification,
    })
    try {
      await emulator.accept("\u001b]9;finished\u0007\u001b]777;notify;Agent;done\u0007", 1)
      expect(onNotification).toHaveBeenCalledWith({ protocol: 9, value: "finished" })
      expect(onNotification).toHaveBeenCalledWith({ protocol: 777, value: "notify;Agent;done" })
    } finally {
      emulator.dispose()
    }
  })

  it("tracks an OSC 7 working directory for subsequent pane creation", async () => {
    const onWorkingDirectoryChanged = vi.fn()
    const emulator = createTerminalCoreEmulator({
      cols: 80,
      rows: 24,
      sizeRevision: 1,
      onWorkingDirectoryChanged,
    })
    try {
      await emulator.accept("\u001b]7;file:///tmp/project%20one\u0007", 1)
      await emulator.accept("\u001b]7;file:///tmp/project%20one\u0007", 2)
      expect(emulator.currentCwd).toBe("/tmp/project one")
      expect(onWorkingDirectoryChanged).toHaveBeenCalledTimes(1)
      expect(onWorkingDirectoryChanged).toHaveBeenCalledWith()
    } finally {
      emulator.dispose()
    }
  })

  it("orders resize behind prior output and restores the serialized state", async () => {
    const emulator = createTerminalCoreEmulator({
      cols: 80,
      rows: 24,
      sizeRevision: 1,
    })
    const restored = createTerminalCoreEmulator({
      cols: 100,
      rows: 30,
      sizeRevision: 2,
    })
    try {
      await emulator.accept("\u001b[2J\u001b[Hbefore\u001b[?2004h", 1)
      const resize = emulator.resize(100, 30, 2)
      const laterOutput = emulator.accept("\u001b[30;1Hafter", 2)

      await expect(resize).resolves.toEqual({
        throughOutputSeq: 1,
        sizeRevision: 2,
      })
      await laterOutput

      const snapshot = await emulator.captureSnapshot(1024 * 1024)
      expect(snapshot).toMatchObject({
        throughOutputSeq: 2,
        sizeRevision: 2,
        scrollbackTruncated: false,
      })
      expect(snapshot.serialized).not.toBeNull()

      await restored.accept(snapshot.serialized!, snapshot.throughOutputSeq)
      expect(restored.getView({ kind: "screen", maxBytes: 64 * 1024 }))
        .toMatchObject({
          lines: emulator.getView({ kind: "screen", maxBytes: 64 * 1024 }).lines,
          textCursor: emulator.getView({ kind: "screen", maxBytes: 64 * 1024 }).textCursor,
          cols: 100,
          rows: 30,
          throughOutputSeq: 2,
          sizeRevision: 2,
        })
      expect(restored.bracketedPasteEvidence().enabled).toBe(true)
    } finally {
      emulator.dispose()
      restored.dispose()
    }
  })

  it("preserves SGR mouse reporting in renderer snapshots", async () => {
    const emulator = createTerminalCoreEmulator({
      cols: 80,
      rows: 24,
      sizeRevision: 1,
    })
    try {
      await emulator.accept("\u001b[?1000h\u001b[?1006h", 1)

      const snapshot = await emulator.captureSnapshot(1024 * 1024)

      expect(snapshot.serialized).toContain("\u001b[?1000h")
      expect(snapshot.serialized).toContain("\u001b[?1006h")
    } finally {
      emulator.dispose()
    }
  })

  it("trims the oldest scrollback to keep renderer snapshots bounded", async () => {
    const emulator = createTerminalCoreEmulator({
      cols: 80,
      rows: 24,
      scrollback: 2_000,
      sizeRevision: 1,
    })
    try {
      const output = Array.from({ length: 1_000 }, (_, index) =>
        `${String(index).padStart(4, "0")} ${"终端历史".repeat(20)}\r\n`).join("")
      await emulator.accept(output, 1)

      const snapshot = await emulator.captureSnapshot(64 * 1024)

      expect(snapshot.serialized).not.toBeNull()
      expect(snapshot.scrollbackTruncated).toBe(true)
      expect(Buffer.byteLength(snapshot.serialized!, "utf8")).toBeLessThanOrEqual(64 * 1024)
      expect(snapshot.serialized).toContain("0999")
    } finally {
      emulator.dispose()
    }
  })

  it("counts agent CLI status glyphs as two cells", async () => {
    const emulator = createTerminalCoreEmulator({
      cols: 40,
      rows: 4,
      sizeRevision: 1,
    })
    try {
      await emulator.accept("⏺ Bash(cd /tmp)\r\n◼ Java 候选逐条复核", 1)

      const view = emulator.getView({ kind: "screen", maxBytes: 4096 })

      expect(view.lines[0]).toBe("⏺ Bash(cd /tmp)")
      expect(view.lines[1]).toBe("◼ Java 候选逐条复核")
      expect(view.textCursor.x).toBe(20)
    } finally {
      emulator.dispose()
    }
  })

  it("wraps emoji lines at the width the agent CLIs assume", async () => {
    const emulator = createTerminalCoreEmulator({
      cols: 10,
      rows: 4,
      sizeRevision: 1,
    })
    try {
      await emulator.accept(`${"⏺".repeat(5)}a`, 1)

      const view = emulator.getView({ kind: "screen", maxBytes: 4096 })

      expect(view.lines.slice(0, 2)).toEqual(["⏺⏺⏺⏺⏺", "a"])
    } finally {
      emulator.dispose()
    }
  })
})

describe("TerminalCoreEmulator styled line windows", () => {
  it("returns trimmed plain lines with no styling payload for unstyled output", async () => {
    const emulator = createTerminalCoreEmulator({ cols: 40, rows: 6, sizeRevision: 1 })
    try {
      await emulator.accept("hello\r\nworld", 1)

      const window = emulator.readLineWindow({ maxLines: 10 })

      expect(window.lines[0]).toEqual({ text: "hello" })
      expect(window.lines[1]).toEqual({ text: "world" })
      expect(window.alt).toBe(false)
      expect(window.throughOutputSeq).toBe(1)
    } finally {
      emulator.dispose()
    }
  })

  it("reports the cursor hidden exactly while the program asked for that", async () => {
    const emulator = createTerminalCoreEmulator({ cols: 40, rows: 6, sizeRevision: 1 })
    try {
      await emulator.accept("prompt$ ", 1)
      expect(emulator.readLineWindow({ maxLines: 10 }).cursor.visible).toBe(true)

      // DECTCEM off is what a full-screen program sends while it draws a cursor of
      // its own, Claude Code included.
      await emulator.accept("\u001b[?25l", 2)
      expect(emulator.readLineWindow({ maxLines: 10 }).cursor.visible).toBe(false)

      await emulator.accept("\u001b[?25h", 3)
      expect(emulator.readLineWindow({ maxLines: 10 }).cursor.visible).toBe(true)
    } finally {
      emulator.dispose()
    }
  })

  it("keeps the cursor mode across a sequence split between chunks", async () => {
    const emulator = createTerminalCoreEmulator({ cols: 40, rows: 6, sizeRevision: 1 })
    try {
      await emulator.accept("out\u001b[?2", 1)
      await emulator.accept("5l", 2)

      expect(emulator.readLineWindow({ maxLines: 10 }).cursor.visible).toBe(false)
    } finally {
      emulator.dispose()
    }
  })

  it("keeps foreground runs and omits run entries for default-styled spans", async () => {
    const emulator = createTerminalCoreEmulator({ cols: 40, rows: 6, sizeRevision: 1 })
    try {
      // "red" in palette colour 1, then " plain" with default styling.
      await emulator.accept("\u001b[31mred\u001b[0m plain", 1)

      const line = emulator.readLineWindow({ maxLines: 10 }).lines[0]

      expect(line.text).toBe("red plain")
      expect(line.runs).toEqual([
        {
          start: 0,
          length: 3,
          foreground: 1,
          background: TERMINAL_STYLE_DEFAULT_COLOR,
          bold: false,
          italic: false,
          underline: false,
          dim: false,
          inverse: false,
        },
      ])
    } finally {
      emulator.dispose()
    }
  })

  it("separates adjacent runs that differ only by attribute", async () => {
    const emulator = createTerminalCoreEmulator({ cols: 40, rows: 6, sizeRevision: 1 })
    try {
      await emulator.accept("\u001b[1mbold\u001b[22m plain", 1)

      const line = emulator.readLineWindow({ maxLines: 10 }).lines[0]

      expect(line.text).toBe("bold plain")
      expect(line.runs).toHaveLength(1)
      expect(line.runs?.[0]).toMatchObject({ start: 0, length: 4, bold: true })
    } finally {
      emulator.dispose()
    }
  })

  it("encodes truecolor distinctly from palette indices", async () => {
    const emulator = createTerminalCoreEmulator({ cols: 40, rows: 6, sizeRevision: 1 })
    try {
      await emulator.accept("\u001b[38;2;18;52;86mdeep\u001b[0m", 1)

      const line = emulator.readLineWindow({ maxLines: 10 }).lines[0]

      expect(line.runs?.[0]?.foreground).toBe(
        TERMINAL_STYLE_TRUECOLOR_BASE | (18 << 16) | (52 << 8) | 86,
      )
    } finally {
      emulator.dispose()
    }
  })

  it("bounds the window to the tail and reports the buffer offset", async () => {
    const emulator = createTerminalCoreEmulator({ cols: 40, rows: 4, sizeRevision: 1 })
    try {
      await emulator.accept(Array.from({ length: 30 }, (_, index) => `line${index}`).join("\r\n"), 1)

      const window = emulator.readLineWindow({ maxLines: 5 })

      expect(window.lines).toHaveLength(5)
      expect(window.lines.at(-1)?.text).toBe("line29")
      expect(window.startIndex).toBe(window.totalLines - 5)
    } finally {
      emulator.dispose()
    }
  })

  it("places the cursor relative to the returned window", async () => {
    const emulator = createTerminalCoreEmulator({ cols: 40, rows: 6, sizeRevision: 1 })
    try {
      await emulator.accept("one\r\ntwo\r\nthree", 1)

      const window = emulator.readLineWindow({ maxLines: 10 })
      const cursorLine = window.lines[window.cursor.row]

      expect(cursorLine?.text).toBe("three")
      expect(window.cursor.col).toBe(5)
    } finally {
      emulator.dispose()
    }
  })

  it("keeps the blank cells a cursor jump stepped over", async () => {
    const emulator = createTerminalCoreEmulator({ cols: 40, rows: 6, sizeRevision: 1 })
    try {
      // A footer drawn with absolute positioning, the way a status line pads
      // between segments. The gap is real space on screen.
      await emulator.accept("left\u001b[9Gright", 1)

      expect(emulator.readLineWindow({ maxLines: 10 }).lines[0].text).toBe("left    right")
    } finally {
      emulator.dispose()
    }
  })

  it("reports the alternate screen while a TUI owns the terminal", async () => {
    const emulator = createTerminalCoreEmulator({ cols: 40, rows: 6, sizeRevision: 1 })
    try {
      await emulator.accept("\u001b[?1049halt screen", 1)
      expect(emulator.readLineWindow({ maxLines: 10 }).alt).toBe(true)
    } finally {
      emulator.dispose()
    }
  })
})

type RawBuffer = Terminal["buffer"]["active"]
type RawLine = NonNullable<ReturnType<RawBuffer["getLine"]>>
type RawCell = ReturnType<RawBuffer["getNullCell"]>

// The reader under test searches for the line's visible end from the right, so it
// reads a different set of cells than it used to for the same answer. What must not
// change is the answer, and the wire bytes built from it — hence a verbatim copy of
// the pre-change pair to diff against. Editing this copy to make a test pass defeats
// the exercise; if the behaviour is deliberately changed, change it here knowingly.
function referenceReadCellColor(cell: RawCell, foreground: boolean): number {
  const isRgb = foreground ? cell.isFgRGB() : cell.isBgRGB()
  if (isRgb) {
    const value = foreground ? cell.getFgColor() : cell.getBgColor()
    return TERMINAL_STYLE_TRUECOLOR_BASE | (value & 0xff_ffff)
  }
  const isPalette = foreground ? cell.isFgPalette() : cell.isBgPalette()
  if (isPalette) {
    const value = foreground ? cell.getFgColor() : cell.getBgColor()
    return value & 0xff
  }
  return TERMINAL_STYLE_DEFAULT_COLOR
}

function referenceTrimmedCellCount(line: RawLine, scratch: RawCell): number {
  let end = 0
  for (let x = 0; x < line.length; x += 1) {
    const cell = line.getCell(x, scratch)
    if (!cell) break
    const chars = cell.getChars()
    if (chars.length > 0 && chars.trim().length > 0) end = x + 1
  }
  return end
}

function referenceReadStyledLine(line: RawLine | undefined, scratch: RawCell): TerminalStyledLine {
  if (!line) return { text: "" }
  const end = referenceTrimmedCellCount(line, scratch)
  if (end === 0) return { text: "" }

  let text = ""
  const runs: TerminalStyledRun[] = []
  let runStart = 0
  let runForeground = TERMINAL_STYLE_DEFAULT_COLOR
  let runBackground = TERMINAL_STYLE_DEFAULT_COLOR
  let runBold = false
  let runItalic = false
  let runUnderline = false
  let runDim = false
  let runInverse = false
  let runOpen = false

  const closeRun = (endOffset: number): void => {
    if (!runOpen) return
    const styled = runForeground !== TERMINAL_STYLE_DEFAULT_COLOR
      || runBackground !== TERMINAL_STYLE_DEFAULT_COLOR
      || runBold || runItalic || runUnderline || runDim || runInverse
    if (styled && endOffset > runStart) {
      runs.push({
        start: runStart,
        length: endOffset - runStart,
        foreground: runForeground,
        background: runBackground,
        bold: runBold,
        italic: runItalic,
        underline: runUnderline,
        dim: runDim,
        inverse: runInverse,
      })
    }
    runOpen = false
  }

  let wideTrailer = false
  for (let x = 0; x < end; x += 1) {
    const cell = line.getCell(x, scratch)
    if (!cell) break
    const chars = cell.getChars()
    if (chars.length === 0) {
      if (!wideTrailer) text += " "
      wideTrailer = false
      continue
    }
    wideTrailer = cell.getWidth() === 2
    const foreground = referenceReadCellColor(cell, true)
    const background = referenceReadCellColor(cell, false)
    const bold = cell.isBold() !== 0
    const italic = cell.isItalic() !== 0
    const underline = cell.isUnderline() !== 0
    const dim = cell.isDim() !== 0
    const inverse = cell.isInverse() !== 0
    if (runOpen && (foreground !== runForeground
      || background !== runBackground
      || bold !== runBold
      || italic !== runItalic
      || underline !== runUnderline
      || dim !== runDim
      || inverse !== runInverse)) {
      closeRun(text.length)
    }
    if (!runOpen) {
      runStart = text.length
      runForeground = foreground
      runBackground = background
      runBold = bold
      runItalic = italic
      runUnderline = underline
      runDim = dim
      runInverse = inverse
      runOpen = true
    }
    text += chars
  }
  closeRun(text.length)
  return runs.length > 0 ? { text, runs } : { text }
}

/**
 * The emulator wraps a headless terminal of its own, so the oracle needs a second one
 * fed the same bytes. It has to carry the same width table, otherwise emoji wrap at
 * different columns and the two buffers stop being comparable.
 */
function createStyledLineDiff(cols = 40, rows = 6) {
  const emulator = createTerminalCoreEmulator({ cols, rows, scrollback: 500, sizeRevision: 1 })
  const oracle = new Terminal({ cols, rows, scrollback: 500, allowProposedApi: true })
  installTerminalUnicodeWidth(oracle)

  return {
    async feed(input: string): Promise<void> {
      await emulator.accept(input, 1)
      await new Promise<void>((resolve) => { oracle.write(input, () => resolve()) })
    },
    readLines(maxLines = 10_000): readonly TerminalStyledLine[] {
      return emulator.readLineWindow({ maxLines }).lines
    },
    expectSameLines(): void {
      const buffer = oracle.buffer.active
      const scratch = buffer.getNullCell()
      const expected: TerminalStyledLine[] = []
      for (let index = 0; index < buffer.length; index += 1) {
        expected.push(referenceReadStyledLine(buffer.getLine(index), scratch))
      }
      const actual = emulator.readLineWindow({ maxLines: 10_000 }).lines
      expect(actual.length).toBe(expected.length)
      for (let index = 0; index < expected.length; index += 1) {
        expect(actual[index], `line ${index} of ${expected.length}`).toEqual(expected[index])
      }
    },
    dispose(): void {
      emulator.dispose()
      oracle.dispose()
    },
  }
}

async function expectStyledLinesMatchReference(
  input: string,
  options?: { readonly cols?: number; readonly rows?: number },
): Promise<readonly TerminalStyledLine[]> {
  const diff = createStyledLineDiff(options?.cols, options?.rows)
  try {
    await diff.feed(input)
    diff.expectSameLines()
    return diff.readLines()
  } finally {
    diff.dispose()
  }
}

describe("TerminalCoreEmulator styled lines match the pre-change reader", () => {
  it("keeps plain text rows identical", async () => {
    const lines = await expectStyledLinesMatchReference(
      "hello world\r\nsecond line\r\nthird",
    )

    expect(lines[0]).toEqual({ text: "hello world" })
    expect(lines[1]).toEqual({ text: "second line" })
  })

  it("keeps rows whose text stops short of the right edge identical", async () => {
    const lines = await expectStyledLinesMatchReference(
      "short\r\nwritten trailing blanks   \r\nlast\r\n",
    )

    expect(lines[0]).toEqual({ text: "short" })
    expect(lines[1]).toEqual({ text: "written trailing blanks" })
  })

  it("keeps text that follows a blank gap in the middle of a row", async () => {
    // The gap is the equivalence trap: the blank cells in front of "right" carry no
    // characters, and the row's visible end has to stay past them.
    const lines = await expectStyledLinesMatchReference(
      "left\u001b[9Gright\r\na\u001b[6Gb\u001b[20Gc\r\n\u001b[31mred\u001b[0m\u001b[12Gtail",
    )

    expect(lines[0]?.text).toBe("left    right")
    expect(lines[1]?.text).toBe("a    b             c")
    expect(lines[2]?.text).toBe(`red${" ".repeat(8)}tail`)
    // The blank cells carry no style to compare, so they stay inside the run the
    // reader is already in instead of opening one of their own.
    expect(lines[2]?.runs).toEqual([
      expect.objectContaining({ start: 0, length: 11, foreground: 1 }),
    ])
  })

  it("keeps blank and whitespace-only rows empty", async () => {
    const lines = await expectStyledLinesMatchReference("\r\n\r\n    \r\n\u001b[41m   \u001b[0m\r\n")

    for (const line of lines) {
      expect(line).toEqual({ text: "" })
    }
  })

  it("keeps wide characters and their trailing cells identical", async () => {
    const lines = await expectStyledLinesMatchReference(
      "中文测试\r\n中x\r\n\u001b[32m中\u001b[0m tail\r\n⏺ Read\r\n😀 emoji 👍🏽 ok\r\n\u001b[39G中",
      { cols: 40, rows: 8 },
    )

    expect(lines[0]?.text).toBe("中文测试")
    expect(lines[1]?.text).toBe("中x")
    // A wide glyph parked at the last column that can still hold both of its cells.
    expect(lines[5]?.text).toBe(`${" ".repeat(38)}中`)
  })

  it("keeps every attribute-change boundary and the run cut off by the trimmed end", async () => {
    const lines = await expectStyledLinesMatchReference(
      "\u001b[31mred\u001b[0m plain\u001b[1mbold\u001b[22m normal\r\n"
      + "\u001b[3mitalic\u001b[23m \u001b[4munderline\u001b[24m \u001b[7minverse\u001b[27m \u001b[2mdim\u001b[22m\r\n"
      + "\u001b[38;2;18;52;86mtruecolor\u001b[0m \u001b[48;5;208mon palette\u001b[0m\r\n"
      + "\u001b[41mnever reset",
    )

    expect(lines[0]?.runs).toEqual([
      expect.objectContaining({ start: 0, length: 3, foreground: 1 }),
      expect.objectContaining({ start: 9, length: 4, bold: true }),
    ])
    expect(lines[2]?.runs).toEqual([
      expect.objectContaining({ start: 0, length: 9, foreground: TERMINAL_STYLE_TRUECOLOR_BASE | (18 << 16) | (52 << 8) | 86 }),
      expect.objectContaining({ start: 10, length: 10, background: 208 }),
    ])
  })

  it("closes the last run at the trimmed end rather than the row width", async () => {
    const lines = await expectStyledLinesMatchReference(
      "\u001b[41mred on red\u001b[0m plain   \r\n\u001b[42mnever reset",
    )

    // The reset arrives before the row ends, so the run stops where the text does.
    expect(lines[0]?.runs?.[0]).toMatchObject({ start: 0, length: 10 })
    // This one is never reset: the run has to be closed at the trimmed end, not at
    // the 40th column, or the phone paints the whole row green.
    const lastRun = lines[1]?.runs?.at(-1)
    expect(lastRun).toMatchObject({ start: 0, length: 11 })
    expect(lines[1]?.runs?.at(-1)?.start).toBe(0)
    expect((lastRun?.start ?? 0) + (lastRun?.length ?? 0)).toBe(lines[1]?.text.length)
  })

  it("keeps rows that fill the width identical", async () => {
    const cols = 40
    const full = "x".repeat(cols)
    const lines = await expectStyledLinesMatchReference(
      `${full}\r\n\u001b[1m${"y".repeat(cols)}\u001b[22m\r\n${full}`,
      { cols, rows: 6 },
    )

    expect(lines[0]).toEqual({ text: full })
    expect(lines[1]?.text).toBe("y".repeat(cols))
    expect(lines[1]?.runs).toEqual([expect.objectContaining({ start: 0, length: cols, bold: true })])
    expect(lines[2]).toEqual({ text: full })
  })

  it("keeps rows padded by cursor jumps identical", async () => {
    const lines = await expectStyledLinesMatchReference(
      "a\u001b[20Gb\r\n\u001b[15C\u001b[31mz\u001b[0m\r\n\u001b[38G\u001b[7mw\u001b[27m",
    )

    expect(lines[0]?.text).toBe(`a${" ".repeat(18)}b`)
    expect(lines[1]?.text).toBe(`${" ".repeat(15)}z`)
    expect(lines[2]?.text).toBe(`${" ".repeat(37)}w`)
  })

  it("keeps randomly styled output identical across many writes", async () => {
    // "e" followed by a combining acute: a cell holding more than one code unit.
    const alphabet = ["a", "bc", "defg", " ", "  ", "中", "中文", "⏺", "😀", "e\u0301", "\t"]
    const sgr = [
      "\u001b[0m", "\u001b[1m", "\u001b[22m", "\u001b[3m", "\u001b[23m", "\u001b[4m",
      "\u001b[24m", "\u001b[2m", "\u001b[7m", "\u001b[27m", "\u001b[31m", "\u001b[42m",
      "\u001b[39m", "\u001b[49m", "\u001b[38;5;208m", "\u001b[48;2;9;9;9m",
    ]
    const cursor = ["\u001b[4G", "\u001b[9G", "\u001b[2C", "\u001b[30G", "\u001b[1A", "\r\n", "\n", "\r"]
    // Fixed seed: a failure here has to be reproducible.
    let state = 0x5eed_1234
    const next = (bound: number): number => {
      state = (state * 1664525 + 1013904223) >>> 0
      return state % bound
    }

    const diff = createStyledLineDiff(40, 6)
    try {
      let sawStyledRun = false
      for (let round = 0; round < 60; round += 1) {
        const pools = [alphabet, alphabet, alphabet, sgr, cursor]
        let fragment = ""
        for (let piece = 0; piece < 6; piece += 1) {
          const pool = pools[next(pools.length)]
          fragment += pool[next(pool.length)]
        }
        await diff.feed(fragment)
        diff.expectSameLines()
        sawStyledRun ||= diff.readLines().some((line) => (line.runs?.length ?? 0) > 0)
      }
      expect(sawStyledRun).toBe(true)
      expect(diff.readLines().some((line) => line.text.includes("中"))).toBe(true)
    } finally {
      diff.dispose()
    }
  })
})

describe("TerminalCoreEmulator styled line traversal cost", () => {
  it("reads a full row about once per cell instead of twice", async () => {
    const cols = 60
    const rows = 4
    const emulator = createTerminalCoreEmulator({ cols, rows, scrollback: 200, sizeRevision: 1 })
    const probe = new Terminal({ cols: 8, rows: 2, allowProposedApi: true })
    const linePrototype = Object.getPrototypeOf(probe.buffer.active.getLine(0)) as {
      getCell(x: number, cell?: unknown): unknown
    }
    probe.dispose()
    try {
      // Text all the way to the last column: the visible end sits as far right as it
      // can, which is where a left-to-right search for it costs a whole row before the
      // line is even built. `readLineWindow({ maxLines: 1 })` then measures that row
      // alone.
      const full = "x".repeat(cols)
      await emulator.accept(`${"\r\n".repeat(rows - 1)}${full}`, 1)

      const spy = vi.spyOn(linePrototype, "getCell")
      const window = emulator.readLineWindow({ maxLines: 1 })
      const calls = spy.mock.calls.length
      spy.mockRestore()

      expect(window.lines.map((line) => line.text)).toEqual([full])
      // One pass finds the glyph in the last column, the other builds the text from
      // it. Twice the width would mean the trimmed-length search walked the row again.
      // 61 today: one cell to find the glyph in the last column, 60 to build the
      // text. Twice the width means the trimmed-length search walked the row again.
      expect(calls).toBeLessThanOrEqual(cols + 4)
    } finally {
      emulator.dispose()
    }
  })
})
