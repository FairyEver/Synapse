import { describe, expect, it } from "vitest"
import { createTerminalOutputBuffer } from "../output-buffer"
import type { TerminalOutputChunk } from "../../shared/schema"

describe("terminal output buffer", () => {
  it("bounds tiny and empty chunks while keeping sequence and loss accounting", () => {
    const buffer = createTerminalOutputBuffer({ maxBytes: 100, maxChunks: 3 })
    for (const text of ["a", "", "b", "", "c"]) buffer.append("s1", text)

    expect(buffer.snapshot().map((chunk) => chunk.seq)).toEqual([3, 4, 5])
    expect(buffer.read({ afterSeq: 0, limitBytes: 100 })).toMatchObject({
      firstSeq: 3, nextSeq: 5, gap: true, discardedBytes: 1, discardedChunks: 2,
    })
    expect(buffer.oldestCreatedAt).toBe(buffer.snapshot()[0]?.createdAt)
  })

  it("keeps the newest chunks through repeated ring wraparounds and incremental reads", () => {
    const buffer = createTerminalOutputBuffer({ maxBytes: 100, maxChunks: 3 })
    for (let index = 1; index <= 100; index += 1) buffer.append("s1", String(index))
    expect(buffer.snapshot().map((chunk) => chunk.seq)).toEqual([98, 99, 100])
    expect(buffer.snapshotAfter(99).map((chunk) => chunk.seq)).toEqual([100])
    expect(buffer.read({ afterSeq: 97, limitBytes: 2 })).toMatchObject({ nextSeq: 98, hasMore: true })
    expect(buffer.evictOldest()?.seq).toBe(98)
    buffer.append("s1", "101")
    expect(buffer.snapshot().map((chunk) => chunk.seq)).toEqual([99, 100, 101])
  })

  it("reports a gap after all output is evicted and resumes at the same sequence", () => {
    const buffer = createTerminalOutputBuffer({ maxBytes: 100, maxChunks: 2 })
    buffer.append("s1", "one")
    buffer.evictOldest()
    expect(buffer.read({ afterSeq: 0, limitBytes: 100 })).toMatchObject({
      firstSeq: 2, nextSeq: 1, gap: true, truncated: true, hasMore: false, chunks: [],
    })
    expect(buffer.oldestCreatedAt).toBeUndefined()
    expect(buffer.append("s1", "two").seq).toBe(2)
  })

  it("applies the chunk limit to restored history without resetting the sequence", () => {
    const initialChunks: TerminalOutputChunk[] = Array.from({ length: 5 }, (_, index) => ({
      sessionId: "s1", seq: index + 1, data: "x", createdAt: `t${index}`, source: "pty",
    }))
    const buffer = createTerminalOutputBuffer({ maxBytes: 100, maxChunks: 2, initialChunks })
    expect(buffer.snapshot().map((chunk) => chunk.seq)).toEqual([4, 5])
    expect(buffer.discardedChunks).toBe(3)
    expect(buffer.append("s1", "next").seq).toBe(6)
  })

  it("keeps chunks in sequence order", () => {
    const buffer = createTerminalOutputBuffer({ maxBytes: 100 })

    buffer.append("s1", "one")
    buffer.append("s1", "two")

    expect(buffer.read({ afterSeq: 0, limitBytes: 100 })).toMatchObject({
      truncated: false,
      firstSeq: 1,
      nextSeq: 2,
      chunks: [
        { sessionId: "s1", seq: 1, data: "one", source: "pty" },
        { sessionId: "s1", seq: 2, data: "two", source: "pty" },
      ],
    })
  })

  it("prunes old chunks by byte limit", () => {
    const buffer = createTerminalOutputBuffer({ maxBytes: 6 })

    buffer.append("s1", "1234")
    buffer.append("s1", "5678")

    const result = buffer.read({ afterSeq: 0, limitBytes: 100 })
    expect(result.truncated).toBe(true)
    expect(result.firstSeq).toBe(2)
    expect(result.nextSeq).toBe(2)
    expect(result.chunks.map((chunk) => chunk.data)).toEqual(["5678"])
  })

  it("prunes multibyte output by utf8 byte length", () => {
    const buffer = createTerminalOutputBuffer({ maxBytes: 4 })

    buffer.append("s1", "你")
    buffer.append("s1", "a")
    buffer.append("s1", "b")

    const result = buffer.read({ afterSeq: 0, limitBytes: 100 })
    expect(result.truncated).toBe(true)
    expect(result.firstSeq).toBe(2)
    expect(result.chunks.map((chunk) => chunk.data)).toEqual(["a", "b"])
  })

  it("retains the newest chunk when it exceeds the byte limit", () => {
    const buffer = createTerminalOutputBuffer({ maxBytes: 3 })

    const appended = buffer.append("s1", "12345")

    expect(buffer.snapshot()).toEqual([appended])
    expect(buffer.read({ afterSeq: 0, limitBytes: 100 })).toMatchObject({
      chunks: [appended],
      firstSeq: 1,
      nextSeq: 1,
      truncated: false,
    })
  })

  it("limits reads by requested byte count", () => {
    const buffer = createTerminalOutputBuffer({ maxBytes: 100 })

    buffer.append("s1", "abc")
    buffer.append("s1", "def")

    const result = buffer.read({ afterSeq: 0, limitBytes: 3 })
    expect(result.chunks.map((chunk) => chunk.data)).toEqual(["abc"])
    expect(result.nextSeq).toBe(1)
  })

  it("restores initial chunks and continues after the last restored sequence", () => {
    const initialChunks: TerminalOutputChunk[] = [
      { sessionId: "s1", seq: 2, data: "restored-2", createdAt: "t2", source: "pty" },
      { sessionId: "s1", seq: 1, data: "restored-1", createdAt: "t1", source: "pty" },
    ]
    const buffer = createTerminalOutputBuffer({ maxBytes: 100, initialChunks })

    const appended = buffer.append("s1", "new")

    expect(appended.seq).toBe(3)
    expect(buffer.snapshot()).toEqual([
      { sessionId: "s1", seq: 1, data: "restored-1", createdAt: "t1", source: "pty" },
      { sessionId: "s1", seq: 2, data: "restored-2", createdAt: "t2", source: "pty" },
      appended,
    ])
  })

  it("snapshots only output added after a persisted sequence", () => {
    const buffer = createTerminalOutputBuffer({ maxBytes: 100 })
    buffer.append("s1", "one")
    const second = buffer.append("s1", "two")

    expect(buffer.firstOutputSeq).toBe(1)
    expect(buffer.snapshotAfter(1)).toEqual([second])
    expect(buffer.byteLengthAfter(1)).toBe(Buffer.byteLength("two", "utf8"))
    expect(buffer.retainedChunkCount).toBe(2)

    buffer.evictOldest()
    expect(buffer.firstOutputSeq).toBe(2)
  })
})
