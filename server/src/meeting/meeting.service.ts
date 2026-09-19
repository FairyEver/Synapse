import {
  BadRequestException,
  Inject,
  Injectable,
  Logger,
  NotFoundException,
  PayloadTooLargeException,
} from "@nestjs/common"
import {
  compactMeetingPeaks,
  estimateMeetingTranscriptionMs,
  MEETING_DEFAULT_TITLE,
  MEETING_MAX_DURATION_MS,
  MEETING_MAX_UPLOAD_PARTS,
  MEETING_RECORDING_MIME_TYPE,
  MEETING_RECORDING_PATH_PREFIX,
  type MeetingDetailDto,
  type MeetingFinalizeInput,
  type MeetingMinutesDto,
  type MeetingRecordingDto,
  type MeetingSpeakerDto,
  type MeetingStatus,
  type MeetingSummaryDto,
  type MeetingTranscriptionProgressDto,
  type MeetingTranscriptSegmentDto,
  type MeetingTranscriptWordDto,
} from "@synapse/shared"
import { randomUUID } from "node:crypto"

import { PrismaService } from "../prisma/prisma.service"
import { MeetingTranscriptionService } from "./meeting-transcription.service"
import { MEETING_STORAGE_PORT, type MeetingStoragePort } from "./meeting-storage.service"

/**
 * 会议记录的业务层。
 *
 * 三件事在这里定死：
 * - 录音不进云盘，对象走平台媒体存储的独立前缀 `meeting-recordings/`；
 * - 分片必须按顺序到达，跳号直接拒绝——客户端在后台补传，乱序只会掩盖丢片；
 * - 「取消」和「删除」是两回事：取消要中止这次分块上传（丢弃分片），删除删的是已经
 *   合并好的对象。
 * - 「删除录音」和「删除整条」也是两回事：前者只把音频对象去掉、留下文字（历史数据
 *   里还有这种状态），后者连逐字稿、发言人和纪要一起删，两条清理路径都要覆盖。
 */

/** 5 小时 64 kbps 大约 144 MB，留出余量挡住异常客户端。 */
const MEETING_MAX_RECORDING_BYTES = 200 * 1024 * 1024

/** 回放地址只够打开一次播放器：它会被写进 audio 元素的 src，越短越好。 */
const MEETING_PLAYBACK_URL_TTL_SECONDS = 5 * 60

const UPLOAD_STATUS_PENDING = "pending"
const UPLOAD_STATUS_READY = "ready"
const UPLOAD_STATUS_UPLOADING = "uploading"

export function meetingRecordingStorageKey(recordingId: string): string {
  return `${MEETING_RECORDING_PATH_PREFIX}/${recordingId}`
}

/**
 * 一次开了头、还没收尾的录音。
 *
 * `receivedBytes` 只够估一个时长出来，它是给「本机残片已经不全」的那一端用的兜底。
 */
export type PendingMeetingRecording = {
  readonly meetingId: string
  readonly recordingId: string
  readonly title: string
  readonly receivedBytes: number
  readonly startedAt: string
}

type MeetingRow = {
  readonly id: string
  readonly title: string
  readonly startedAt: Date
  readonly durationMs: number
  readonly status: string
  readonly speakerCount: number
  readonly failureReason: string | null
  readonly minutesStatus: string
  readonly minutesJson: unknown
  readonly minutesFailureReason: string | null
  readonly minutesEditedAt: Date | null
  readonly createdAt: Date
}

type RecordingRow = {
  readonly status: string
  readonly mimeType: string
  readonly size: bigint
  readonly durationMs: number
  readonly deletedAt: Date | null
}

