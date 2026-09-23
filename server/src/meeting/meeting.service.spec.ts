import { BadRequestException } from "@nestjs/common"
import { beforeEach, describe, expect, it, vi } from "vitest"

import type { PrismaService } from "../prisma/prisma.service"
import type { MeetingStoragePort } from "./meeting-storage.service"
import { MeetingService } from "./meeting.service"
import type { MeetingTranscriptionService } from "./meeting-transcription.service"

type MockFn = ReturnType<typeof vi.fn>

type PrismaMock = {
  meeting: { create: MockFn; delete: MockFn; findFirst: MockFn; findMany: MockFn; findUniqueOrThrow: MockFn; update: MockFn }
  meetingRecording: { create: MockFn; findUnique: MockFn; findFirst: MockFn; update: MockFn }
  meetingTranscriptionJob: { create: MockFn; findUnique: MockFn; findFirst: MockFn; update: MockFn }
  meetingUploadPart: { findMany: MockFn; count: MockFn; upsert: MockFn }
  meetingSpeaker: { findMany: MockFn; upsert: MockFn }
  meetingTranscriptSegment: { findMany: MockFn; deleteMany: MockFn }
  $transaction: MockFn
}

function createPrismaMock(): PrismaMock {
  return {
    meeting: {
      create: vi.fn(async (input: { data: Record<string, unknown> }) => ({ id: "meeting-1", ...input.data })),
      // 真实客户端一定返回 Promise；返回 undefined 会让「收尾失败不掩盖原始错误」那
      // 段代码在测试里炸掉，那不是产品行为。
      delete: vi.fn(async () => undefined),
      findFirst: vi.fn(),
      findMany: vi.fn(async () => []),
      findUniqueOrThrow: vi.fn(),
      update: vi.fn(),
    },
    meetingRecording: {
      create: vi.fn(async (input: { data: Record<string, unknown> }) => ({ id: "rec-1", ...input.data })),
      findUnique: vi.fn(),
      findFirst: vi.fn(),
      update: vi.fn(async (input: { data: Record<string, unknown> }) => ({
        id: "rec-1",
        meetingId: "meeting-1",
        ...input.data,
      })),
    },
    meetingTranscriptionJob: {
      create: vi.fn(),
      findUnique: vi.fn(),
      findFirst: vi.fn(),
      update: vi.fn(async (input: { data: Record<string, unknown> }) => ({
        id: "job-1",
        meetingId: "meeting-1",
        uploadId: "upload-abc",
        totalBytes: BigInt(0),
        ...input.data,
      })),
    },
    meetingUploadPart: { findMany: vi.fn(async () => []), count: vi.fn(async () => 0), upsert: vi.fn() },
    meetingSpeaker: { findMany: vi.fn(async () => []), upsert: vi.fn() },
    meetingTranscriptSegment: { findMany: vi.fn(async () => []), deleteMany: vi.fn() },
    $transaction: vi.fn(),
  }
}

let prisma: PrismaMock
let storage: Record<keyof MeetingStoragePort, MockFn>
let transcription: { submit: MockFn }
let service: MeetingService

function recordingRow(overrides: Record<string, unknown> = {}) {
  return {
    id: "rec-1",
    meetingId: "meeting-1",
    storageKey: "meeting-recordings/rec-1",
    status: "uploading",
    size: BigInt(0),
    durationMs: 0,
    peaks: null,
    ...overrides,
  }
}

function jobRow(overrides: Record<string, unknown> = {}) {
  return {
    id: "job-1",
    meetingId: "meeting-1",
    storageKey: "meeting-recordings/rec-1",
    uploadId: "upload-abc",
    totalBytes: BigInt(0),
    status: "pending",
    ...overrides,
  }
}

