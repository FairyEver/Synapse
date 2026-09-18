import type { TerminalStyledLine } from "../../../app-capabilities/terminal/main/emulator"

/**
 * Turns successive reads of a terminal's visible tail into incremental updates
 * over a gateway-owned, monotonic line index.
 *
 * The index has to be owned here rather than taken from xterm. xterm keeps its
 * buffer in a ring: once scrollback is full, every appended line shifts the
 * buffer index of everything already stored. A long-running session therefore
 * "slides" on every single flush, and a naive diff would conclude that nothing
 * matches and resend the entire window each time — thousands of lines per second
 * over a metered link.
 *
 * Instead the tracker aligns the two windows against each other:
 *
 *  - If the previous window survives as a prefix of the new one, only the tail is new.
 *  - If the head diverged but the previous window's tail lines up with the new
 *    window's head, exactly that many lines scrolled off, and the client only
 *    needs whatever follows.
 *  - Otherwise the windows genuinely diverged (a mutation such as a progress bar,
 *    a cleared screen, or an alternate-screen switch) and the update restarts at
 *    the first line that differs.
 */

/**
 * How many eviction candidates to probe before admitting the windows diverged.
 *
 * Has to reach the end of the window the gateway reads (`lineWindowLines`, 500),
 * or a slide larger than half a window is unprovable however plainly the evidence
 * sits in the two reads. A failed probe is not a harmless misread: it reports a
 * divergence, and a divergence resends the whole window — on every flush, for as
 * long as the terminal keeps producing that fast. Eight flushes a second of a
 * 500-line window is already twice the phone's uplink budget, so the updates get
 * dropped exactly when the session has the most to say.
 */
const MAX_EVICTION_PROBE = 512

/**
 * Minimum matching lines before an eviction offset is trusted. Duplicate lines
 * (blank padding, repeated log rows) can produce coincidental alignments; a short
 * overlap is not enough evidence to skip content the client may still be missing.
 */
const MIN_EVICTION_OVERLAP = 8

export type MobileLineUpdate = {
  /** Gateway index of `lines[0]`. Everything before it is unchanged. */
  readonly from: number
  readonly lines: readonly TerminalStyledLine[]
  /** Total lines in the gateway's index space after this update. */
  readonly total: number
  readonly newWindowStart: number
  /** True when lines before `from` scrolled out of the emulator and stop updating. */
  readonly truncated: boolean
}

export type MobileLineSnapshot = {
  readonly from: number
  readonly lines: readonly TerminalStyledLine[]
  readonly total: number
  readonly truncated: boolean
}

export class LineWindowTracker {
  private window: readonly TerminalStyledLine[] = []
  /** Gateway index of `window[0]`. Advances only when lines scroll out of the emulator. */
  private windowStart = 0
  private anchored = false

  /**
   * Pins gateway index 0 to the emulator's current first line.
   *
   * Without this the gateway index space starts at the first window it happened
   * to read, which makes it impossible to name lines *older* than that — exactly
   * what history paging needs. Anchoring makes the two index spaces coincide at
   * the start, and eviction moves both together from then on.
   *
   * Must be called before the first `push`.
   */
  anchorAt(index: number): void {
    if (this.anchored || this.window.length > 0) return
    this.windowStart = Math.max(0, index)
    this.anchored = true
  }

  /** Gateway index of the oldest line currently tracked. */
  get oldestIndex(): number {
    return this.windowStart
  }

  /**
   * Applies a fresh read of the terminal tail. Returns `null` when nothing
   * changed, which is the common case for an idle session and the reason an
   * idle terminal costs no bandwidth at all.
   *
   * Invariant after every call: the client is known to hold every line in
   * `[windowStart, windowStart + window.length)`.
   */
  push(next: readonly TerminalStyledLine[]): MobileLineUpdate | null {
    const prev = this.window
    const common = commonPrefixLength(prev, next)
    if (common === prev.length && prev.length === next.length) return null

    // A diverging head means content scrolled off; the previous window's tail is
    // still a reliable guide to where the client's knowledge resumes.
    const evicted = common === 0 && prev.length > 0 ? findEvictionOffset(prev, next) : 0
    if (evicted > 0) {
      const newWindowStart = this.windowStart + evicted
      this.window = next
      this.windowStart = newWindowStart
      // The client's last known line is the end of the previous window; everything
      // from there on is new, and `prev.length - evicted` lines bridge the two.
      return {
        from: newWindowStart + (prev.length - evicted),
        lines: next.slice(prev.length - evicted),
        total: newWindowStart + next.length,
        newWindowStart,
        truncated: true,
      }
    }

    const from = this.windowStart + common
    this.window = next
    return {
      from,
      lines: next.slice(common),
      total: this.windowStart + next.length,
      newWindowStart: this.windowStart,
      truncated: common === 0,
    }
  }

  /** Full state, for a client that just attached or reconnected. */
  snapshot(): MobileLineSnapshot {
    return {
      from: this.windowStart,
      lines: this.window,
      total: this.windowStart + this.window.length,
      truncated: false,
    }
  }

  reset(): void {
    this.window = []
    this.windowStart = 0
  }
}

/**
 * Finds how many lines scrolled out of the emulator between the two reads.
 *
 * Returns 0 when no trustworthy alignment exists. The probe is cheap because the
 * first-line comparison rejects nearly every candidate in O(1); the full overlap
 * check only runs for offsets that could plausibly be the answer.
 */
export function findEvictionOffset(
  prev: readonly TerminalStyledLine[],
  next: readonly TerminalStyledLine[],
): number {
  if (prev.length === 0 || next.length === 0) return 0
  const limit = Math.min(prev.length, MAX_EVICTION_PROBE)
  for (let offset = 1; offset <= limit; offset += 1) {
    const overlap = prev.length - offset
    if (overlap < MIN_EVICTION_OVERLAP) continue
    if (overlap > next.length) continue
    if (!lineEquals(prev[offset], next[0])) continue
    if (prefixMatches(prev, offset, next, overlap)) return offset
  }
  return 0
}

function prefixMatches(
  prev: readonly TerminalStyledLine[],
  offset: number,
  next: readonly TerminalStyledLine[],
  length: number,
): boolean {
  for (let index = 1; index < length; index += 1) {
    if (!lineEquals(prev[offset + index], next[index])) return false
  }
  return true
}

function commonPrefixLength(
  prev: readonly TerminalStyledLine[],
  next: readonly TerminalStyledLine[],
): number {
  const limit = Math.min(prev.length, next.length)
  let index = 0
  while (index < limit && lineEquals(prev[index], next[index])) index += 1
  return index
}

/**
 * Compares a single line. `runs` is absent for unstyled lines, which is the
 * common case and lets the comparison short-circuit on the text alone.
 */
function lineEquals(a: TerminalStyledLine | undefined, b: TerminalStyledLine | undefined): boolean {
  if (a === b) return true
  if (!a || !b) return false
  if (a.text !== b.text) return false
  const runsA = a.runs
  const runsB = b.runs
  if (!runsA && !runsB) return true
  if (!runsA || !runsB) return false
  if (runsA.length !== runsB.length) return false
  for (let index = 0; index < runsA.length; index += 1) {
    const runA = runsA[index]
    const runB = runsB[index]
    if (runA.start !== runB.start
      || runA.length !== runB.length
      || runA.foreground !== runB.foreground
      || runA.background !== runB.background
      || runA.bold !== runB.bold
      || runA.italic !== runB.italic
      || runA.underline !== runB.underline
      || runA.dim !== runB.dim
      || runA.inverse !== runB.inverse) {
      return false
    }
  }
  return true
}