function toRecordingDto(recording: RecordingRow | null | undefined): MeetingRecordingDto {
  if (!recording) {
    return {
      status: "deleted",
      mimeType: MEETING_RECORDING_MIME_TYPE,
      size: 0,
      durationMs: 0,
      deletedAt: null,
    }
  }
  return {
    status: recording.status === UPLOAD_STATUS_READY || recording.status === UPLOAD_STATUS_UPLOADING ? "ready" : recording.status === "deleted" ? "deleted" : "pending",
    mimeType: recording.mimeType,
    size: Number(recording.size),
    durationMs: recording.durationMs,
    deletedAt: recording.deletedAt?.toISOString() ?? null,
  }
}

function toSummaryDto(meeting: MeetingRow, recording: RecordingRow | null | undefined): MeetingSummaryDto {
  return {
    id: meeting.id,
    title: meeting.title,
    startedAt: meeting.startedAt.toISOString(),
    durationMs: meeting.durationMs,
    speakerCount: meeting.speakerCount,
    status: normalizeMeetingStatus(meeting.status),
    recording: toRecordingDto(recording),
    minutesStatus: normalizeMinutesStatus(meeting.minutesStatus),
    createdAt: meeting.createdAt.toISOString(),
  }
}

function normalizeMeetingStatus(value: string): MeetingStatus {
  return value === "done" || value === "failed" ? value : "transcribing"
}

/**
 * 这一刻的转写进度。
 *
 * 腾讯云只给四个状态，没有百分比，所以「进度」只能是**已经等了多久**比上一个估算出来的
 * 总时长。时钟从 `submittedAt` 起算而不是从录音结束起算：排队等着被投出去的那几十秒不
 * 该算进识别时间里。响应里带的是服务端此刻的已用时长，客户端在两次刷新之间接着它自己
 * 往下走——两端时钟不齐的时候也不会算岔。
 */
function toTranscriptionProgressDto(
  job: { readonly status: string; readonly taskId: string | null; readonly submittedAt: Date | null } | null,
  durationMs: number,
): MeetingTranscriptionProgressDto {
  const running = job?.status === "running" && !!job.taskId
  return {
    stage: running ? "running" : "queued",
    elapsedMs: running && job?.submittedAt ? Math.max(0, Date.now() - job.submittedAt.getTime()) : 0,
    expectedMs: estimateMeetingTranscriptionMs(durationMs),
  }
}

function normalizeMinutesStatus(value: string) {
  if (value === "generating" || value === "ready" || value === "failed") return value
  return "none" as const
}

function toMinutesDto(meeting: MeetingRow): MeetingMinutesDto | null {
  const raw = meeting.minutesJson
  if (!raw || typeof raw !== "object") return null
  const value = raw as { topics?: unknown; conclusions?: unknown; todos?: unknown }
  const asStrings = (input: unknown): string[] =>
    Array.isArray(input) ? input.filter((item): item is string => typeof item === "string") : []
  const todos = Array.isArray(value.todos)
    ? value.todos
        .filter((item): item is Record<string, unknown> => !!item && typeof item === "object")
        .map((item) => ({
          id: typeof item.id === "string" ? item.id : randomUUID(),
          text: typeof item.text === "string" ? item.text : "",
          owner: typeof item.owner === "string" ? item.owner : null,
          due: typeof item.due === "string" ? item.due : null,
          done: item.done === true,
        }))
        .filter((item) => item.text.length > 0)
    : []
  return {
    topics: asStrings(value.topics),
    conclusions: asStrings(value.conclusions),
    todos,
    editedAt: meeting.minutesEditedAt?.toISOString() ?? null,
  }
}

@Injectable()
export class MeetingService {
  private readonly logger = new Logger(MeetingService.name)

  constructor(
    private readonly prisma: PrismaService,
    @Inject(MEETING_STORAGE_PORT) private readonly storage: MeetingStoragePort,
    private readonly transcription: MeetingTranscriptionService,
  ) {}