beforeEach(() => {
  prisma = createPrismaMock()
  prisma.$transaction.mockImplementation(async (input: unknown) => {
    if (typeof input === "function") return (input as (tx: PrismaMock) => Promise<unknown>)(prisma)
    return Promise.all((input as Promise<unknown>[]).map((entry) => entry))
  })
  storage = {
    initMultipartUpload: vi.fn(async () => "upload-abc"),
    uploadPart: vi.fn(async (input: { partNumber: number }) => `"etag-${input.partNumber}"`),
    completeMultipartUpload: vi.fn(async (input: { parts: readonly { size?: number }[] }) => ({
      size: BigInt(8),
      etag: '"final"',
    })),
    abortMultipartUpload: vi.fn(async () => undefined),
    headObject: vi.fn(async () => null),
    createDownloadUrl: vi.fn(async () => "https://example.invalid/a"),
    getObjectStream: vi.fn(),
    // 默认给一段读不出时长的字节：量时长是「量到就用、量不到退回上报值」，不需要它的
    // 用例应该走退回那条路，而不是靠一个抛异常来碰巧掉进去。
    readObjectRange: vi.fn(async () => Buffer.alloc(8)),
    deleteObject: vi.fn(async () => undefined),
    listStaleMultipartUploads: vi.fn(async () => []),
  }
  transcription = { submit: vi.fn(async () => undefined) }
  service = new MeetingService(
    prisma as unknown as PrismaService,
    storage as unknown as MeetingStoragePort,
    transcription as unknown as MeetingTranscriptionService,
  )
})

describe("开始录音", () => {
  it("建好会议、录音和任务三张表再开启分块上传", async () => {
    const result = await service.startRecording("user-1", { title: "Q3 评审" })
    expect(result).toMatchObject({ meetingId: "meeting-1", recordingId: "rec-1", uploadId: "upload-abc" })
    expect(storage.initMultipartUpload).toHaveBeenCalledWith("meeting-recordings/rec-1", "audio/mp4")
    // 对象路径必须是 recordingId 派生的那个前缀。
    expect(prisma.meetingTranscriptionJob.create).toHaveBeenCalled()
  })

  it("开不了上传就把刚建的行收干净，不留一个永远没有音频的会议", async () => {
    storage.initMultipartUpload.mockRejectedValue(new Error("存储挂了"))
    await expect(service.startRecording("user-1", {})).rejects.toThrow("存储挂了")
    expect(prisma.meeting.delete).toHaveBeenCalledWith({ where: { id: "meeting-1" } })
  })

  it("没给标题就用默认的", async () => {
    await service.startRecording("user-1", {})
    expect(prisma.meeting.create.mock.calls[0][0].data.title).toBe("新录音")
  })
})

describe("接收分片", () => {
  beforeEach(() => {
    prisma.meetingRecording.findFirst.mockResolvedValue(recordingRow())
    prisma.meetingTranscriptionJob.findUnique.mockResolvedValue(jobRow())
  })

  it("按顺序到达的分片被接受", async () => {
    // 任务上的累计字节数始终等于已存分片之和，这两处 fixture 必须一致。
    prisma.meetingTranscriptionJob.findUnique.mockResolvedValue(jobRow({ totalBytes: BigInt(5) }))
    prisma.meetingUploadPart.findMany.mockResolvedValue([{ partNumber: 1, size: 5, etag: '"etag-1"' }])
    prisma.meetingUploadPart.count.mockResolvedValue(2)
    const result = await service.acceptPart("user-1", "rec-1", 2, Buffer.alloc(5, 1))
    expect(result).toEqual({ receivedParts: 2, receivedBytes: 5 + 5 })
    expect(storage.uploadPart).toHaveBeenCalledWith(
      expect.objectContaining({ key: "meeting-recordings/rec-1", uploadId: "upload-abc", partNumber: 2 }),
    )
  })

  it("跳号的分片被拒绝", async () => {
    // 放过去会拼出一个中间缺一段的音频，而且不会有任何地方报错。
    prisma.meetingUploadPart.findMany.mockResolvedValue([{ partNumber: 1, size: 5, etag: '"etag-1"' }])
    await expect(service.acceptPart("user-1", "rec-1", 3, Buffer.alloc(5, 1))).rejects.toBeInstanceOf(
      BadRequestException,
    )
    expect(storage.uploadPart).not.toHaveBeenCalled()
  })

  it("重传已经收到的分片是允许的，但不会把字节数算两遍", async () => {
    prisma.meetingTranscriptionJob.findUnique.mockResolvedValue(jobRow({ totalBytes: BigInt(10) }))
    prisma.meetingUploadPart.findMany.mockResolvedValue([
      { partNumber: 1, size: 5, etag: '"etag-1"' },
      { partNumber: 2, size: 5, etag: '"etag-2"' },
    ])
    prisma.meetingUploadPart.count.mockResolvedValue(2)
    const result = await service.acceptPart("user-1", "rec-1", 2, Buffer.alloc(5, 9))
    expect(result.receivedBytes).toBe(10)
    expect(result.receivedParts).toBe(2)
  })

  it("空分片被拒绝", async () => {
    await expect(service.acceptPart("user-1", "rec-1", 1, Buffer.alloc(0))).rejects.toBeInstanceOf(BadRequestException)
  })

  it("别人的录音拿不到", async () => {
    prisma.meetingRecording.findFirst.mockResolvedValue(null)
    await expect(service.acceptPart("user-1", "rec-1", 1, Buffer.alloc(4, 1))).rejects.toThrow("录音不存在")
  })
})

