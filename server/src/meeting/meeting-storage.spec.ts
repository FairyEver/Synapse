import { mkdtemp, readdir, rm, stat } from "node:fs/promises"
import os from "node:os"
import path from "node:path"
import { afterEach, describe, expect, it, vi } from "vitest"

/**
 * 对象存储 SDK 被整个换掉：这里验证的是「我们怎么调它」，而不是腾讯云的行为。
 * 每个方法都被记下来，断言写的是调用参数——中止分块上传那条尤其重要，它是这个功能
 * 里唯一一处「不做也不会报错、但会一直计费」的地方。
 */
const cosMock = vi.hoisted(() => {
  const calls: { method: string; params: Record<string, unknown> }[] = []
  const record = (method: string) =>
    vi.fn(async (params: Record<string, unknown>) => {
      calls.push({ method, params })
      if (method === "multipartInit") return { UploadId: "upload-1" }
      if (method === "multipartUpload") return { ETag: `"etag-${String(params.PartNumber)}"` }
      if (method === "multipartComplete") return { ETag: '"final"', Location: "bucket/key" }
      if (method === "multipartList") return { Upload: [], IsTruncated: false }
      return {}
    })
  return {
    calls,
    instance: {
      multipartInit: record("multipartInit"),
      multipartUpload: record("multipartUpload"),
      multipartComplete: record("multipartComplete"),
      multipartAbort: record("multipartAbort"),
      multipartList: record("multipartList"),
      headObject: vi.fn(async () => ({ headers: { "content-length": "9", etag: '"final"' } })),
      deleteObject: record("deleteObject"),
      getObjectUrl: vi.fn(() => "https://example.invalid/signed"),
      getObjectStream: vi.fn(() => ({}) as unknown as NodeJS.ReadableStream),
    },
  }
})

vi.mock("cos-nodejs-sdk-v5", () => ({
  default: function MockCos() {
    return cosMock.instance
  },
}))

import {
  CosMeetingStorage,
  LocalMeetingStorage,
  MEETING_STORAGE_PORT,
  type MeetingStoragePort,
} from "./meeting-storage.service"
import { MEETING_RECORDING_PATH_PREFIX } from "@synapse/shared"

const temporaryRoots: string[] = []

async function localStorage(): Promise<{ storage: LocalMeetingStorage; root: string }> {
  const root = await mkdtemp(path.join(os.tmpdir(), "synapse-meeting-storage-"))
  temporaryRoots.push(root)
  return {
    storage: new LocalMeetingStorage({ root, publicAppUrl: "https://example.test" }),
    root,
  }
}

function cosStorage(): MeetingStoragePort {
  return new CosMeetingStorage({
    secretId: "secret-id",
    secretKey: "secret-key",
    bucket: "bucket-1250000000",
    region: "ap-beijing",
  })
}

afterEach(async () => {
  await Promise.all(temporaryRoots.map((root) => rm(root, { force: true, recursive: true })))
  temporaryRoots.length = 0
  cosMock.calls.length = 0
  for (const fn of Object.values(cosMock.instance)) vi.mocked(fn as () => unknown).mockClear()
})