  async list(userId: string): Promise<{ readonly items: readonly MeetingSummaryDto[] }> {
    const meetings = await this.prisma.meeting.findMany({
      where: { userId },
      orderBy: { startedAt: "desc" },
      take: 200,
      include: { recording: true },
    })
    return {
      items: meetings.map((meeting) => toSummaryDto(meeting as MeetingRow, meeting.recording as RecordingRow | null)),
    }
  }

  async get(userId: string, meetingId: string): Promise<MeetingDetailDto> {
    const meeting = await this.requireMeeting(userId, meetingId)
    const [recording, speakers, segments, job] = await Promise.all([
      this.prisma.meetingRecording.findUnique({ where: { meetingId } }),
      this.prisma.meetingSpeaker.findMany({ where: { meetingId }, orderBy: { speakerId: "asc" } }),
      this.prisma.meetingTranscriptSegment.findMany({ where: { meetingId }, orderBy: { segmentIndex: "asc" } }),
      this.prisma.meetingTranscriptionJob.findUnique({
        where: { meetingId },
        select: { status: true, taskId: true, submittedAt: true },
      }),
    ])
    const speakerDtos: MeetingSpeakerDto[] = speakers.map((speaker) => ({
      speakerId: speaker.speakerId,
      name: speaker.name,
    }))
    const segmentDtos: MeetingTranscriptSegmentDto[] = segments.map((segment) => ({
      id: segment.id,
      speakerId: segment.speakerId,
      startMs: segment.startMs,
      endMs: segment.endMs,
      text: segment.text,
      words: Array.isArray(segment.words) ? (segment.words as MeetingTranscriptWordDto[]) : [],
    }))
    return {
      ...toSummaryDto(meeting as MeetingRow, recording as RecordingRow | null),
      failureReason: meeting.failureReason,
      speakers: speakerDtos,
      segments: segmentDtos,
      minutes: toMinutesDto(meeting as MeetingRow),
      minutesFailureReason: meeting.minutesFailureReason,
      transcription: toTranscriptionProgressDto(job, meeting.durationMs),
    }
  }

  /**
   * 开始一次录音。
   *
   * 先把三张表建好再开启分块上传：任务记录必须在服务端，客户端退出、电脑合上都不
   * 影响它；反过来，先开上传再建表会在中途失败时留下一个没人认领的 uploadId。
   */
  async startRecording(
    userId: string,
    input: { readonly title?: string; readonly startedAt?: string },
  ): Promise<{ readonly meetingId: string; readonly recordingId: string; readonly uploadId: string; readonly title: string }> {
    const startedAt = input.startedAt ? new Date(input.startedAt) : new Date()
    if (Number.isNaN(startedAt.getTime())) throw new BadRequestException("录音开始时间无效。")
    const title = input.title?.trim() || MEETING_DEFAULT_TITLE

    const { meeting, recording } = await this.prisma.$transaction(async (tx) => {
      const created = await tx.meeting.create({
        data: { userId, title, startedAt, status: "transcribing" },
      })
      const createdRecording = await tx.meetingRecording.create({
        // 对象路径由 recordingId 派生，而 id 要等这一行插进去才存在，所以在事务里先
        // 用一个临时键占位、下一句立刻换成正式键。占位值不会离开这个事务。
        data: { meetingId: created.id, storageKey: `${MEETING_RECORDING_PATH_PREFIX}/${randomUUID()}`, status: UPLOAD_STATUS_PENDING },
      })
      const updated = await tx.meetingRecording.update({
        where: { id: createdRecording.id },
        data: { storageKey: meetingRecordingStorageKey(createdRecording.id) },
      })
      await tx.meetingTranscriptionJob.create({
        data: {
          meetingId: created.id,
          storageKey: updated.storageKey,
          status: "pending",
        },
      })
      return { meeting: created, recording: updated }
    })

    let uploadId: string
    try {
      uploadId = await this.storage.initMultipartUpload(recording.storageKey, MEETING_RECORDING_MIME_TYPE)
    } catch (error) {
      // 开不了上传就没法录音，把刚建的行收干净，不要留一个永远不会有音频的会议。
      await this.prisma.meeting.delete({ where: { id: meeting.id } }).catch(() => undefined)
      throw error
    }
    await this.prisma.meetingTranscriptionJob.update({
      where: { meetingId: meeting.id },
      data: { uploadId, status: "pending" },
    })

    return { meetingId: meeting.id, recordingId: recording.id, uploadId, title }
  }

