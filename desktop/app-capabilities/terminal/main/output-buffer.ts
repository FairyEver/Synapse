import { TERMINAL_SESSION_OUTPUT_RETENTION_CHUNKS } from "../../../config"
import type { TerminalOutputChunk } from "../shared/schema"

type BufferEntry = TerminalOutputChunk & { byteLength: number }

export type TerminalOutputBufferReadResult = {
  chunks: TerminalOutputChunk[]
  nextSeq: number
  firstSeq: number
  truncated: boolean
  gap: boolean
  hasMore: boolean
  discardedBytes: number
  discardedChunks: number
}

export type TerminalOutputBuffer = {
  append(sessionId: string, data: string): TerminalOutputChunk
  read(input: { afterSeq?: number; limitBytes: number }): TerminalOutputBufferReadResult
  snapshot(): TerminalOutputChunk[]
  snapshotAfter(afterSeq: number): TerminalOutputChunk[]
  evictOldest(): { bytes: number; seq: number } | null
  readonly firstOutputSeq: number
  readonly oldestCreatedAt: string | undefined
  readonly totalBytes: number
  readonly nextOutputSeq: number
  readonly discardedBytes: number
  readonly discardedChunks: number
}

export function createTerminalOutputBuffer(options: {
  maxBytes: number
  maxChunks?: number
  initialChunks?: TerminalOutputChunk[]
  initialDiscardedBytes?: number
  initialDiscardedChunks?: number
}): TerminalOutputBuffer {
  const capacity = options.maxChunks ?? TERMINAL_SESSION_OUTPUT_RETENTION_CHUNKS
  if (!Number.isSafeInteger(capacity) || capacity < 1) throw new RangeError("Invalid terminal output chunk limit")
  const entries: Array<BufferEntry | undefined> = new Array(capacity)
  let head = 0
  let length = 0
  const initial = (options.initialChunks ?? [])
    .slice()
    .sort((left, right) => left.seq - right.seq)
  let totalBytes = 0
  let nextSeq = (initial.at(-1)?.seq ?? 0) + 1
  let discardedBytes = options.initialDiscardedBytes ?? 0
  let discardedChunks = options.initialDiscardedChunks ?? 0

  for (const chunk of initial) appendEntry(toBufferEntry(chunk))

  return {
    append(sessionId, data) {
      const entry: BufferEntry = {
        sessionId,
        seq: nextSeq,
        data,
        createdAt: new Date().toISOString(),
        source: "pty",
        byteLength: Buffer.byteLength(data, "utf8"),
      }
      nextSeq += 1
      appendEntry(entry)
      return stripByteLength(entry)
    },
    read(input) {
      const afterSeq = input.afterSeq ?? 0
      const firstSeq = at(0)?.seq ?? nextSeq
      const truncated = afterSeq < firstSeq - 1
      const chunks: TerminalOutputChunk[] = []
      let bytes = 0
      let hasMore = false

      let index = firstIndexAfter(afterSeq)
      for (; index < length; index += 1) {
        const entry = at(index)!

        if (chunks.length > 0 && bytes + entry.byteLength > input.limitBytes) {
          hasMore = true
          break
        }

        chunks.push(stripByteLength(entry))
        bytes += entry.byteLength

        if (bytes >= input.limitBytes) {
          hasMore = index + 1 < length
          break
        }
      }

      return {
        chunks,
        firstSeq,
        nextSeq: chunks.at(-1)?.seq ?? Math.max(afterSeq, firstSeq - 1),
        truncated,
        gap: truncated,
        hasMore,
        discardedBytes,
        discardedChunks,
      }
    },
    snapshot() {
      return snapshotAfter(0)
    },
    snapshotAfter,
    evictOldest,
    get firstOutputSeq() { return at(0)?.seq ?? nextSeq },
    get oldestCreatedAt() { return at(0)?.createdAt },
    get totalBytes() { return totalBytes },
    get nextOutputSeq() { return nextSeq },
    get discardedBytes() { return discardedBytes },
    get discardedChunks() { return discardedChunks },
  }

  function at(index: number): BufferEntry | undefined {
    return index < length ? entries[(head + index) % capacity] : undefined
  }

  function evictOldest(): { bytes: number; seq: number } | null {
    const removed = at(0)
    if (!removed) return null
    entries[head] = undefined
    head = (head + 1) % capacity
    length -= 1
    totalBytes -= removed.byteLength
    discardedBytes += removed.byteLength
    discardedChunks += 1
    return { bytes: removed.byteLength, seq: removed.seq }
  }

  function appendEntry(entry: BufferEntry): void {
    if (length === capacity) evictOldest()
    entries[(head + length) % capacity] = entry
    length += 1
    totalBytes += entry.byteLength
    // 保留最新单块的既有契约；全局额度仍可淘汰这一块。
    while (totalBytes > options.maxBytes && length > 1) evictOldest()
  }

  function firstIndexAfter(seq: number): number {
    let low = 0
    let high = length
    while (low < high) {
      const middle = Math.floor((low + high) / 2)
      if (at(middle)!.seq <= seq) low = middle + 1
      else high = middle
    }
    return low
  }

  function snapshotAfter(afterSeq: number): TerminalOutputChunk[] {
    const chunks: TerminalOutputChunk[] = []
    for (let index = firstIndexAfter(afterSeq); index < length; index += 1) chunks.push(stripByteLength(at(index)!))
    return chunks
  }
}

function stripByteLength(entry: BufferEntry): TerminalOutputChunk {
  return {
    sessionId: entry.sessionId,
    seq: entry.seq,
    data: entry.data,
    createdAt: entry.createdAt,
    source: entry.source,
  }
}

function toBufferEntry(chunk: TerminalOutputChunk): BufferEntry {
  return {
    ...chunk,
    byteLength: Buffer.byteLength(chunk.data, "utf8"),
  }
}