describe("取消录音", () => {
  beforeEach(() => {
    prisma.meetingRecording.findFirst.mockResolvedValue(recordingRow())
    prisma.meetingTranscriptionJob.findUnique.mockResolvedValue(jobRow({ totalBytes: BigInt(4096) }))
  })

  it("走的是中止分块上传，不是删对象", async () => {
    // 未完成的分块上传留在桶里的分片，删对象删不掉，会一直按量计费。这条断言就是
    // 「取消必须真正中止」这个要求本身——把 abortMultipartUpload 换成 deleteObject
    // 会让它立刻变红。
    await service.cancelRecording("user-1", "rec-1")
    expect(storage.abortMultipartUpload).toHaveBeenCalledWith({
      key: "meeting-recordings/rec-1",
      uploadId: "upload-abc",
    })
    expect(storage.deleteObject).not.toHaveBeenCalled()
  })

  it("中止之后把会议整个收掉，不留半截记录", async () => {
    await service.cancelRecording("user-1", "rec-1")
    expect(prisma.meeting.delete).toHaveBeenCalledWith({ where: { id: "meeting-1" } })
  })

  it("中止失败时不静默吞掉，调用方能看见", async () => {
    storage.abortMultipartUpload.mockRejectedValue(new Error("桶连不上"))
    await expect(service.cancelRecording("user-1", "rec-1")).rejects.toThrow("桶连不上")
    expect(prisma.meeting.delete).not.toHaveBeenCalled()
  })
})