  /**
   * 接收一个分片。
   *
   * 顺序是强约束：`received + 1` 之前的分片可以重传（网络抖动导致的重复），跳过号
   * 的一律拒绝——放过去会拼出一个中间缺一段的音频，而且不会有任何地方报错。
   */
  async acceptPart(
    userId: string,
    recordingId: string,
    partNumber: number,
    body: Buffer,
  ): Promise<{ readonly receivedParts: number; readonly receivedBytes: number }> {
    if (!Number.isInteger(partNumber) || partNumber < 1 || partNumber > MEETING_MAX_UPLOAD_PARTS) {
      throw new BadRequestException("分片编号无效。")
    }
    if (body.byteLength === 0) throw new BadRequestException("分片内容为空。")

    const recording = await this.requireRecording(userId, recordingId)
    const job = await this.prisma.meetingTranscriptionJob.findUnique({ where: { meetingId: recording.meetingId } })
    if (!job?.uploadId) throw new BadRequestException("这次录音没有可用的上传。")
    const parts = await this.prisma.meetingUploadPart.findMany({
      where: { jobId: job.id },
      orderBy: { partNumber: "asc" },
    })
    const highest = parts.at(-1)?.partNumber ?? 0
    if (partNumber > highest + 1) {
      throw new BadRequestException("分片顺序不正确。")
    }
    const existing = parts.find((part) => part.partNumber === partNumber)
    const totalBytes = Number(job.totalBytes) - (existing?.size ?? 0) + body.byteLength
    if (totalBytes > MEETING_MAX_RECORDING_BYTES) {
      throw new PayloadTooLargeException("录音已超过单条上限。")
    }

    const etag = await this.storage.uploadPart({
      key: recording.storageKey,
      uploadId: job.uploadId,
      partNumber,
      body,
    })

    const receivedBytes = await this.prisma.$transaction(async (tx) => {
      await tx.meetingUploadPart.upsert({
        where: { jobId_partNumber: { jobId: job.id, partNumber } },
        create: { jobId: job.id, partNumber, etag, size: body.byteLength },
        update: { etag, size: body.byteLength },
      })
      const updated = await tx.meetingTranscriptionJob.update({
        where: { id: job.id },
        data: { totalBytes: BigInt(totalBytes), lastError: null },
      })
      await tx.meetingRecording.update({
        where: { id: recording.id },
        data: { status: UPLOAD_STATUS_UPLOADING, size: BigInt(totalBytes) },
      })
      return Number(updated.totalBytes)
    })

    const receivedParts = await this.prisma.meetingUploadPart.count({ where: { jobId: job.id } })
    return { receivedParts, receivedBytes }
  }

  /** 上一次没收尾的录音。没有就返回 null，不报错。 */
  async findPendingRecording(userId: string): Promise<PendingMeetingRecording | null> {
    const [first] = await this.pendingRecordings(userId)
    return first ?? null
  }

  /**
   * 所有还没收尾的录音。
   *
   * 一台设备只该收**自己录的那条**，所以它得先看得见全部，再按本机还留着的残片挑出
   * 自己那条。只给最新一条的话，只要另一台设备录的那条更新，本机就永远看不到自己那
   * 条——自己那条反而没人收尾。以前只有桌面端一个主体，这件事显不出来；手机端一上线
   * 就有了两个。
   */
  async findPendingRecordings(userId: string): Promise<readonly PendingMeetingRecording[]> {
    return this.pendingRecordings(userId)
  }

