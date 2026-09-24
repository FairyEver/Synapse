import { SerializeAddon } from "@xterm/addon-serialize"
import { Terminal } from "@xterm/headless"
import { fileURLToPath } from "node:url"

import { installTerminalUnicodeWidth } from "../shared/terminal-unicode-width"

// xterm does not export IBuffer/IBufferLine/IBufferCell, so they are recovered
// from the public Terminal surface.
type TerminalActiveBuffer = Terminal["buffer"]["active"]
type TerminalBufferLine = NonNullable<ReturnType<TerminalActiveBuffer["getLine"]>>
type TerminalBufferCell = ReturnType<TerminalActiveBuffer["getNullCell"]>

export const TERMINAL_EMULATOR_ID = "xterm-headless" as const
export const TERMINAL_EMULATOR_VERSION = "6.0.0" as const

/** `-1` for the terminal default, `0..255` for a palette index, `0x1000000 | rgb` for truecolor. */
export const TERMINAL_STYLE_DEFAULT_COLOR = -1
export const TERMINAL_STYLE_TRUECOLOR_BASE = 0x1000000

/**
 * A run of adjacent cells sharing one style. Deliberately semantic rather than
 * wire-shaped: the emulator has no business knowing about the mobile protocol,
 * so the caller compacts this into whatever representation it ships.
 */
export type TerminalStyledRun = {
  readonly start: number
  readonly length: number
  readonly foreground: number
  readonly background: number
  readonly bold: boolean
  readonly italic: boolean
  readonly underline: boolean
  readonly dim: boolean
  readonly inverse: boolean
}

export type TerminalStyledLine = {
  readonly text: string
  /** This physical row continues the preceding row in xterm's buffer. */
  readonly wrappedFromPrevious?: true
  /** The following physical row continues this one. */
  readonly wrappedToNext?: true
  /** Absent when the whole line uses default styling, which is the common case. */
  readonly runs?: readonly TerminalStyledRun[]
}

export type TerminalLineWindow = {
  readonly lines: readonly TerminalStyledLine[]
  /**
   * Buffer index of `lines[0]`. Only meaningful within one read: xterm recycles
   * its ring buffer once scrollback is full, so indices slide. Callers that need
   * a stable line number must keep their own counter.
   */
  readonly startIndex: number
  readonly totalLines: number
  readonly cols: number
  readonly rows: number
  /** `row` is relative to `lines[0]`. */
  readonly cursor: { readonly row: number; readonly col: number; readonly visible: boolean }
  readonly alt: boolean
  readonly throughOutputSeq: number
  readonly sizeRevision: number
}

export type TerminalRenderedView = {
  readonly kind: "screen" | "scrollback"
  readonly lines: string[]
  readonly cols: number
  readonly rows: number
  /**
   * Where the emulator's text cursor sits, not a continuation token. Everywhere else in this
   * domain `cursor` means an opaque pagination cursor bound to a query, so this field is
   * named for what it is rather than taking that word.
   */
  readonly textCursor: { readonly x: number; readonly y: number }
  readonly generatedAt: string
  readonly throughOutputSeq: number
  readonly sizeRevision: number
  readonly emulatorId: typeof TERMINAL_EMULATOR_ID
  readonly emulatorVersion: typeof TERMINAL_EMULATOR_VERSION
  readonly degraded: boolean
  readonly reasons: string[]
  readonly hasMore: boolean
}

export type TerminalCoreEmulator = ReturnType<typeof createTerminalCoreEmulator>

export type TerminalEmulatorSnapshot = {
  readonly serialized: string | null
  readonly throughOutputSeq: number
  readonly sizeRevision: number
  readonly scrollbackTruncated: boolean
}

type TerminalWithMouseEncoding = Terminal & {
  readonly _core?: {
    readonly coreMouseService?: {
      readonly activeEncoding?: string
    }
  }
}

