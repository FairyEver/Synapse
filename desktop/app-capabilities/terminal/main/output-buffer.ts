import type { TerminalOutputChunk } from "../shared/schema"

type BufferEntry = TerminalOutputChunk & { byteLength: number }

export type TerminalOutputBufferReadResult = {
  chunks: TerminalOutputChunk[]
  nextSeq: number
  firstSeq: number
  truncated: boolean
}

export type TerminalOutputBuffer = {
  append(sessionId: string, data: string): TerminalOutputChunk
  read(input: { afterSeq?: number; limitBytes: number }): TerminalOutputBufferReadResult
  snapshot(): TerminalOutputChunk[]
}

export function createTerminalOutputBuffer(options: {
  maxBytes: number
  initialChunks?: TerminalOutputChunk[]
}): TerminalOutputBuffer {
  const entries = (options.initialChunks ?? [])
    .slice()
    .sort((left, right) => left.seq - right.seq)
    .map(toBufferEntry)
  let totalBytes = entries.reduce((sum, entry) => sum + entry.byteLength, 0)
  let nextSeq = (entries.at(-1)?.seq ?? 0) + 1

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
      const firstSeq = entries[0]?.seq ?? 0
      const truncated = entries.length > 0 && afterSeq < firstSeq - 1
      const chunks: TerminalOutputChunk[] = []
      let bytes = 0

      for (const entry of entries) {
        if (entry.seq <= afterSeq) continue

        if (chunks.length > 0 && bytes + entry.byteLength > input.limitBytes) break

        chunks.push(stripByteLength(entry))
        bytes += entry.byteLength

        if (bytes >= input.limitBytes) break
      }

      return {
        chunks,
        firstSeq,
        nextSeq: chunks.at(-1)?.seq ?? afterSeq,
        truncated,
      }
    },
    snapshot() {
      return entries.map(stripByteLength)
    },
  }

  function prune(): void {
    while (totalBytes > options.maxBytes && entries.length > 0) {
      const removed = entries.shift()
      if (removed) totalBytes -= removed.byteLength
    }
  }
}

function stripByteLength(entry: BufferEntry): TerminalOutputChunk {
  const { byteLength: _byteLength, ...chunk } = entry
  return chunk
}

function toBufferEntry(chunk: TerminalOutputChunk): BufferEntry {
  return {
    ...chunk,
    byteLength: Buffer.byteLength(chunk.data, "utf8"),
  }
}