  private async pendingRecordings(userId: string): Promise<PendingMeetingRecording[]> {
    const jobs = await this.prisma.meetingTranscriptionJob.findMany({
      where: { status: "pending", uploadId: { not: null }, meeting: { userId } },
      orderBy: { updatedAt: "desc" },
      include: { meeting: { include: { recording: true } } },
    })
    const pending: PendingMeetingRecording[] = []
    for (const job of jobs) {
      const recording = job.meeting.recording
      // 已经合并好的（ready）和已经删掉的都不算没收尾。
      if (!recording || recording.status === UPLOAD_STATUS_READY || recording.status === "deleted") continue
      pending.push({
        meetingId: job.meetingId,
        recordingId: recording.id,
        title: job.meeting.title,
        receivedBytes: Number(job.totalBytes),
        startedAt: job.meeting.startedAt.toISOString(),
      })
    }
    return pending
  }

  /**
   * 完成录音：补齐尾片已经在上传阶段做完了，这里只合并、校验、交给转写。
   *
   * 转写提交失败不算这次调用失败——音频已经完整落库，任务表留着记录由定时任务重试。
   * 用户点「完成」要立刻回到列表，不能卡在一个外部接口上。
   */
  async completeRecording(
    userId: string,
    recordingId: string,
    input: MeetingFinalizeInput,
  ): Promise<{ readonly meetingId: string; readonly status: MeetingStatus }> {
    const recording = await this.requireRecording(userId, recordingId)
    if (recording.status === UPLOAD_STATUS_READY) {
      const meeting = await this.prisma.meeting.findUniqueOrThrow({ where: { id: recording.meetingId } })
      return { meetingId: meeting.id, status: normalizeMeetingStatus(meeting.status) }
    }
    const job = await this.prisma.meetingTranscriptionJob.findUnique({ where: { meetingId: recording.meetingId } })
    if (!job?.uploadId) throw new BadRequestException("这次录音没有可用的上传。")
    const parts = await this.prisma.meetingUploadPart.findMany({
      where: { jobId: job.id },
      orderBy: { partNumber: "asc" },
    })
    if (parts.length === 0) throw new BadRequestException("这段录音里没有内容。")

    const durationMs = Math.max(0, Math.min(MEETING_MAX_DURATION_MS, Math.round(input.durationMs)))
    const completed = await this.storage.completeMultipartUpload({
      key: recording.storageKey,
      uploadId: job.uploadId,
      parts: parts.map((part) => ({ partNumber: part.partNumber, etag: part.etag })),
    })
    const expectedBytes = parts.reduce((total, part) => total + part.size, 0)
    if (Number(completed.size) !== expectedBytes) {
      throw new BadRequestException("音频合并后的大小与分片之和不一致。")
    }

    const peaks = compactMeetingPeaks(input.peaks)
    await this.prisma.$transaction([
      this.prisma.meetingRecording.update({
        where: { id: recording.id },
        data: {
          status: UPLOAD_STATUS_READY,
          size: completed.size,
          durationMs,
          peaks,
        },
      }),
      this.prisma.meeting.update({
        where: { id: recording.meetingId },
        data: { durationMs, speakerCount: Math.max(0, Math.round(input.speakerCount ?? 0)), status: "transcribing", failureReason: null },
      }),
      this.prisma.meetingTranscriptionJob.update({
        where: { id: job.id },
        data: { uploadId: null, status: "pending", attempts: 0, lastError: null },
      }),
    ])

    try {
      await this.transcription.submit(recording.meetingId)
    } catch (error) {
      // 音频已经在对象存储里了，提交失败只是晚一点开始，不是这次录音失败。
      this.logger.warn(
        { meetingId: recording.meetingId, errorMessage: error instanceof Error ? error.message : String(error) },
        "Meeting transcription submission failed; leaving the job for the scheduler",
      )
    }

    return { meetingId: recording.meetingId, status: "transcribing" }
  }

