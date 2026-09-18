import { beforeEach, describe, expect, it, vi } from "vitest"

import type { PrismaService } from "../prisma/prisma.service"
import type { MeetingConfig } from "./meeting.config"
import { MeetingTranscriptionService } from "./meeting-transcription.service"
import type { MeetingStoragePort } from "./meeting-storage.service"

const createRecTaskMock = vi.hoisted(() => vi.fn())
const describeTaskStatusMock = vi.hoisted(() => vi.fn())

vi.mock("./tencent-asr", async () => {
  const actual = await vi.importActual<typeof import("./tencent-asr")>("./tencent-asr")
  return {
    ...actual,
    createRecTask: createRecTaskMock,
    describeTaskStatus: describeTaskStatusMock,
  }
})

type MockFn = ReturnType<typeof vi.fn>

type PrismaMock = {
  meetingTranscriptionJob: {
    findUnique: MockFn
    findMany: MockFn
    update: MockFn
  }
  meetingRecording: { findMany: MockFn; update: MockFn }
  meetingTranscriptSegment: { deleteMany: MockFn; createMany: MockFn }
  meetingSpeaker: { upsert: MockFn }
  meeting: { update: MockFn }
  $transaction: MockFn
}

/**
 * `attempts` 走的是一个真的会累加的计数器。
 *
 * 直接回一个常量会让「重试到上限才判失败」永远测不到——`update` 返回的 `attempts`
 * 必须反映这次 `{ increment: 1 }` 之后的值，否则那段逻辑在测试里根本不成立。
 */
function createPrismaMock(): PrismaMock {
  const job = { attempts: 0 }
  return {
    meetingTranscriptionJob: {
      findUnique: vi.fn(),
      findMany: vi.fn(async () => []),
      update: vi.fn(async (input: { data: Record<string, unknown> }) => {
        const increment = (input.data.attempts as { increment?: number } | undefined)?.increment
        if (increment) job.attempts += increment
        return { id: "job-1", ...input.data, attempts: job.attempts }
      }),
    },
    meetingRecording: { findMany: vi.fn(async () => []), update: vi.fn() },
    meetingTranscriptSegment: { deleteMany: vi.fn(), createMany: vi.fn() },
    meetingSpeaker: { upsert: vi.fn() },
    meeting: { update: vi.fn() },
    $transaction: vi.fn(),
  }
}

const config: MeetingConfig = {
  configured: true,
  secretId: "secret-id",
  secretKey: "secret-key",
  region: "ap-guangzhou",
  engineModelType: "16k_zh_en_meeting",
  hotwordList: "李杨,Synapse",
  transcriptionEnabled: true,
}

let prisma: PrismaMock
let storage: { createDownloadUrl: MockFn; deleteObject: MockFn; listStaleMultipartUploads: MockFn }
let service: MeetingTranscriptionService

function jobRow(overrides: Record<string, unknown> = {}) {
  return {
    id: "job-1",
    meetingId: "meeting-1",
    status: "pending",
    uploadId: null,
    attempts: 0,
    taskId: null,
    expiresAt: null,
    meeting: { recording: { status: "ready", storageKey: "meeting-recordings/rec-1" } },
    ...overrides,
  }
}

beforeEach(() => {
  prisma = createPrismaMock()
  prisma.$transaction.mockImplementation(async (callback: (tx: PrismaMock) => Promise<unknown>) => callback(prisma))
  storage = {
    createDownloadUrl: vi.fn(async () => "https://example.invalid/signed-audio"),
    deleteObject: vi.fn(async () => undefined),
    listStaleMultipartUploads: vi.fn(async () => []),
  }
  service = new MeetingTranscriptionService(
    prisma as unknown as PrismaService,
    storage as unknown as MeetingStoragePort,
    config,
  )
  createRecTaskMock.mockReset()
  describeTaskStatusMock.mockReset()
  createRecTaskMock.mockResolvedValue({ taskId: 987654321 })
})