describe("完成录音", () => {
  beforeEach(() => {
    prisma.meetingRecording.findFirst.mockResolvedValue(recordingRow())
    prisma.meetingTranscriptionJob.findUnique.mockResolvedValue(jobRow({ totalBytes: BigInt(8) }))
    prisma.meetingUploadPart.findMany.mockResolvedValue([
      { partNumber: 1, size: 5, etag: '"etag-1"' },
      { partNumber: 2, size: 3, etag: '"etag-2"' },
    ])
  })

  /** 一段结构完整的 m4a 开头：`ftyp` 之后跟着 `moov/mvhd`，时长 = duration / timescale。 */
  function audioHead(timescale: number, duration: number): Buffer {
    const ftyp = Buffer.alloc(28)
    ftyp.writeUInt32BE(28, 0)
    ftyp.write("ftyp", 4, "latin1")
    const mvhdContent = Buffer.alloc(108)
    mvhdContent.writeUInt32BE(timescale, 12)
    mvhdContent.writeUInt32BE(duration, 16)
    const mvhd = Buffer.concat([boxHeader("mvhd", mvhdContent.length), mvhdContent])
    return Buffer.concat([ftyp, boxHeader("moov", mvhd.length), mvhd])
  }

  function boxHeader(type: string, payloadBytes: number): Buffer {
    const header = Buffer.alloc(8)
    header.writeUInt32BE(8 + payloadBytes, 0)
    header.write(type, 4, "latin1")
    return header
  }

  /**
   * 现场那条 6 秒录音上报的就是 0 秒（`AVAudioRecorder` 的 `currentTime` 读成了 0），
   * 界面因此显示「0 秒的录音，预计 1 分左右完成」。文件本身才是准的。
   */
  it("时长以量出来的为准：客户端报 0，服务端从 mvhd 量出 5.99 秒", async () => {
    const audio = audioHead(48_000, 287_744)
    prisma.meetingUploadPart.findMany.mockResolvedValue([{ partNumber: 1, size: audio.length, etag: '"etag-1"' }])
    storage.completeMultipartUpload.mockResolvedValue({ size: BigInt(audio.length), etag: '"final"' })
    // 桩要和线上一样**按请求的范围**给字节：判定和量时长都是顺着盒子链走的，返回一整段
    // 与对象长度对不上的字节会让链在文件末尾之外找索引。
    storage.readObjectRange.mockImplementation(async (_key: string, start: number, end: number) =>
      audio.subarray(start, end + 1),
    )
    await service.completeRecording("user-1", "rec-1", { durationMs: 0, peaks: "", speakerCount: 0 })
    expect(prisma.meetingRecording.update.mock.calls.at(-1)?.[0].data).toMatchObject({ durationMs: 5995 })
    expect(prisma.meeting.update.mock.calls.at(-1)?.[0].data).toMatchObject({ durationMs: 5995 })
  })

  /** 按字节估出来的那个值偏大（占位区不是音频），量不出来时也不该反过来被它盖掉。 */
  it("量不出来就退回客户端上报的值，不写 0", async () => {
    storage.completeMultipartUpload.mockResolvedValue({ size: BigInt(8), etag: '"final"' })
    storage.readObjectRange.mockResolvedValue(Buffer.alloc(64))
    await service.completeRecording("user-1", "rec-1", { durationMs: 13_639, peaks: "", speakerCount: 0 })
    expect(prisma.meeting.update.mock.calls.at(-1)?.[0].data).toMatchObject({ durationMs: 13_639 })
  })

  it("读对象失败不能挡住收尾", async () => {
    storage.completeMultipartUpload.mockResolvedValue({ size: BigInt(8), etag: '"final"' })
    storage.readObjectRange.mockRejectedValue(new Error("对象存储抖了一下"))
    await expect(
      service.completeRecording("user-1", "rec-1", { durationMs: 5000, peaks: "", speakerCount: 0 }),
    ).resolves.toEqual({ meetingId: "meeting-1", status: "transcribing" })
    expect(prisma.meeting.update.mock.calls.at(-1)?.[0].data).toMatchObject({ durationMs: 5000 })
  })

  it("合并、校验大小、存波形，然后把任务交给转写", async () => {
    storage.completeMultipartUpload.mockResolvedValue({ size: BigInt(8), etag: '"final"' })
    const result = await service.completeRecording("user-1", "rec-1", {
      durationMs: 72_000,
      peaks: "AAAA",
      speakerCount: 3,
    })
    expect(result).toEqual({ meetingId: "meeting-1", status: "transcribing" })
    expect(storage.completeMultipartUpload).toHaveBeenCalledWith({
      key: "meeting-recordings/rec-1",
      uploadId: "upload-abc",
      parts: [
        { partNumber: 1, etag: '"etag-1"' },
        { partNumber: 2, etag: '"etag-2"' },
      ],
    })
    expect(transcription.submit).toHaveBeenCalledWith("meeting-1")
  })

  it("合并后大小和分片之和对不上就报错，不把残缺的音频交给转写", async () => {
    storage.completeMultipartUpload.mockResolvedValue({ size: BigInt(7), etag: '"final"' })
    await expect(
      service.completeRecording("user-1", "rec-1", { durationMs: 1000, peaks: "", speakerCount: 0 }),
    ).rejects.toBeInstanceOf(BadRequestException)
    expect(transcription.submit).not.toHaveBeenCalled()
  })

  it("提交转写失败不算这次录音失败：音频已经完整，任务留给定时任务", async () => {
    storage.completeMultipartUpload.mockResolvedValue({ size: BigInt(8), etag: '"final"' })
    transcription.submit.mockRejectedValue(new Error("腾讯云连不上"))
    await expect(
      service.completeRecording("user-1", "rec-1", { durationMs: 1000, peaks: "", speakerCount: 0 }),
    ).resolves.toEqual({ meetingId: "meeting-1", status: "transcribing" })
  })

  it("一个字都没有的录音不提交", async () => {
    prisma.meetingUploadPart.findMany.mockResolvedValue([])
    await expect(
      service.completeRecording("user-1", "rec-1", { durationMs: 0, peaks: "", speakerCount: 0 }),
    ).rejects.toBeInstanceOf(BadRequestException)
  })

  it("重复调用不会重新合并一次", async () => {
    prisma.meetingRecording.findFirst.mockResolvedValue(recordingRow({ status: "ready" }))
    prisma.meeting.findUniqueOrThrow.mockResolvedValue({ id: "meeting-1", status: "done" })
    const result = await service.completeRecording("user-1", "rec-1", {
      durationMs: 1000,
      peaks: "",
      speakerCount: 0,
    })
    expect(result).toEqual({ meetingId: "meeting-1", status: "done" })
    expect(storage.completeMultipartUpload).not.toHaveBeenCalled()
  })
})

