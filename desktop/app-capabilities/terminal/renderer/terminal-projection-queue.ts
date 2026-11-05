import { TERMINAL_PROJECTION_QUEUE_MAX_BYTES, TERMINAL_PROJECTION_QUEUE_MAX_CHUNKS } from "../../../config"
import type { TerminalOutputChunk } from "../shared/schema"
import { terminalUtf8ByteLength } from "../shared/utf8-byte-length"

/** 仅保存派生投影的待绘制增量，拒绝超预算的块，由调用方从权威快照重新附着。 */
export function createTerminalProjectionQueue(limits = {
  maxBytes: TERMINAL_PROJECTION_QUEUE_MAX_BYTES,
  maxChunks: TERMINAL_PROJECTION_QUEUE_MAX_CHUNKS,
}) {
  const entries: Array<{ chunk: TerminalOutputChunk; bytes: number } | undefined> = new Array(limits.maxChunks)
  let head = 0
  let length = 0
  let bytes = 0
  let peakBytes = 0
  let peakChunks = 0
  let rejectedChunks = 0
  return {
    append(chunk: TerminalOutputChunk): boolean {
      const chunkBytes = terminalUtf8ByteLength(chunk.data)
      if (length === limits.maxChunks || bytes + chunkBytes > limits.maxBytes) {
        rejectedChunks += 1
        return false
      }
      entries[(head + length) % limits.maxChunks] = { chunk, bytes: chunkBytes }
      length += 1
      bytes += chunkBytes
      peakBytes = Math.max(peakBytes, bytes)
      peakChunks = Math.max(peakChunks, length)
      return true
    },
    peek: () => entries[head]?.chunk,
    shift() {
      const entry = entries[head]
      if (!entry) return undefined
      entries[head] = undefined
      head = (head + 1) % limits.maxChunks
      length -= 1
      bytes -= entry.bytes
      return entry.chunk
    },
    clear() {
      entries.fill(undefined)
      head = 0
      length = 0
      bytes = 0
    },
    get length() { return length },
    diagnostics: () => ({ pendingBytes: bytes, pendingChunks: length, peakBytes, peakChunks, rejectedChunks }),
  }
}