describe("LocalMeetingStorage", () => {
  it("完整上传后对象大小等于各分片之和", async () => {
    const { storage } = await localStorage()
    const key = `${MEETING_RECORDING_PATH_PREFIX}/rec-1`
    const uploadId = await storage.initMultipartUpload(key, "audio/mp4")
    const first = Buffer.alloc(11, 1)
    const second = Buffer.alloc(7, 2)
    const firstEtag = await storage.uploadPart({ key, uploadId, partNumber: 1, body: first })
    const secondEtag = await storage.uploadPart({ key, uploadId, partNumber: 2, body: second })

    const completed = await storage.completeMultipartUpload({
      key,
      uploadId,
      parts: [
        { partNumber: 1, etag: firstEtag },
        { partNumber: 2, etag: secondEtag },
      ],
    })

    expect(Number(completed.size)).toBe(first.byteLength + second.byteLength)
    const info = await storage.headObject(key)
    expect(Number(info?.size)).toBe(11 + 7)
  })

  it("分片按编号拼，晚到的先入库也不会拼错顺序", async () => {
    const { storage } = await localStorage()
    const key = `${MEETING_RECORDING_PATH_PREFIX}/rec-order`
    const uploadId = await storage.initMultipartUpload(key, "audio/mp4")
    const etags = new Map<number, string>()
    for (const [partNumber, fill] of [
      [1, 65],
      [2, 66],
      [3, 67],
    ] as const) {
      const etag = await storage.uploadPart({ key, uploadId, partNumber, body: Buffer.alloc(4, fill) })
      etags.set(partNumber, etag)
    }
    await storage.completeMultipartUpload({
      key,
      uploadId,
      // 故意打乱传入顺序：拼接必须按 partNumber，而不是按数组顺序。
      parts: [3, 1, 2].map((partNumber) => ({ partNumber, etag: etags.get(partNumber)! })),
    })
    const stream = await storage.getObjectStream(key)
    const chunks: Buffer[] = []
    for await (const chunk of stream.stream) chunks.push(Buffer.from(chunk as Buffer))
    expect(Buffer.concat(chunks).toString("latin1")).toBe("AAAABBBBCCCC")
  })

  it("中途中止后对象不存在，且分片也被丢掉", async () => {
    const { storage, root } = await localStorage()
    const key = `${MEETING_RECORDING_PATH_PREFIX}/rec-2`
    const uploadId = await storage.initMultipartUpload(key, "audio/mp4")
    await storage.uploadPart({ key, uploadId, partNumber: 1, body: Buffer.alloc(1024, 1) })

    await storage.abortMultipartUpload({ key, uploadId })

    expect(await storage.headObject(key)).toBeNull()
    const objectsDirectory = path.join(root, "platform-media", ...key.split("/"))
    await expect(stat(objectsDirectory)).rejects.toThrow()
    const entries = await readdir(path.join(root, "platform-media", MEETING_RECORDING_PATH_PREFIX))
    expect(entries.filter((entry) => entry.startsWith("rec-2"))).toEqual([])
  })

  it("中止之后分片目录整个消失，一条残片都不留", async () => {
    const { storage, root } = await localStorage()
    const key = `${MEETING_RECORDING_PATH_PREFIX}/rec-3`
    const uploadId = await storage.initMultipartUpload(key, "audio/mp4")
    await storage.uploadPart({ key, uploadId, partNumber: 1, body: Buffer.alloc(8, 1) })
    await storage.uploadPart({ key, uploadId, partNumber: 2, body: Buffer.alloc(8, 2) })

    await storage.abortMultipartUpload({ key, uploadId })

    const partsDirectory = path.join(root, "platform-media", ...key.split("/")) + ".parts"
    await expect(stat(partsDirectory)).rejects.toThrow()
  })

  it("只删对象不算中止：残留的分片目录还在", async () => {
    // 这条钉住「deleteObject 顶替不了 abort」这个事实本身。如果哪天有人把取消实现成
    // 删对象，本地路径下会立刻漏出分片目录——测试在这里变红。
    const { storage, root } = await localStorage()
    const key = `${MEETING_RECORDING_PATH_PREFIX}/rec-4`
    const uploadId = await storage.initMultipartUpload(key, "audio/mp4")
    await storage.uploadPart({ key, uploadId, partNumber: 1, body: Buffer.alloc(8, 1) })

    await storage.deleteObject(key)

    const partsDirectory = path.join(root, "platform-media", ...key.split("/")) + ".parts"
    expect((await stat(partsDirectory)).isDirectory()).toBe(true)
  })

  it("扫描能找出超期未完成的分块上传并丢掉它", async () => {
    const { storage, root } = await localStorage()
    const key = `${MEETING_RECORDING_PATH_PREFIX}/rec-5`
    const uploadId = await storage.initMultipartUpload(key, "audio/mp4")
    await storage.uploadPart({ key, uploadId, partNumber: 1, body: Buffer.alloc(8, 1) })
    const partsDirectory = path.join(root, "platform-media", ...key.split("/")) + ".parts"
    // 把目录的修改时间推到很久以前，模拟一次没人收尾的上传。
    await (await import("node:fs/promises")).utimes(partsDirectory, new Date(0), new Date(0))

    expect(await storage.listStaleMultipartUploads(60_000)).toEqual([key])
    await expect(stat(partsDirectory)).rejects.toThrow()
  })

  it("刚开的上传不会被当成分片碎片扫掉", async () => {
    const { storage } = await localStorage()
    const key = `${MEETING_RECORDING_PATH_PREFIX}/rec-6`
    const uploadId = await storage.initMultipartUpload(key, "audio/mp4")
    await storage.uploadPart({ key, uploadId, partNumber: 1, body: Buffer.alloc(8, 1) })
    expect(await storage.listStaleMultipartUploads(60_000)).toEqual([])
  })

  it("下载地址带可见的过期时间，且指向本机回放入口", async () => {
    const { storage } = await localStorage()
    const key = `${MEETING_RECORDING_PATH_PREFIX}/rec-7`
    const url = await storage.createDownloadUrl(key, 3600)
    expect(url.startsWith("https://example.test/api/meetings/local-audio/")).toBe(true)
    const token = url.split("/").at(-1)!
    expect(await storage.resolveDownloadToken(token)).toBe(key)
  })

  it("对象键试图越界时直接拒绝", async () => {
    const { storage } = await localStorage()
    await expect(storage.headObject("../../etc/passwd")).rejects.toThrow()
  })
})