describe("提交转写任务", () => {
  it("会议引擎的参数一个不差：单声道、URL 来源、说话人分离、词级时间戳", async () => {
    prisma.meetingTranscriptionJob.findUnique.mockResolvedValue(jobRow())
    await service.submit("meeting-1")

    expect(createRecTaskMock).toHaveBeenCalledTimes(1)
    const submitted = createRecTaskMock.mock.calls[0][0]
    expect(submitted).toMatchObject({
      engineModelType: "16k_zh_en_meeting",
      channelNum: 1,
      sourceType: 0,
      speakerDiarization: 1,
      speakerNumber: 0,
      resTextFormat: 1,
      url: "https://example.invalid/signed-audio",
    })
  })

  it("多声道会被引擎直接拒绝，所以 ChannelNum 只能是 1", async () => {
    // 这条是参数里最容易「顺手改成 2」的一项：传 2 不会降级，是直接失败。
    prisma.meetingTranscriptionJob.findUnique.mockResolvedValue(jobRow())
    await service.submit("meeting-1")
    expect(createRecTaskMock.mock.calls[0][0].channelNum).toBe(1)
    expect(createRecTaskMock.mock.calls[0][0].channelNum).not.toBe(2)
  })

  it("不传会议引擎用不了的增值参数", async () => {
    prisma.meetingTranscriptionJob.findUnique.mockResolvedValue(jobRow())
    await service.submit("meeting-1")
    const submitted = createRecTaskMock.mock.calls[0][0] as Record<string, unknown>
    // 语义分段与口语转书面语只支持通用引擎；声纹角色分离只支持另外两款引擎。
    expect(submitted).not.toHaveProperty("resTextFormat4")
    expect(submitted.speakerDiarization).toBe(1)
    expect(submitted.speakerDiarization).not.toBe(3)
    // 16k 引擎不支持指定人数，只能是 0（自动分离）。
    expect(submitted.speakerNumber).toBe(0)
  })

  it("提交成功后记下任务号、参数快照和 24 小时的有效期", async () => {
    prisma.meetingTranscriptionJob.findUnique.mockResolvedValue(jobRow())
    await service.submit("meeting-1")
    const update = prisma.meetingTranscriptionJob.update.mock.calls[0][0]
    expect(update.data).toMatchObject({ taskId: "987654321", status: "running" })
    expect(update.data.parameters).toMatchObject({ ChannelNum: 1, SourceType: 0, ResTextFormat: 1 })
    expect(update.data.expiresAt.getTime()).toBeGreaterThan(Date.now())
  })

  it("已经有任务号的不重复提交", async () => {
    prisma.meetingTranscriptionJob.findUnique.mockResolvedValue(jobRow({ status: "running", taskId: "1" }))
    await service.submit("meeting-1")
    expect(createRecTaskMock).not.toHaveBeenCalled()
  })

  it("录音已经删掉时不提交，并写明原因", async () => {
    prisma.meetingTranscriptionJob.findUnique.mockResolvedValue(jobRow({ meeting: { recording: null } }))
    await service.submit("meeting-1")
    expect(createRecTaskMock).not.toHaveBeenCalled()
    expect(prisma.meeting.update.mock.calls[0][0].data).toMatchObject({ status: "failed" })
  })

  it("提交失败先重试，不立刻判死", async () => {
    prisma.meetingTranscriptionJob.findUnique.mockResolvedValue(jobRow())
    createRecTaskMock.mockRejectedValue(new Error("网络抖动"))
    await service.submit("meeting-1")
    expect(prisma.meetingTranscriptionJob.update.mock.calls.at(-1)?.[0].data).toMatchObject({ status: "pending" })
    expect(prisma.meeting.update).not.toHaveBeenCalledWith(
      expect.objectContaining({ data: expect.objectContaining({ status: "failed" }) }),
    )
  })
})