describe("删除录音", () => {
  beforeEach(() => {
    prisma.meeting.findFirst.mockResolvedValue({ id: "meeting-1", userId: "user-1" })
    prisma.meetingRecording.findUnique.mockResolvedValue(recordingRow({ status: "ready" }))
  })

  it("对象真的删掉，逐字稿和纪要不动", async () => {
    await service.deleteRecording("user-1", "meeting-1")
    expect(storage.deleteObject).toHaveBeenCalledWith("meeting-recordings/rec-1")
    expect(prisma.meetingRecording.update.mock.calls[0][0].data).toMatchObject({ status: "deleted" })
    // 逐字稿是另一张表，删除录音不该碰它。
    expect(prisma.meetingTranscriptSegment.deleteMany).not.toHaveBeenCalled()
  })

  it("删不掉时标记待重试，而不是让用户以为删成功了却一直占着空间", async () => {
    storage.deleteObject.mockRejectedValue(new Error("桶超时"))
    await service.deleteRecording("user-1", "meeting-1")
    expect(prisma.meetingRecording.update.mock.calls[0][0].data).toMatchObject({
      status: "deleted",
      deletePending: true,
    })
  })

  it("已经删过的直接返回，不重复请求对象存储", async () => {
    prisma.meetingRecording.findUnique.mockResolvedValue(recordingRow({ status: "deleted" }))
    await service.deleteRecording("user-1", "meeting-1")
    expect(storage.deleteObject).not.toHaveBeenCalled()
  })
})

