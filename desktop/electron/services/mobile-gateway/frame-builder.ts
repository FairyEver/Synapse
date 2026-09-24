// Runtime constants come from the CommonJS subpath; the main package entry is
// ESM-only and cannot be required from the Electron main process.
import {
  MOBILE_DEFAULT_COLOR,
  MOBILE_FRAME_LIMITS,
  MOBILE_PROTOCOL_VERSION,
  MOBILE_RUN_FLAGS,
  MOBILE_TRUECOLOR_BASE,
} from "@synapse/shared/mobile-live-constants"
import type {
  MobileLineWire,
  MobileRunWire,
  MobileTerminalCursor,
  MobileTerminalFrame,
} from "@synapse/shared" with { "resolution-mode": "import" }

import {
  TERMINAL_STYLE_DEFAULT_COLOR,
  TERMINAL_STYLE_TRUECOLOR_BASE,
  type TerminalStyledLine,
  type TerminalStyledRun,
} from "../../../app-capabilities/terminal/main/emulator"

/**
 * Bytes reserved for the envelope and frame metadata, subtracted from the frame
 * budget before lines are measured.
 *
 * The desktop's live socket caps payloads at 16 KiB *at the ws layer*, where an
 * oversized message tears down the connection instead of returning an error. The
 * 8 KiB frame budget leaves a full factor of two of headroom, and this constant
 * keeps the JSON envelope from eating into it.
 */
const FRAME_ENVELOPE_OVERHEAD_BYTES = 512

/** JSON punctuation around one `[text, runs]` entry plus a separator. */
const LINE_WIRE_OVERHEAD_BYTES = 6

/** Rough cost of one `[start,length,fg,bg,flags]` tuple. */
const RUN_WIRE_OVERHEAD_BYTES = 20

/**
 * Ceiling for a single line on the wire. A terminal line is at most `cols`
 * characters, and `cols` is capped at 500, so this only ever truncates content
 * that is already pathological.
 */
const MAX_LINE_WIRE_BYTES = 2_048

const LINE_BUDGET_BYTES = MOBILE_FRAME_LIMITS.maxPayloadBytes - FRAME_ENVELOPE_OVERHEAD_BYTES

export type TerminalFrameInput = {
  readonly sessionId: string
  /** `history` replaces exactly `[from, from + lines.length)` and leaves the rest alone. */
  readonly kind: "suffix" | "reset" | "history"
  /** Gateway index of `lines[0]`. */
  readonly from: number
  readonly lines: readonly TerminalStyledLine[]
  readonly total: number
  readonly cursor: MobileTerminalCursor
  readonly alt: boolean
  readonly truncated: boolean
  readonly seq: number
  readonly sizeRevision: number
}

/**
 * Splits one logical update into as many frames as the size budget requires.
 *
 * Frames carry increasing `from`s, so a client that applies them in order
 * converges on exactly the same state as one that receives a single frame.
 *
 * `reset` and `truncated` are the exception, and both only in the first frame. A
 * reset means "discard everything you hold"; a client that honours that literally
 * discards the preceding chunk too, and comes out holding the last chunk alone — a
 * window arriving as four frames left the client with a quarter of it. Only the
 * first frame discards; the rest are ordinary suffix frames, which say "from here
 * on the content is this", precisely what the remaining chunks are.
 *
 * `truncated` is a statement about the frame's own `from`: everything before it is
 * gone and must be discarded. Only the first chunk's `from` is that boundary. On
 * the followers the same flag lands on a `from` deep inside the window the leading
 * chunks just delivered, and a client that acts on it drops the lines it was sent
 * a moment ago and keeps the tail.
 *
 * `total` is the third thing a split must not spoil. A suffix frame voids
 * everything at or past the line it establishes, and on a chunk that line is the
 * chunk's own end — which is not the update's end. So **every chunk carries the
 * same `total`**, the update's own end, and the client truncates there. Recomputing
 * it per chunk leaves the first one voiding everything the rest are about to
 * deliver: the client drops lines it already had, and the screen collapses to the
 * first chunk's size until the followers land.
 */
export function buildTerminalFrames(input: TerminalFrameInput): MobileTerminalFrame[] {
  const frames: MobileTerminalFrame[] = []
  let index = 0

  // An update with no lines still carries state, so it always yields one frame.
  do {
    const wireLines: MobileLineWire[] = []
    let bytes = 0
    while (index < input.lines.length) {
      if (wireLines.length >= MOBILE_FRAME_LIMITS.maxLinesPerFrame) break
      const wire = toLineWire(input.lines[index])
      const cost = lineCostBytes(wire)
      if (wireLines.length > 0 && bytes + cost > LINE_BUDGET_BYTES) break
      wireLines.push(wire)
      bytes += cost
      index += 1
    }
    const consumed = wireLines.length
    // The discard belongs to the first frame only; later chunks amend what it left.
    const kind = frames.length === 0 || input.kind !== "reset" ? input.kind : "suffix"
    // Same for the truncation claim: it is about the boundary this frame defines.
    const truncated = frames.length === 0 ? input.truncated : false
    frames.push({
      v: MOBILE_PROTOCOL_VERSION,
      sessionId: input.sessionId,
      kind,
      from: input.from + index - consumed,
      lines: wireLines,
      total: input.total,
      cursor: input.cursor,
      alt: input.alt,
      truncated,
      seq: input.seq,
      sizeRevision: input.sizeRevision,
    })
    if (consumed === 0) break
  } while (index < input.lines.length)

  return frames
}