  /**
   * 取消录音：**中止**分块上传，丢弃已经传上去的分片。
   *
   * 不能拿删对象顶替：未完成的分块上传留在桶里的分片，`deleteObject` 删不掉，会一直
   * 按量计费。这也是整个功能里最容易漏的一步。
   */
  async cancelRecording(userId: string, recordingId: string): Promise<void> {
    const recording = await this.requireRecording(userId, recordingId)
    const job = await this.prisma.meetingTranscriptionJob.findUnique({ where: { meetingId: recording.meetingId } })
    if (job?.uploadId) {
      await this.storage.abortMultipartUpload({ key: recording.storageKey, uploadId: job.uploadId })
    }
    await this.prisma.meeting.delete({ where: { id: recording.meetingId } })
  }

  async rename(userId: string, meetingId: string, title: string): Promise<void> {
    await this.requireMeeting(userId, meetingId)
    const trimmed = title.trim()
    if (!trimmed) throw new BadRequestException("名称不能为空。")
    await this.prisma.meeting.update({ where: { id: meetingId }, data: { title: trimmed.slice(0, 255) } })
  }

  /**
   * 删除录音。对象真的删掉，逐字稿和纪要留着——用户看得见「已删除」确实生效，但
   * 文字成果不会跟着一起消失。
   */
  async deleteRecording(userId: string, meetingId: string): Promise<void> {
    const meeting = await this.requireMeeting(userId, meetingId)
    const recording = await this.prisma.meetingRecording.findUnique({ where: { meetingId } })
    if (!recording || recording.status === "deleted") return
    try {
      await this.storage.deleteObject(recording.storageKey)
      await this.prisma.meetingRecording.update({
        where: { id: recording.id },
        data: { status: "deleted", deletedAt: new Date(), deletePending: false, size: BigInt(0), peaks: null },
      })
    } catch (error) {
      // 删不掉就记下来，由定时任务重试；对用户来说这一次已经标记成删除了。
      this.logger.warn(
        { meetingId: meeting.id, errorMessage: error instanceof Error ? error.message : String(error) },
        "Meeting recording object deletion failed; scheduling a retry",
      )
      await this.prisma.meetingRecording.update({
        where: { id: recording.id },
        data: { status: "deleted", deletedAt: new Date(), deletePending: true, peaks: null },
      })
    }
  }

  /**
   * 删除整条录音：音频对象、逐字稿、发言人和纪要一起删掉。
   *
   * 两条清理路径都要覆盖，只做一条会留下一样东西：录音还没传完的走**中止分块上传**
   * （删对象删不掉桶里的碎片，那些碎片会一直按量计费），已经传完的走**删对象**。只
   * 抄 `cancelRecording` 那条会漏掉后一半，在桶里留一个没人认领的孤儿对象。
   *
   * 清理失败不让这次删除失败：对用户来说删了就是删了，不能卡在一条删不掉的记录上。
   * 失败只记警告（含对象键，便于人工兜底）——这一行随后就没了，没有地方留重试标记。
   *
   * 腾讯云侧不用管：ASR 没有删除任务的接口，任务记录靠 `expiresAt` 自然过期。
   *
   * 幂等：不存在、或者不是自己的，一律当作已经删掉，返回成功。
   */
  async deleteMeeting(userId: string, meetingId: string): Promise<void> {
    const meeting = await this.prisma.meeting.findFirst({ where: { id: meetingId, userId } })
    if (!meeting) return
    const [recording, job] = await Promise.all([
      this.prisma.meetingRecording.findUnique({ where: { meetingId } }),
      this.prisma.meetingTranscriptionJob.findUnique({ where: { meetingId } }),
    ])

    if (recording && job?.uploadId) {
      try {
        await this.storage.abortMultipartUpload({ key: recording.storageKey, uploadId: job.uploadId })
      } catch (error) {
        this.logger.warn(
          {
            meetingId,
            storageKey: recording.storageKey,
            errorMessage: error instanceof Error ? error.message : String(error),
          },
          "Meeting multipart abort failed during deletion",
        )
      }
    }

    // 已经删过一次、而且上次删成功了的不用再删；上次没删掉的（deletePending）要补一次，
    // 否则这一行随会议一起消失之后，那条重试记录也没了。
    if (recording && (recording.status !== "deleted" || recording.deletePending)) {
      try {
        await this.storage.deleteObject(recording.storageKey)
      } catch (error) {
        this.logger.warn(
          {
            meetingId,
            storageKey: recording.storageKey,
            errorMessage: error instanceof Error ? error.message : String(error),
          },
          "Meeting recording object deletion failed during deletion",
        )
      }
    }

    await this.prisma.meeting.delete({ where: { id: meetingId } })
  }