describe("删除整条录音", () => {
  beforeEach(() => {
    prisma.meeting.findFirst.mockResolvedValue({ id: "meeting-1", userId: "user-1" })
  })

  it("已经传完的录音删的是对象，不是分块上传", async () => {
    // 取消录音那条路在 uploadId 已经置空之后不删对象，会留一个孤儿 COS 对象。
    // 这条断言就是「整条删除必须覆盖已完成的音频」这个要求本身。
    prisma.meetingRecording.findUnique.mockResolvedValue(recordingRow({ status: "ready" }))
    prisma.meetingTranscriptionJob.findUnique.mockResolvedValue(jobRow({ uploadId: null }))
    await service.deleteMeeting("user-1", "meeting-1")
    expect(storage.deleteObject).toHaveBeenCalledWith("meeting-recordings/rec-1")
    expect(storage.abortMultipartUpload).not.toHaveBeenCalled()
  })

  it("还没传完的录音中止分块上传，碎片不会一直计费", async () => {
    prisma.meetingRecording.findUnique.mockResolvedValue(recordingRow({ status: "uploading" }))
    prisma.meetingTranscriptionJob.findUnique.mockResolvedValue(jobRow())
    await service.deleteMeeting("user-1", "meeting-1")
    expect(storage.abortMultipartUpload).toHaveBeenCalledWith({
      key: "meeting-recordings/rec-1",
      uploadId: "upload-abc",
    })
  })

  it("两条清理路径都覆盖，不是二选一", async () => {
    // uploadId 还在，但对象是在上一次完成里已经合并好的——两个都要清。
    prisma.meetingRecording.findUnique.mockResolvedValue(recordingRow({ status: "ready" }))
    prisma.meetingTranscriptionJob.findUnique.mockResolvedValue(jobRow())
    await service.deleteMeeting("user-1", "meeting-1")
    expect(storage.abortMultipartUpload).toHaveBeenCalled()
    expect(storage.deleteObject).toHaveBeenCalled()
  })

  it("删的是会议这一行，逐字稿和发言人靠级联一起清掉", async () => {
    prisma.meetingRecording.findUnique.mockResolvedValue(recordingRow({ status: "ready" }))
    prisma.meetingTranscriptionJob.findUnique.mockResolvedValue(jobRow({ uploadId: null }))
    await service.deleteMeeting("user-1", "meeting-1")
    expect(prisma.meeting.delete).toHaveBeenCalledWith({ where: { id: "meeting-1" } })
  })

  it("上次没删成的对象这一次补删，不留一条永远清不掉的重试", async () => {
    prisma.meetingRecording.findUnique.mockResolvedValue(
      recordingRow({ status: "deleted", deletePending: true }),
    )
    prisma.meetingTranscriptionJob.findUnique.mockResolvedValue(jobRow({ uploadId: null }))
    await service.deleteMeeting("user-1", "meeting-1")
    expect(storage.deleteObject).toHaveBeenCalledWith("meeting-recordings/rec-1")
  })

  it("已经删干净的历史记录不重复请求对象存储", async () => {
    prisma.meetingRecording.findUnique.mockResolvedValue(
      recordingRow({ status: "deleted", deletePending: false }),
    )
    prisma.meetingTranscriptionJob.findUnique.mockResolvedValue(jobRow({ uploadId: null }))
    await service.deleteMeeting("user-1", "meeting-1")
    expect(storage.deleteObject).not.toHaveBeenCalled()
    expect(prisma.meeting.delete).toHaveBeenCalled()
  })

  it("删除成功一次之后再做一次仍然返回成功，不会 500", async () => {
    prisma.meeting.findFirst.mockResolvedValue(null)
    await expect(service.deleteMeeting("user-1", "meeting-1")).resolves.toBeUndefined()
    expect(prisma.meeting.delete).not.toHaveBeenCalled()
  })

  it("别人的录音删不掉，也不动任何数据", async () => {
    prisma.meeting.findFirst.mockResolvedValue(null)
    await service.deleteMeeting("user-2", "meeting-1")
    expect(prisma.meeting.findFirst).toHaveBeenCalledWith({ where: { id: "meeting-1", userId: "user-2" } })
    expect(prisma.meeting.delete).not.toHaveBeenCalled()
    expect(storage.deleteObject).not.toHaveBeenCalled()
  })

  it("对象删不掉也照样把记录删掉，用户不会卡在一条删不掉的录音上", async () => {
    storage.deleteObject.mockRejectedValue(new Error("桶超时"))
    prisma.meetingRecording.findUnique.mockResolvedValue(recordingRow({ status: "ready" }))
    prisma.meetingTranscriptionJob.findUnique.mockResolvedValue(jobRow({ uploadId: null }))
    await expect(service.deleteMeeting("user-1", "meeting-1")).resolves.toBeUndefined()
    expect(prisma.meeting.delete).toHaveBeenCalledWith({ where: { id: "meeting-1" } })
  })

  it("中止分块上传失败也照样把记录删掉", async () => {
    storage.abortMultipartUpload.mockRejectedValue(new Error("桶连不上"))
    prisma.meetingRecording.findUnique.mockResolvedValue(recordingRow({ status: "uploading" }))
    prisma.meetingTranscriptionJob.findUnique.mockResolvedValue(jobRow())
    await expect(service.deleteMeeting("user-1", "meeting-1")).resolves.toBeUndefined()
    expect(prisma.meeting.delete).toHaveBeenCalledWith({ where: { id: "meeting-1" } })
  })
})

describe("转写失败后的重试", () => {
  it("不需要重新上传，只换一个任务号重新提交", async () => {
    prisma.meeting.findFirst.mockResolvedValue({ id: "meeting-1", userId: "user-1" })
    prisma.meetingRecording.findUnique.mockResolvedValue(recordingRow({ status: "ready" }))
    await service.retryTranscription("user-1", "meeting-1")
    expect(storage.initMultipartUpload).not.toHaveBeenCalled()
    expect(prisma.meetingTranscriptionJob.update.mock.calls[0][0].data).toMatchObject({
      status: "pending",
      taskId: null,
      attempts: 0,
    })
    expect(transcription.submit).toHaveBeenCalledWith("meeting-1")
  })

  it("录音已经删掉时不能重试，并说清原因", async () => {
    prisma.meeting.findFirst.mockResolvedValue({ id: "meeting-1", userId: "user-1" })
    prisma.meetingRecording.findUnique.mockResolvedValue(recordingRow({ status: "deleted" }))
    await expect(service.retryTranscription("user-1", "meeting-1")).rejects.toBeInstanceOf(BadRequestException)
  })
})