describe("取结果", () => {
  const runningJob = { status: "running", taskId: "42", expiresAt: new Date(Date.now() + 60_000) }

  it("结果落库：逐字稿按段落存，说话人建映射记录", async () => {
    prisma.meetingTranscriptionJob.findUnique.mockResolvedValue(jobRow(runningJob))
    describeTaskStatusMock.mockResolvedValue({
      TaskId: 42,
      Status: 2,
      Result: JSON.stringify({
        ResultDetail: [
          { FinalSentence: "第一句", StartMs: 0, EndMs: 1000, SpeakerId: 0 },
          { FinalSentence: "第二句", StartMs: 1200, EndMs: 2000, SpeakerId: 1 },
        ],
      }),
    })
    await service.collectJob("job-1", "meeting-1", "42", runningJob.expiresAt)

    const created = prisma.meetingTranscriptSegment.createMany.mock.calls[0][0].data
    expect(created).toHaveLength(2)
    expect(created[0]).toMatchObject({ segmentIndex: 0, speakerId: 0, text: "第一句" })
    expect(prisma.meetingSpeaker.upsert).toHaveBeenCalledTimes(2)
    expect(prisma.meeting.update.mock.calls[0][0].data).toMatchObject({ status: "done", speakerCount: 2 })
  })

  it("重跑一次不会让同一段话出现两遍", async () => {
    prisma.meetingTranscriptionJob.findUnique.mockResolvedValue(jobRow(runningJob))
    describeTaskStatusMock.mockResolvedValue({
      TaskId: 42,
      Status: 2,
      Result: JSON.stringify({ ResultDetail: [{ FinalSentence: "第一句", StartMs: 0, EndMs: 1000, SpeakerId: 0 }] }),
    })
    await service.collectJob("job-1", "meeting-1", "42", runningJob.expiresAt)
    expect(prisma.meetingTranscriptSegment.deleteMany).toHaveBeenCalledWith({ where: { meetingId: "meeting-1" } })
  })

  it("还在跑就什么都不做，等下一轮", async () => {
    describeTaskStatusMock.mockResolvedValue({ TaskId: 42, Status: 1 })
    await service.collectJob("job-1", "meeting-1", "42", runningJob.expiresAt)
    expect(prisma.meeting.update).not.toHaveBeenCalled()
    expect(prisma.meetingTranscriptionJob.update).not.toHaveBeenCalled()
  })

  it("失败时把腾讯云给的原因落下来", async () => {
    prisma.meetingTranscriptionJob.findUnique.mockResolvedValue(jobRow(runningJob))
    describeTaskStatusMock.mockResolvedValue({ TaskId: 42, Status: 3, ErrorMsg: "音频格式不支持" })
    await service.collectJob("job-1", "meeting-1", "42", runningJob.expiresAt)
    expect(prisma.meetingTranscriptionJob.update.mock.calls[0][0].data.lastError).toContain("音频格式不支持")
  })

  it("超过 24 小时的任务不再去取，直接判超期", async () => {
    await service.collectJob("job-1", "meeting-1", "42", new Date(Date.now() - 1000))
    expect(describeTaskStatusMock).not.toHaveBeenCalled()
    expect(prisma.meetingTranscriptionJob.update.mock.calls[0][0].data.lastError).toContain("24 小时")
  })

  it("还没到上限时只是重排队，不判失败", async () => {
    prisma.meetingTranscriptionJob.findUnique.mockResolvedValue(jobRow(runningJob))
    describeTaskStatusMock.mockRejectedValue(new Error("抖了一下"))
    await service.collectJob("job-1", "meeting-1", "42", runningJob.expiresAt)
    expect(prisma.meetingTranscriptionJob.update.mock.calls.at(-1)?.[0].data).toMatchObject({
      status: "pending",
      taskId: null,
    })
    expect(prisma.meeting.update).not.toHaveBeenCalled()
  })

  it("重试次数用尽之后才真正判失败", async () => {
    prisma.meetingTranscriptionJob.findUnique.mockResolvedValue(jobRow(runningJob))
    describeTaskStatusMock.mockRejectedValue(new Error("一直失败"))
    // 连着失败到上限：最后一次必须落成 failed 并写清原因。
    for (let attempt = 0; attempt < 5; attempt += 1) {
      await service.collectJob("job-1", "meeting-1", "42", runningJob.expiresAt)
    }
    expect(prisma.meetingTranscriptionJob.update.mock.calls.at(-1)?.[0].data).toMatchObject({ status: "failed" })
    expect(prisma.meeting.update.mock.calls.at(-1)?.[0].data).toMatchObject({ status: "failed" })
    expect(prisma.meeting.update.mock.calls.at(-1)?.[0].data.failureReason).toContain("一直失败")
  })
})

describe("清理", () => {
  it("转写关掉之后既不提交也不轮询", async () => {
    const disabled = new MeetingTranscriptionService(
      prisma as unknown as PrismaService,
      storage as unknown as MeetingStoragePort,
      { ...config, transcriptionEnabled: false },
    )
    await disabled.poll()
    expect(prisma.meetingTranscriptionJob.findMany).not.toHaveBeenCalled()
  })

  it("会去扫超期未完成的分块上传", async () => {
    await service.cleanupStaleUploads()
    expect(storage.listStaleMultipartUploads).toHaveBeenCalled()
    expect(storage.listStaleMultipartUploads.mock.calls[0][0]).toBeGreaterThan(0)
  })

  it("删对象没删干净的录音会被重试", async () => {
    prisma.meetingRecording.findMany.mockResolvedValue([
      { id: "rec-1", storageKey: "meeting-recordings/rec-1" },
    ])
    await service.retryPendingRecordingDeletes()
    expect(storage.deleteObject).toHaveBeenCalledWith("meeting-recordings/rec-1")
    expect(prisma.meetingRecording.update.mock.calls[0][0].data).toMatchObject({ deletePending: false })
  })
})