describe("CosMeetingStorage", () => {
  it("中止走的是 multipartAbort，不是 deleteObject", async () => {
    const storage = cosStorage()
    await storage.abortMultipartUpload({ key: `${MEETING_RECORDING_PATH_PREFIX}/rec-8`, uploadId: "upload-8" })
    expect(cosMock.calls.map((call) => call.method)).toEqual(["multipartAbort"])
    expect(cosMock.calls[0].params.UploadId).toBe("upload-8")
  })

  it("合并时按 partNumber 升序传分片", async () => {
    const storage = cosStorage()
    await storage.completeMultipartUpload({
      key: `${MEETING_RECORDING_PATH_PREFIX}/rec-9`,
      uploadId: "upload-9",
      parts: [
        { partNumber: 3, etag: "c" },
        { partNumber: 1, etag: "a" },
        { partNumber: 2, etag: "b" },
      ],
    })
    const parts = cosMock.calls.find((call) => call.method === "multipartComplete")?.params.Parts as {
      PartNumber: number
    }[]
    expect(parts.map((part) => part.PartNumber)).toEqual([1, 2, 3])
  })

  it("合并后回查不到对象就抛错，不会把一次没落地的合并当成成功", async () => {
    const storage = cosStorage()
    // 合并完回查对象时拿到 404：合并这一步其实没落地。
    cosMock.instance.headObject.mockRejectedValueOnce(Object.assign(new Error("Not Found"), { statusCode: 404 }))
    await expect(
      storage.completeMultipartUpload({
        key: `${MEETING_RECORDING_PATH_PREFIX}/rec-10`,
        uploadId: "upload-10",
        parts: [{ partNumber: 1, etag: "a" }],
      }),
      // 合并本身失败或回查失败都必须显式抛出：静默成功会让用户拿到一个永远转写不出
      // 结果、也永远不报错的会议。
    ).rejects.toThrow(/did not report/i)
  })

  it("扫描超期上传时只扫会议录音前缀，并且真的逐个中止", async () => {
    const storage = cosStorage()
    cosMock.instance.multipartList.mockResolvedValueOnce({
      Upload: [
        { Key: `${MEETING_RECORDING_PATH_PREFIX}/stale-1`, UploadId: "u1", Initiated: new Date(0).toISOString() },
        { Key: `${MEETING_RECORDING_PATH_PREFIX}/fresh-1`, UploadId: "u2", Initiated: new Date().toISOString() },
      ],
      IsTruncated: false,
    } as never)
    const aborted = await storage.listStaleMultipartUploads(60_000)
    expect(aborted).toEqual([`${MEETING_RECORDING_PATH_PREFIX}/stale-1`])
    // mockResolvedValueOnce 会顶掉记录用的实现，所以这一条从 mock 自己的调用记录读。
    expect(cosMock.instance.multipartList.mock.calls.at(-1)?.[0]).toMatchObject({
      Prefix: `${MEETING_RECORDING_PATH_PREFIX}/`,
    })
    const abortCalls = cosMock.calls.filter((call) => call.method === "multipartAbort")
    expect(abortCalls).toHaveLength(1)
    expect(abortCalls[0].params.UploadId).toBe("u1")
  })
})

describe("存储端口装配", () => {
  it("端口令牌是个 Symbol，避免被字符串撞上", () => {
    expect(typeof MEETING_STORAGE_PORT).toBe("symbol")
  })
})
