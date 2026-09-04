import { describe, expect, it } from "vitest"
import { createTerminalOutputBuffer } from "../output-buffer"
import type { TerminalOutputChunk } from "../../shared/schema"

describe("terminal output buffer", () => {
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

    buffer.evictOldest()
    expect(buffer.firstOutputSeq).toBe(2)
  })
})
