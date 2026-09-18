import { describe, expect, it, vi } from "vitest"

import { createChunkUploader } from "../chunk-uploader"

const PART = 8

function bytes(value: number, length: number): ArrayBuffer {
  return new Uint8Array(length).fill(value).buffer as ArrayBuffer
}

function uploadedValues(parts: ArrayBuffer[]): number[] {
  return parts.map((part) => new Uint8Array(part)[0] ?? -1)
}

describe("分片拼装", () => {
  it("攒够一片才传，没攒够先留在缓冲里", async () => {
    const parts: ArrayBuffer[] = []
    const uploader = createChunkUploader({
      uploadPart: async (_partNumber, part) => {
        parts.push(part)
      },
      abort: async () => undefined,
      partBytes: PART,
    })
    await uploader.append(bytes(1, 5))
    expect(parts).toHaveLength(0)
    expect(uploader.bufferedBytes).toBe(5)

    await uploader.append(bytes(2, 3))
    expect(parts).toHaveLength(1)
    expect(uploader.bufferedBytes).toBe(0)
    expect(uploader.uploadedParts).toBe(1)
  })

  it("一次交进来的字节超过一片时会被切成多片", async () => {
    const parts: ArrayBuffer[] = []
    const uploader = createChunkUploader({
      uploadPart: async (_partNumber, part) => {
        parts.push(part)
      },
      abort: async () => undefined,
      partBytes: PART,
    })
    await uploader.append(bytes(1, PART * 2 + 3))
    expect(parts).toHaveLength(2)
    expect(uploader.uploadedParts).toBe(2)
    expect(uploader.bufferedBytes).toBe(3)
  })

  it("分片按 1、2、3 的顺序编号，内容也是按顺序切的", async () => {
    const numbers: number[] = []
    const parts: ArrayBuffer[] = []
    const uploader = createChunkUploader({
      uploadPart: async (partNumber, part) => {
        numbers.push(partNumber)
        parts.push(part)
      },
      abort: async () => undefined,
      partBytes: PART,
    })
    await uploader.append(bytes(7, PART))
    await uploader.append(bytes(9, PART))
    expect(numbers).toEqual([1, 2])
    expect(uploadedValues(parts)).toEqual([7, 9])
  })

  it("finish 会把不足一片的尾片补上", async () => {
    const parts: ArrayBuffer[] = []
    const uploader = createChunkUploader({
      uploadPart: async (_partNumber, part) => {
        parts.push(part)
      },
      abort: async () => undefined,
      partBytes: PART,
    })
    await uploader.append(bytes(1, PART))
    await uploader.append(bytes(4, 3))
    expect(parts).toHaveLength(1)

    await uploader.finish()
    expect(parts).toHaveLength(2)
    expect(new Uint8Array(parts[1])[0]).toBe(4)
    expect(uploader.hasPendingTail).toBe(false)
  })

  it("高并发 append 会被串成一条链，编号不会乱", async () => {
    const numbers: number[] = []
    const uploader = createChunkUploader({
      uploadPart: async (partNumber) => {
        numbers.push(partNumber)
        await new Promise((resolve) => setTimeout(resolve, 1))
      },
      abort: async () => undefined,
      partBytes: PART,
    })
    await Promise.all([
      uploader.append(bytes(1, PART)),
      uploader.append(bytes(2, PART)),
      uploader.append(bytes(3, PART)),
    ])
    expect(numbers).toEqual([1, 2, 3])
  })

  it("传失败会重试，重试成功就不会丢片", async () => {
    let attempts = 0
    const uploader = createChunkUploader({
      uploadPart: async () => {
        attempts += 1
        if (attempts < 2) throw new Error("网络抖动")
      },
      abort: async () => undefined,
      partBytes: PART,
      retries: 3,
    })
    await uploader.append(bytes(1, PART))
    expect(attempts).toBe(2)
    expect(uploader.uploadedParts).toBe(1)
  })

  it("重试用尽之后整条链上抛，不静默丢片", async () => {
    const uploader = createChunkUploader({
      uploadPart: async () => {
        throw new Error("一直失败")
      },
      abort: async () => undefined,
      partBytes: PART,
      retries: 1,
    })
    await expect(uploader.append(bytes(1, PART))).rejects.toThrow("一直失败")
  })
})

describe("取消", () => {
  it("走的是中止，不是什么都不做", async () => {
    // 未完成的分块上传留在桶里的分片，删对象删不掉，会一直按量计费。把 abort 换成
    // 一个空实现，这条立刻变红。
    const abort = vi.fn(async () => undefined)
    const uploader = createChunkUploader({
      uploadPart: async () => undefined,
      abort,
      partBytes: PART,
    })
    await uploader.append(bytes(1, PART))
    await uploader.cancel()
    expect(abort).toHaveBeenCalledTimes(1)
  })

  it("取消之后不再传任何分片", async () => {
    const parts: ArrayBuffer[] = []
    const uploader = createChunkUploader({
      uploadPart: async (_partNumber, part) => {
        parts.push(part)
      },
      abort: async () => undefined,
      partBytes: PART,
    })
    await uploader.cancel()
    await uploader.append(bytes(1, PART * 3))
    await uploader.finish()
    expect(parts).toHaveLength(0)
    expect(uploader.bufferedBytes).toBe(0)
  })

  it("取消会等在途的分片传完再中止，否则那一片会变成桶里的碎片", async () => {
    const order: string[] = []
    let markStarted: () => void = () => undefined
    let releaseUpload: () => void = () => undefined
    const started = new Promise<void>((resolve) => {
      markStarted = resolve
    })
    const uploader = createChunkUploader({
      uploadPart: async () => {
        order.push("upload:start")
        markStarted()
        await new Promise<void>((resolve) => {
          releaseUpload = resolve
        })
        order.push("upload:end")
      },
      abort: async () => {
        order.push("abort")
      },
      partBytes: PART,
    })
    const appending = uploader.append(bytes(1, PART))
    await started
    const cancelling = uploader.cancel()
    releaseUpload()
    await Promise.all([appending, cancelling])
    expect(order).toEqual(["upload:start", "upload:end", "abort"])
  })
})