describe("详情仍然带着两端界面不再渲染的字段", () => {
  it("speakers / minutes / segments 照常返回", async () => {
    // 手机端 MeetingDetail 的 speakers / segments 是非可选数组。服务端一旦停止返回，
    // 还没升级到新版本的 App 打开详情页会直接解码失败——用户手机上装的是 TestFlight
    // 版本，升级不是同步发生的。这条断言就是那份兼容性本身。
    prisma.meeting.findFirst.mockResolvedValue({
      id: "meeting-1",
      userId: "user-1",
      title: "Q3 评审",
      startedAt: new Date("2026-09-19T02:00:00.000Z"),
      durationMs: 1000,
      status: "done",
      speakerCount: 2,
      failureReason: null,
      minutesStatus: "ready",
      minutesJson: { topics: ["路线图"], conclusions: [], todos: [] },
      minutesFailureReason: null,
      minutesEditedAt: null,
      createdAt: new Date("2026-09-19T02:00:00.000Z"),
    })
    prisma.meetingRecording.findUnique.mockResolvedValue(recordingRow({ status: "ready" }))
    prisma.meetingSpeaker.findMany.mockResolvedValue([{ speakerId: 0, name: "李杨" }])
    prisma.meetingTranscriptSegment.findMany.mockResolvedValue([
      { id: "seg-1", speakerId: 0, startMs: 420, endMs: 900, text: "先说排序。", words: [] },
    ])

    const detail = await service.get("user-1", "meeting-1")

    expect(detail.speakers).toEqual([{ speakerId: 0, name: "李杨" }])
    expect(detail.segments).toEqual([
      { id: "seg-1", speakerId: 0, startMs: 420, endMs: 900, text: "先说排序。", words: [] },
    ])
    expect(detail.minutes).toMatchObject({ topics: ["路线图"] })
    expect(detail.speakerCount).toBe(2)
  })
})

describe("转写进度", () => {
  const meetingRow = {
    id: "meeting-1",
    userId: "user-1",
    title: "Q3 评审",
    startedAt: new Date("2026-09-19T02:00:00.000Z"),
    durationMs: 120_000,
    status: "transcribing",
    speakerCount: 0,
    failureReason: null,
    minutesStatus: "none",
    minutesJson: null,
    minutesFailureReason: null,
    minutesEditedAt: null,
    createdAt: new Date("2026-09-19T02:00:00.000Z"),
  }

  beforeEach(() => {
    prisma.meeting.findFirst.mockResolvedValue(meetingRow)
    prisma.meetingRecording.findUnique.mockResolvedValue(recordingRow({ status: "ready" }))
    prisma.meetingSpeaker.findMany.mockResolvedValue([])
    prisma.meetingTranscriptSegment.findMany.mockResolvedValue([])
  })

  /** 估算的模型是「一分钟轮询下限 + 音频时长 × 0.3」：两分钟的录音就是 96 秒。 */
  it("投出去之后按已等待的时长报进度，预期耗时跟着音频时长走", async () => {
    prisma.meetingTranscriptionJob.findUnique.mockResolvedValue({
      status: "running",
      taskId: "42",
      submittedAt: new Date(Date.now() - 30_000),
    })

    const detail = await service.get("user-1", "meeting-1")

    expect(detail.transcription?.stage).toBe("running")
    // 时钟从投递那一刻起算，不是从录音结束起算：排队等着被投出去的那几十秒不该算进
    // 识别时间里，否则进度条一上来就凭空走了半格。
    expect(detail.transcription?.elapsedMs).toBeGreaterThanOrEqual(29_000)
    expect(detail.transcription?.elapsedMs).toBeLessThan(35_000)
    expect(detail.transcription?.expectedMs).toBe(96_000)
  })

  it("还没投出去说排队中，计时归零", async () => {
    prisma.meetingTranscriptionJob.findUnique.mockResolvedValue({
      status: "pending",
      taskId: null,
      submittedAt: null,
    })

    const detail = await service.get("user-1", "meeting-1")

    expect(detail.transcription).toMatchObject({ stage: "queued", elapsedMs: 0 })
  })
})

describe("越权", () => {
  it("不是自己的会议一律当作不存在", async () => {
    prisma.meeting.findFirst.mockResolvedValue(null)
    await expect(service.get("user-2", "meeting-1")).rejects.toThrow("会议不存在")
    expect(prisma.meeting.findFirst).toHaveBeenCalledWith({ where: { id: "meeting-1", userId: "user-2" } })
  })
})