export type SnapshotFrameInput = Omit<TerminalFrameInput, "kind" | "truncated">

/**
 * Splits a whole window into the frames that deliver it without ever leaving the
 * phone showing a buffer that is only half built.
 *
 * The natural order to write a snapshot in is oldest chunk first, and that is the
 * wrong one to watch it arrive in. The leading chunk is the one that carries
 * `reset`, so the client throws away everything it holds and lands on the *oldest*
 * lines in the window — a full window's worth of scrollback above where the reader
 * was — and then walks back down as the remaining chunks land on top. On a phone
 * that is the screen jumping away and coming back, once per chunk, every time a
 * computer reattaches.
 *
 * So the newest chunk goes first, and it is the one that carries the `reset`: the
 * client discards its buffer and lands on exactly the lines it was already looking
 * at. The older chunks follow as `history` frames, which the client already knows
 * how to insert above its viewport without moving it — the same path a page of
 * scrollback takes when the reader pulls one in by hand. Nothing new has to be
 * true on the phone for this to be right.
 *
 * It also gives back something the chunked reset had quietly taken away. A reset
 * means "discard everything you hold", so a client that missed a chunk in the
 * middle of one kept a hole that nothing would ever fill — the discard had already
 * happened by the time the gap appeared. Ordered newest first, every intermediate
 * state is whole, and the frames keep the self-healing property the rest of this
 * protocol is built on.
 */
export function buildSnapshotFrames(input: SnapshotFrameInput): MobileTerminalFrame[] {
  const chunks = buildTerminalFrames({ ...input, kind: "reset", truncated: false })
  const newest = chunks[chunks.length - 1]
  const older = chunks.slice(0, -1).reverse()
  return [
    { ...newest, kind: "reset" },
    ...older.map((frame): MobileTerminalFrame => ({ ...frame, kind: "history" })),
  ]
}

/**
 * Compacts one line into the wire tuple form. `runs` is omitted entirely when the
 * line is unstyled, which is the majority of terminal output and roughly halves
 * the payload for ordinary log traffic.
 */
export function toLineWire(input: TerminalStyledLine): MobileLineWire {
  const text = truncateToBytes(input.text, MAX_LINE_WIRE_BYTES)
  const runs = toRunWire(input.runs, text.length)
  const wrapFlags = (input.wrappedFromPrevious ? 1 : 0) | (input.wrappedToNext ? 2 : 0)
  if (wrapFlags !== 0) return [text, runs ?? [], wrapFlags]
  return runs ? [text, runs] : [text]
}

function toRunWire(
  runs: readonly TerminalStyledRun[] | undefined,
  textLength: number,
): MobileRunWire[] | undefined {
  if (!runs || runs.length === 0 || textLength === 0) return undefined
  const wire: MobileRunWire[] = []
  for (const run of runs) {
    const start = Math.max(0, Math.min(run.start, textLength))
    const length = Math.min(run.length, textLength - start)
    if (length <= 0) continue
    wire.push([
      start,
      length,
      toWireColor(run.foreground),
      toWireColor(run.background),
      toWireFlags(run),
    ])
    if (wire.length >= MOBILE_FRAME_LIMITS.maxRunsPerLine) break
  }
  return wire.length > 0 ? wire : undefined
}

export function toWireFlags(run: TerminalStyledRun): number {
  return (run.bold ? MOBILE_RUN_FLAGS.bold : 0)
    | (run.italic ? MOBILE_RUN_FLAGS.italic : 0)
    | (run.underline ? MOBILE_RUN_FLAGS.underline : 0)
    | (run.dim ? MOBILE_RUN_FLAGS.dim : 0)
    | (run.inverse ? MOBILE_RUN_FLAGS.inverse : 0)
}

/**
 * Maps the emulator's colour encoding onto the wire's. The two use the same shape
 * but are declared separately so the terminal capability stays free of protocol
 * concerns; translating explicitly keeps that seam visible and testable.
 */
export function toWireColor(value: number): number {
  if (value === TERMINAL_STYLE_DEFAULT_COLOR) return MOBILE_DEFAULT_COLOR
  if (value >= TERMINAL_STYLE_TRUECOLOR_BASE) {
    return MOBILE_TRUECOLOR_BASE | (value - TERMINAL_STYLE_TRUECOLOR_BASE)
  }
  return value & 0xff
}

function lineCostBytes(wire: MobileLineWire): number {
  let cost = Buffer.byteLength(wire[0], "utf8") + LINE_WIRE_OVERHEAD_BYTES
  if (wire.length === 3) cost += 5
  const runs = wire[1]
  if (runs) cost += runs.length * RUN_WIRE_OVERHEAD_BYTES
  return cost
}

/**
 * Cuts a string to a UTF-8 byte budget without splitting a surrogate pair, which
 * would produce an unpaired surrogate that JSON cannot round-trip.
 */
export function truncateToBytes(value: string, maxBytes: number): string {
  if (Buffer.byteLength(value, "utf8") <= maxBytes) return value
  let bytes = 0
  let index = 0
  while (index < value.length) {
    const code = value.codePointAt(index)
    if (code === undefined) break
    const width = code > 0xffff ? 2 : 1
    const size = utf8Size(code)
    if (bytes + size > maxBytes) break
    bytes += size
    index += width
  }
  return value.slice(0, index)
}

function utf8Size(codePoint: number): number {
  if (codePoint < 0x80) return 1
  if (codePoint < 0x800) return 2
  if (codePoint < 0x10000) return 3
  return 4
}