  /** 重试转写不需要重新上传：音频一直在，换一个任务号重新提交。 */
  async retryTranscription(userId: string, meetingId: string): Promise<void> {
    const meeting = await this.requireMeeting(userId, meetingId)
    const recording = await this.prisma.meetingRecording.findUnique({ where: { meetingId } })
    if (!recording || recording.status !== UPLOAD_STATUS_READY) {
      throw new BadRequestException("这段录音已经没有了，无法重新转写。")
    }
    await this.prisma.meetingTranscriptionJob.update({
      where: { meetingId },
      data: { status: "pending", taskId: null, attempts: 0, lastError: null, submittedAt: null, completedAt: null },
    })
    await this.prisma.meeting.update({
      where: { id: meeting.id },
      data: { status: "transcribing", failureReason: null },
    })
    await this.prisma.meetingTranscriptSegment.deleteMany({ where: { meetingId } })
    try {
      await this.transcription.submit(meetingId)
    } catch (error) {
      this.logger.warn(
        { meetingId, errorMessage: error instanceof Error ? error.message : String(error) },
        "Meeting transcription retry submission failed; leaving the job for the scheduler",
      )
    }
  }

  /**
   * 回放地址。
   *
   * 录音还在才给地址；删掉之后播放区显示「录音已删除」，而不是一个点不动的按钮。
   * 地址是短时效的签名地址，不进任何会被缓存或转发的字段。
   */
  async createPlaybackUrl(userId: string, meetingId: string): Promise<{ readonly url: string | null }> {
    await this.requireMeeting(userId, meetingId)
    const recording = await this.prisma.meetingRecording.findUnique({ where: { meetingId } })
    if (!recording || recording.status !== UPLOAD_STATUS_READY) return { url: null }
    return { url: await this.storage.createDownloadUrl(recording.storageKey, MEETING_PLAYBACK_URL_TTL_SECONDS) }
  }

  /** 回放波形的振幅，与详情分两次取：一次十几 KB，不该塞进每次打开详情都要拉的载荷里。 */
  async readPeaks(userId: string, meetingId: string): Promise<{ readonly peaks: string | null }> {
    await this.requireMeeting(userId, meetingId)
    const recording = await this.prisma.meetingRecording.findUnique({ where: { meetingId } })
    if (!recording || recording.status !== UPLOAD_STATUS_READY) return { peaks: null }
    return { peaks: recording.peaks ?? null }
  }

  private async requireMeeting(userId: string, meetingId: string) {
    const meeting = await this.prisma.meeting.findFirst({ where: { id: meetingId, userId } })
    if (!meeting) throw new NotFoundException("会议不存在。")
    return meeting
  }

  private async requireRecording(userId: string, recordingId: string) {
    const recording = await this.prisma.meetingRecording.findFirst({
      where: { id: recordingId, meeting: { userId } },
    })
    if (!recording) throw new NotFoundException("录音不存在。")
    if (recording.status === "deleted") throw new BadRequestException("这段录音已经删除了。")
    return recording
  }
}
