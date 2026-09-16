import { describe, expect, it } from "vitest"

import {
  ASR_PCM_CHUNK_BYTES,
  ASR_PCM_CHUNK_SAMPLES,
  AsrPcmChunker,
  floatToInt16Le,
  resampleLinear,
} from "../asr-pcm"

function readInt16(bytes: Uint8Array, index: number): number {
  return new DataView(bytes.buffer, bytes.byteOffset).getInt16(index * 2, true)
}

describe("floatToInt16Le", () => {
  it("满量程不漏位", () => {
    const bytes = floatToInt16Le(Float32Array.from([0, 1, -1]))
    expect(readInt16(bytes, 0)).toBe(0)
    expect(readInt16(bytes, 1)).toBe(32767)
    expect(readInt16(bytes, 2)).toBe(-32768)
  })

  it("超量程截断而不是回绕", () => {
    const bytes = floatToInt16Le(Float32Array.from([2, -2]))
    expect(readInt16(bytes, 0)).toBe(32767)
    expect(readInt16(bytes, 1)).toBe(-32768)
  })

  it("按小端写字节", () => {
    const bytes = floatToInt16Le(Float32Array.from([1]))
    expect(bytes[0]).toBe(0xff)
    expect(bytes[1]).toBe(0x7f)
  })
})

describe("resampleLinear", () => {
  it("输入已经是目标采样率时原样通过", () => {
    const input = Float32Array.from([0.1, 0.2, 0.3])
    const out = resampleLinear(input, 16_000, 16_000, { previous: 0, position: 0 })
    expect([...out]).toEqual([...input])
  })

  it("48k 降到 16k 后长度约为三分之一", () => {
    const input = new Float32Array(4800).fill(0.5)
    const out = resampleLinear(input, 48_000, 16_000, { previous: 0, position: 0 })
    expect(out.length).toBeGreaterThanOrEqual(1599)
    expect(out.length).toBeLessThanOrEqual(1601)
  })

  it("跨批插值用上一批的最后一个采样，批边界不出现断点", () => {
    const carry = { previous: 0, position: 0 }
    // 第二批的第一个输出应当落在第一批末尾与第二批首个采样之间，而不是从 0 跳起。
    resampleLinear(Float32Array.from([1, 1, 1]), 32_000, 16_000, carry)
    const out = resampleLinear(Float32Array.from([1, 1]), 32_000, 16_000, carry)
    expect(out[0]).toBeGreaterThan(0.9)
  })
})

describe("AsrPcmChunker", () => {
  it("每包固定 6400 字节", () => {
    const chunker = new AsrPcmChunker(16_000)
    chunker.push(new Float32Array(ASR_PCM_CHUNK_SAMPLES))
    expect(chunker.takeChunk()).toHaveLength(ASR_PCM_CHUNK_BYTES)
  })

  it("采样不足时补静音，绝不返回半包", () => {
    const chunker = new AsrPcmChunker(16_000)
    chunker.push(new Float32Array(100).fill(1))
    const chunk = chunker.takeChunk()
    expect(chunk).toHaveLength(ASR_PCM_CHUNK_BYTES)
    // 前 100 个采样是真声音，其余补 0。
    expect(readInt16(chunk, 0)).toBe(32767)
    expect(readInt16(chunk, 99)).toBe(32767)
    expect(readInt16(chunk, 100)).toBe(0)
  })

  it("多出来的采样留到下一包，不丢也不重复", () => {
    const chunker = new AsrPcmChunker(16_000)
    chunker.push(new Float32Array(ASR_PCM_CHUNK_SAMPLES + 500).fill(1))
    expect(readInt16(chunker.takeChunk(), 10)).toBe(32767)
    expect(chunker.pendingSamples).toBe(500)
    expect(readInt16(chunker.takeChunk(), 499)).toBe(32767)
    expect(readInt16(chunker.takeChunk(), 500)).toBe(0)
  })

  it("drain 把尾巴取空且每包仍然满长", () => {
    const chunker = new AsrPcmChunker(16_000)
    chunker.push(new Float32Array(ASR_PCM_CHUNK_SAMPLES + 10))
    chunker.takeChunk()
    const rest = chunker.drain()
    expect(rest).toHaveLength(1)
    expect(rest[0]).toHaveLength(ASR_PCM_CHUNK_BYTES)
    expect(chunker.pendingSamples).toBe(0)
  })

  it("按真实时间送包：N 个 200ms 的采样刚好凑出 N 包", () => {
    const chunker = new AsrPcmChunker(16_000)
    for (let second = 0; second < 1; second += 1) {
      for (let slice = 0; slice < 5; slice += 1) {
        chunker.push(new Float32Array(ASR_PCM_CHUNK_SAMPLES))
      }
    }
    let chunks = 0
    while (chunker.pendingSamples >= ASR_PCM_CHUNK_SAMPLES) { chunker.takeChunk(); chunks += 1 }
    expect(chunks).toBe(5)
  })
})
