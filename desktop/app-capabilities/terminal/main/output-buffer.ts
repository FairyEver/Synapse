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
  evictOldest(): { bytes: number; seq: number } | null
  readonly totalBytes: number
  readonly nextOutputSeq: number
  readonly discardedBytes: number
  readonly discardedChunks: number
}

export function createTerminalOutputBuffer(options: {
  maxBytes: number
  initialChunks?: TerminalOutputChunk[]
  initialDiscardedBytes?: number
  initialDiscardedChunks?: number
}): TerminalOutputBuffer {
  const entries = (options.initialChunks ?? [])
    .slice()
    .sort((left, right) => left.seq - right.seq)
    .map(toBufferEntry)
  let totalBytes = entries.reduce((sum, entry) => sum + entry.byteLength, 0)
  let nextSeq = (entries.at(-1)?.seq ?? 0) + 1
  let discardedBytes = options.initialDiscardedBytes ?? 0
  let discardedChunks = options.initialDiscardedChunks ?? 0

  prune()

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
      entries.push(entry)
      totalBytes += entry.byteLength
      prune()
      return stripByteLength(entry)
    },
    read(input) {
      const afterSeq = input.afterSeq ?? 0
      const firstSeq = entries[0]?.seq ?? nextSeq
      const truncated = entries.length > 0 && afterSeq < firstSeq - 1
      const chunks: TerminalOutputChunk[] = []
      let bytes = 0
      let hasMore = false

      for (const entry of entries) {
        if (entry.seq <= afterSeq) continue

        if (chunks.length > 0 && bytes + entry.byteLength > input.limitBytes) {
          hasMore = true
          break
        }

        chunks.push(stripByteLength(entry))
        bytes += entry.byteLength

        if (bytes >= input.limitBytes) break
      }

      return {
        chunks,
        firstSeq,
        nextSeq: chunks.at(-1)?.seq ?? afterSeq,
        truncated,
        gap: truncated,
        hasMore,
        discardedBytes,
        discardedChunks,
      }
    },
    snapshot() {
      return entries.map(stripByteLength)
    },
    evictOldest() {
      const removed = entries.shift()
      if (!removed) return null
      totalBytes -= removed.byteLength
      discardedBytes += removed.byteLength
      discardedChunks += 1
      return { bytes: removed.byteLength, seq: removed.seq }
    },
    get totalBytes() { return totalBytes },
    get nextOutputSeq() { return nextSeq },
    get discardedBytes() { return discardedBytes },
    get discardedChunks() { return discardedChunks },
  }

  function prune(): void {
    while (totalBytes > options.maxBytes && entries.length > 1) {
      const removed = entries.shift()
      if (removed) {
        totalBytes -= removed.byteLength
        discardedBytes += removed.byteLength
        discardedChunks += 1
      }
    }
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
