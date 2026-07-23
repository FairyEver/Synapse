import { SerializeAddon } from "@xterm/addon-serialize"
import { Terminal } from "@xterm/headless"

export const TERMINAL_EMULATOR_ID = "xterm-headless" as const
export const TERMINAL_EMULATOR_VERSION = "6.0.0" as const

export type TerminalRenderedView = {
  readonly kind: "screen" | "scrollback"
  readonly lines: string[]
  readonly cols: number
  readonly rows: number
  readonly cursor: { readonly x: number; readonly y: number }
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

export function createTerminalCoreEmulator(input: {
  readonly cols: number
  readonly rows: number
  readonly scrollback?: number
  readonly throughOutputSeq?: number
  readonly sizeRevision: number
}) {
  const terminal = new Terminal({
    cols: input.cols,
    rows: input.rows,
    scrollback: input.scrollback ?? 2_000,
    allowProposedApi: true,
  })
  const serializer = new SerializeAddon()
  terminal.loadAddon(serializer)
  let throughOutputSeq = input.throughOutputSeq ?? 0
  let sizeRevision = input.sizeRevision
  let modeEvidenceFresh = false
  let writeChain = Promise.resolve()

  function accept(data: string, outputSeq: number): Promise<void> {
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
      cursor: { x: buffer.cursorX, y: buffer.cursorY },
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
    const fullSnapshot = serializer.serialize()
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
      const candidate = serializer.serialize({ scrollback })
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
    bracketedPasteEvidence,
    ready,
    captureSnapshot,
    serialize: () => serializer.serialize(),
    dispose: () => terminal.dispose(),
    get throughOutputSeq(): number { return throughOutputSeq },
    get sizeRevision(): number { return sizeRevision },
  }
}
