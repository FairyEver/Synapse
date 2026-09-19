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
  meeting: { update: MockFn; findUnique: MockFn }
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
    meeting: { update: vi.fn(), findUnique: vi.fn(async () => ({ userId: "user-1", title: "Q3 评审" })) },
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

  /**
   * 「投得出去」和「这段音频没问题」是两件事。同一份坏音频每次都能投成功、每次都被引擎
   * 判失败，所以成功的投递里**不能**重置 `attempts`——重置了重试上限就永远到不了，任务
   * 会在「投出去 → 失败 → 退回队列」之间一分钟转一圈，用户既等不到结果也等不到失败。
   * 计数只由用户手动重试和一条新录音清零。
   */
  it("重新投递不会把重试计数清零", async () => {
    prisma.meetingTranscriptionJob.findUnique.mockResolvedValue(jobRow())
    await service.submit("meeting-1")
    const update = prisma.meetingTranscriptionJob.update.mock.calls[0][0]
    expect(update.data).not.toHaveProperty("attempts")
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
    // 用真实返回的形状：结构化结果在 `detail` 里，`result` 是没有时间戳的整段文本。
    describeTaskStatusMock.mockResolvedValue({
      taskId: 42,
      status: 2,
      statusText: "success",
      result: "第一句\n第二句",
      detail: [
        { FinalSentence: "第一句", StartMs: 0, EndMs: 1000, SpeakerId: 0 },
        { FinalSentence: "第二句", StartMs: 1200, EndMs: 2000, SpeakerId: 1 },
      ],
      errorMessage: null,
      audioDuration: 2,
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
      taskId: 42,
      status: 2,
      statusText: "success",
      result: null,
      detail: [{ FinalSentence: "第一句", StartMs: 0, EndMs: 1000, SpeakerId: 0 }],
      errorMessage: null,
      audioDuration: 1,
    })
    await service.collectJob("job-1", "meeting-1", "42", runningJob.expiresAt)
    expect(prisma.meetingTranscriptSegment.deleteMany).toHaveBeenCalledWith({ where: { meetingId: "meeting-1" } })
  })

  it("还在跑就什么都不做，等下一轮", async () => {
    describeTaskStatusMock.mockResolvedValue({ taskId: 42, status: 1, statusText: "doing", result: null, detail: null, errorMessage: null, audioDuration: null })
    await service.collectJob("job-1", "meeting-1", "42", runningJob.expiresAt)
    expect(prisma.meeting.update).not.toHaveBeenCalled()
    expect(prisma.meetingTranscriptionJob.update).not.toHaveBeenCalled()
  })

  it("失败时把腾讯云给的原因落下来", async () => {
    prisma.meetingTranscriptionJob.findUnique.mockResolvedValue(jobRow(runningJob))
    describeTaskStatusMock.mockResolvedValue({ taskId: 42, status: 3, statusText: "failed", result: null, detail: null, errorMessage: "音频格式不支持", audioDuration: null })
    await service.collectJob("job-1", "meeting-1", "42", runningJob.expiresAt)
    expect(prisma.meetingTranscriptionJob.update.mock.calls[0][0].data.lastError).toContain("音频格式不支持")
  })

  /**
   * 引擎给 `Status=3` 是终局：它已经真的跑过这段音频并拒绝了它，换一个任务号重新提交同一
   * 份字节结果只会一模一样。所以这里一次就判失败——用户要的是尽快看到失败和「重试」按钮，
   * 而不是再等五分钟的自动重试。退回队列是投递阶段那类抖动才该走的（见上一条）。
   */
  it("引擎真的判失败就当场收尾，不退回队列重排", async () => {
    prisma.meetingTranscriptionJob.findUnique.mockResolvedValue(jobRow(runningJob))
    describeTaskStatusMock.mockResolvedValue({ taskId: 42, status: 3, statusText: "failed", result: null, detail: null, errorMessage: "Invalid audio file!", audioDuration: null })
    await service.collectJob("job-1", "meeting-1", "42", runningJob.expiresAt)

    const jobUpdate = prisma.meetingTranscriptionJob.update.mock.calls.at(-1)?.[0].data
    expect(jobUpdate).toMatchObject({ status: "failed", lastError: "Invalid audio file!" })
    expect(prisma.meeting.update.mock.calls.at(-1)?.[0].data).toMatchObject({
      status: "failed",
      failureReason: "Invalid audio file!",
    })
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

describe("收尾通知", () => {
  const runningJob = { status: "running", taskId: "42", expiresAt: new Date(Date.now() + 60_000) }

  function withNotifications() {
    const broadcastToUser = vi.fn(() => ({ onlineClientCount: 1, sentClientCount: 1, failedClientCount: 0, clientResults: [] }))
    const sendMeetingTranscription = vi.fn(async () => ({ sent: 1, failed: 0, skipped: false }))
    const notifying = new MeetingTranscriptionService(
      prisma as unknown as PrismaService,
      storage as unknown as MeetingStoragePort,
      config,
      { broadcastToUser } as never,
      { sendMeetingTranscription } as never,
    )
    return { notifying, broadcastToUser, sendMeetingTranscription }
  }

  it("转写成功时同时告诉桌面端和手机", async () => {
    prisma.meetingTranscriptionJob.findUnique.mockResolvedValue(jobRow(runningJob))
    describeTaskStatusMock.mockResolvedValue({
      taskId: 42,
      status: 2,
      statusText: "success",
      result: null,
      detail: [{ FinalSentence: "第一句", StartMs: 0, EndMs: 1000, SpeakerId: 0 }],
      errorMessage: null,
      audioDuration: 1,
    })
    const { notifying, broadcastToUser, sendMeetingTranscription } = withNotifications()
    await notifying.collectJob("job-1", "meeting-1", "42", runningJob.expiresAt)

    expect(broadcastToUser).toHaveBeenCalledWith("user-1", expect.objectContaining({
      type: "meeting.transcription.completed",
      payload: expect.objectContaining({ meetingId: "meeting-1", status: "done" }),
    }))
    expect(sendMeetingTranscription).toHaveBeenCalledWith("user-1", expect.objectContaining({ meetingId: "meeting-1" }))
  })

  it("桌面端在线也照样推手机——手机是另一台设备", async () => {
    // 会议多半是在电脑上录的，等转写完人已经离开电脑了；只因为桌面端在线就不推，
    // 手机侧永远收不到。
    prisma.meetingTranscriptionJob.findUnique.mockResolvedValue(jobRow(runningJob))
    describeTaskStatusMock.mockResolvedValue({ taskId: 42, status: 2, statusText: "success", result: null, detail: [], errorMessage: null, audioDuration: null })
    const { notifying, sendMeetingTranscription } = withNotifications()
    await notifying.collectJob("job-1", "meeting-1", "42", runningJob.expiresAt)
    expect(sendMeetingTranscription).toHaveBeenCalledTimes(1)
  })

  it("通知通道挂掉不影响转写结果落库", async () => {
    prisma.meetingTranscriptionJob.findUnique.mockResolvedValue(jobRow(runningJob))
    describeTaskStatusMock.mockResolvedValue({
      taskId: 42,
      status: 2,
      statusText: "success",
      result: null,
      detail: [{ FinalSentence: "第一句", StartMs: 0, EndMs: 1000, SpeakerId: 0 }],
      errorMessage: null,
      audioDuration: 1,
    })
    const notifying = new MeetingTranscriptionService(
      prisma as unknown as PrismaService,
      storage as unknown as MeetingStoragePort,
      config,
      { broadcastToUser: () => { throw new Error("socket 挂了") } } as never,
      { sendMeetingTranscription: async () => { throw new Error("APNs 挂了") } } as never,
    )
    await expect(notifying.collectJob("job-1", "meeting-1", "42", runningJob.expiresAt)).resolves.toBeUndefined()
    expect(prisma.meeting.update.mock.calls[0][0].data).toMatchObject({ status: "done" })
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