export function createTerminalCoreEmulator(input: {
  readonly cols: number
  readonly rows: number
  readonly scrollback?: number
  readonly throughOutputSeq?: number
  readonly sizeRevision: number
  readonly logger?: { warn(message: string, meta?: Record<string, unknown>): void }
  readonly onWorkingDirectoryChanged?: () => void
  readonly onNotification?: (input: { readonly protocol: 9 | 99 | 777; readonly value: string }) => void
}) {
  const terminal = new Terminal({
    cols: input.cols,
    rows: input.rows,
    // Matches the desktop's own visible terminal. The phone's scrollback bound is
    // this number: it is the deepest history the desktop can still offer, and
    // lines evicted here are gone for both. Costs memory per session, which is
    // why it is a deliberate constant and not just "large".
    scrollback: input.scrollback ?? 5_000,
    allowProposedApi: true,
  })
  const unicodeWidthStatus = installTerminalUnicodeWidth(terminal)
  if (unicodeWidthStatus !== "patched") {
    input.logger?.warn("Terminal emulator unicode width table fell back.", { status: unicodeWidthStatus })
  }
  const serializer = new SerializeAddon()
  terminal.loadAddon(serializer)
  let throughOutputSeq = input.throughOutputSeq ?? 0
  let sizeRevision = input.sizeRevision
  let modeEvidenceFresh = false
  let currentCwd: string | undefined
  let writeChain = Promise.resolve()

  terminal.parser.registerOscHandler(7, (value) => {
    try {
      const url = new URL(value)
      if (url.protocol !== "file:") return false
      const nextCwd = fileURLToPath(url)
      if (nextCwd !== currentCwd) {
        currentCwd = nextCwd
        input.onWorkingDirectoryChanged?.()
      }
      return true
    } catch {
      return false
    }
  })

  for (const protocol of [9, 99, 777] as const) {
    terminal.parser.registerOscHandler(protocol, (value) => {
      input.onNotification?.({ protocol, value })
      return true
    })
  }

  /**
   * DECTCEM — `ESC[?25l` hides the terminal's own cursor, `ESC[?25h` shows it — is
   * how a full-screen program draws a cursor of its own instead. Every TUI does it,
   * Claude Code included, which is why a real terminal shows no cursor next to
   * Claude's input box.
   *
   * xterm does not expose the mode, so it is read from the byte stream here.
   * Reporting it as permanently visible made remote clients draw a block the
   * program had deliberately hidden.
   */
  let cursorHidden = false
  /** A sequence can straddle two chunks; a short tail catches the split. */
  let decPrivateModeTail = ""

  function trackCursorVisibility(data: string): void {
    const scan = decPrivateModeTail + data
    for (const match of scan.matchAll(/\x1b\[\?25([hl])/gu)) {
      cursorHidden = match[1] === "l"
    }
    decPrivateModeTail = scan.slice(-8)
  }

  function accept(data: string, outputSeq: number): Promise<void> {
    trackCursorVisibility(data)
    writeChain = writeChain.then(() => new Promise<void>((resolve) => {
      terminal.write(data, () => {
        throughOutputSeq = outputSeq
        modeEvidenceFresh = true
        resolve()
      })
    }))
    return writeChain
  }

  function resize(cols: number, rows: number, revision: number): Promise<{
    readonly throughOutputSeq: number
    readonly sizeRevision: number
  }> {
    const resizeOperation = writeChain.then(() => {
      const resizeAfterOutputSeq = throughOutputSeq
      terminal.resize(cols, rows)
      sizeRevision = revision
      modeEvidenceFresh = false
      return { throughOutputSeq: resizeAfterOutputSeq, sizeRevision }
    })
    writeChain = resizeOperation.then(() => undefined)
    return resizeOperation
  }

  function getView(input: {
    readonly kind: "screen" | "scrollback"
    readonly tailLines?: number
    readonly maxBytes: number
  }): TerminalRenderedView {
    const buffer = terminal.buffer.active
    const screenStart = Math.max(0, buffer.baseY)
    const sourceStart = input.kind === "screen"
      ? screenStart
      : Math.max(0, buffer.length - (input.tailLines ?? 200))
    const sourceEnd = input.kind === "screen"
      ? Math.min(buffer.length, screenStart + terminal.rows)
      : buffer.length
    const lines: string[] = []
    let bytes = 0
    let hasMore = false
    for (let index = sourceStart; index < sourceEnd; index += 1) {
      const line = buffer.getLine(index)?.translateToString(true) ?? ""
      const lineBytes = Buffer.byteLength(line, "utf8")
      if (lines.length > 0 && bytes + lineBytes > input.maxBytes) {
        hasMore = true
        break
      }
      lines.push(line)
      bytes += lineBytes
    }
    return {
      kind: input.kind,
      lines,
      cols: terminal.cols,
      rows: terminal.rows,
      textCursor: { x: buffer.cursorX, y: buffer.cursorY },
      generatedAt: new Date().toISOString(),
      throughOutputSeq,
      sizeRevision,
      emulatorId: TERMINAL_EMULATOR_ID,
      emulatorVersion: TERMINAL_EMULATOR_VERSION,
      degraded: false,
      reasons: [],
      hasMore,
    }
  }

  /**
   * Reads the tail of the buffer as styled lines.
   *
   * Unlike `getView`, this keeps per-cell styling so a remote client can render
   * colour without shipping raw ANSI over the wire. Trailing whitespace is
   * trimmed the same way `translateToString(true)` does, so blank padding never
   * reaches the client.
   */
  function readLineWindow(input: { readonly maxLines: number }): TerminalLineWindow {
    const buffer = terminal.buffer.active
    const totalLines = buffer.length
    const startIndex = Math.max(0, totalLines - Math.max(1, input.maxLines))
    const scratch = buffer.getNullCell()
    const lines: TerminalStyledLine[] = []
    // Whether the caller draws the cursor is its decision; whether the program
    // wants one at all is this one, and it comes from the tracked DECTCEM state
    // rather than being assumed.
    for (let index = startIndex; index < totalLines; index += 1) {
      lines.push(readStyledLine(buffer.getLine(index), scratch, buffer.getLine(index + 1)?.isWrapped === true))
    }
    return {
      lines,
      startIndex,
      totalLines,
      cols: terminal.cols,
      rows: terminal.rows,
      cursor: {
        row: Math.max(0, buffer.baseY + buffer.cursorY - startIndex),
        col: buffer.cursorX,
        visible: !cursorHidden,
      },
      alt: buffer.type === "alternate",
      throughOutputSeq,
      sizeRevision,
    }
  }

  /**
   * Reads an arbitrary slice of the buffer rather than the tail.
   *
   * History paging needs this: the phone asks for the lines just below what it
   * already has, which is nowhere near the end of a long buffer.
   */
  function readLineRange(input: {
    readonly from: number
    readonly maxLines: number
  }): { readonly lines: TerminalStyledLine[]; readonly startIndex: number } {
    const buffer = terminal.buffer.active
    const startIndex = Math.max(0, Math.min(input.from, buffer.length))
    const end = Math.min(buffer.length, startIndex + Math.max(0, input.maxLines))
    const scratch = buffer.getNullCell()
    const lines: TerminalStyledLine[] = []
    for (let index = startIndex; index < end; index += 1) {
      lines.push(readStyledLine(buffer.getLine(index), scratch, buffer.getLine(index + 1)?.isWrapped === true))
    }
    return { lines, startIndex }
  }

  function bracketedPasteEvidence(): {
    readonly enabled: boolean
    readonly fresh: boolean
    readonly throughOutputSeq: number
    readonly sizeRevision: number
  } {
    return {
      enabled: terminal.modes.bracketedPasteMode,
      fresh: modeEvidenceFresh,
      throughOutputSeq,
      sizeRevision,
    }
  }

  async function ready(): Promise<void> {
    await writeChain
  }

  async function captureSnapshot(maxBytes: number): Promise<TerminalEmulatorSnapshot> {
    await ready()
    const fullSnapshot = serializeTerminalState(terminal, serializer)
    if (Buffer.byteLength(fullSnapshot, "utf8") <= maxBytes) {
      return {
        serialized: fullSnapshot,
        throughOutputSeq,
        sizeRevision,
        scrollbackTruncated: false,
      }
    }

    let lowerBound = 0
    let upperBound = Math.max(0, terminal.buffer.active.baseY)
    let best: string | null = null
    while (lowerBound <= upperBound) {
      const scrollback = Math.floor((lowerBound + upperBound) / 2)
      const candidate = serializeTerminalState(terminal, serializer, scrollback)
      if (Buffer.byteLength(candidate, "utf8") <= maxBytes) {
        best = candidate
        lowerBound = scrollback + 1
      } else {
        upperBound = scrollback - 1
      }
    }

    return {
      serialized: best,
      throughOutputSeq,
      sizeRevision,
      scrollbackTruncated: true,
    }
  }

  return {
    accept,
    resize,
    getView,
    readLineWindow,
    readLineRange,
    bracketedPasteEvidence,
    ready,
    captureSnapshot,
    serialize: () => serializeTerminalState(terminal, serializer),
    dispose: () => terminal.dispose(),
    get throughOutputSeq(): number { return throughOutputSeq },
    get sizeRevision(): number { return sizeRevision },
    get currentCwd(): string | undefined { return currentCwd },
  }
}

function readStyledLine(
  line: TerminalBufferLine | undefined,
  scratch: TerminalBufferCell,
  wrappedToNext = false,
): TerminalStyledLine {
  if (!line) return { text: "" }
  const wrappedFromPrevious = line.isWrapped ? true as const : undefined
  const wrap = {
    ...(wrappedFromPrevious && { wrappedFromPrevious }),
    ...(wrappedToNext && { wrappedToNext: true as const }),
  }
  const end = trimmedCellCount(line, scratch)
  if (end === 0) return { text: "", ...wrap }

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
    // Only emit runs that actually differ from the default, so plain log lines
    // carry no styling payload at all.
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

  // Set while the previous cell was a double-width character, whose trailing
  // cell is empty and must not be drawn again.
  let wideTrailer = false
  for (let x = 0; x < end; x += 1) {
    const cell = line.getCell(x, scratch)
    if (!cell) break
    const chars = cell.getChars()
    if (chars.length === 0) {
      // Any other empty cell is a blank the output moved the cursor across —
      // a status line pads between its segments with a cursor jump. Dropping
      // those cells would run the segments together.
      if (!wideTrailer) text += " "
      wideTrailer = false
      continue
    }
    wideTrailer = cell.getWidth() === 2
    const foreground = readCellColor(cell, true)
    const background = readCellColor(cell, false)
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
  return runs.length > 0 ? { text, runs, ...wrap } : { text, ...wrap }
}

/**
 * Index just past the last cell that carries visible text.
 *
 * Scanned from the right because the caller walks `[0, end)` right afterwards:
 * searching left to right re-visits every cell of the row's trailing blanks, and
 * those blanks are most of a row once the text stops short of the edge. From the
 * right the scan is over at the row's last glyph, usually a cell or two away.
 *
 * Blank cells are stepped over rather than treated as the row's end — a status
 * line jumps the cursor across gaps and keeps drawing after them — so the search
 * keeps going until it meets a cell with characters that are not whitespace.
 *
 * xterm only fails `getCell` past `line.length`, so the loop bound keeps the miss
 * unreachable; skipping instead of stopping keeps a hypothetical hole from hiding
 * the glyphs in front of it.
 */
function trimmedCellCount(line: TerminalBufferLine, scratch: TerminalBufferCell): number {
  for (let x = line.length - 1; x >= 0; x -= 1) {
    const cell = line.getCell(x, scratch)
    if (!cell) continue
    const chars = cell.getChars()
    if (chars.length > 0 && chars.trim().length > 0) return x + 1
  }
  return 0
}

function readCellColor(cell: TerminalBufferCell, foreground: boolean): number {
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

function serializeTerminalState(
  terminal: Terminal,
  serializer: SerializeAddon,
  scrollback?: number,
): string {
  const serialized = scrollback === undefined
    ? serializer.serialize()
    : serializer.serialize({ scrollback })
  // SerializeAddon restores mouse tracking, but omits the active coordinate encoding.
  const mouseEncoding = (terminal as TerminalWithMouseEncoding)._core
    ?.coreMouseService?.activeEncoding
  return mouseEncoding === "SGR" ? `${serialized}\u001b[?1006h` : serialized
}
