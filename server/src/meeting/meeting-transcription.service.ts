import { Inject, Injectable, Logger, NotFoundException, Optional } from "@nestjs/common"
import { Cron } from "@nestjs/schedule"
import {
  createLiveEnvelope,
  LIVE_MESSAGE_TYPES,
  MEETING_ASR_URL_TTL_SECONDS,
  MEETING_TENCENT_TASK_STATUS,
  MEETING_TRANSCRIPTION_MAX_ATTEMPTS,
  MEETING_TRANSCRIPTION_TTL_MS,
  MeetingTranscriptionCompletedPayload,
} from "@synapse/shared"

import { LiveDesktopGateway } from "../live/live-desktop.gateway"
import { MobilePushService } from "../mobile-live/mobile-push.service"
import { PrismaService } from "../prisma/prisma.service"
import { meetingConfigToken, type MeetingConfig } from "./meeting.config"
import { MEETING_STORAGE_PORT, type MeetingStoragePort } from "./meeting-storage.service"
import { parseTencentTranscript } from "./meeting-transcript-parser"
import { createRecTask, describeTaskStatus, type TencentAsrCredentials } from "./tencent-asr"

/**
 * 转写任务的提交与取结果。
 *
 * 走异步接口（`CreateRecTask`）而不是实时流：只有异步这一条路能让用户提交完就合上
 * 电脑——任务在服务端，结果 24 小时内随时来取。代价是必须自己轮询，所以任务表就是
 * 队列，`@Cron` 消费它，重启不丢。
 *
 * 参数一个都不能省，而且有几项是**不能传**的（见 `submit`）。
 */

/** 每次轮询处理的任务上限，防止一次拉起太多并发。 */
const POLL_BATCH_SIZE = 50

/** 超过这个时间还没收尾的分块上传视为废弃，中止掉。 */
const STALE_UPLOAD_MS = 24 * 60 * 60 * 1000

const JOB_STATUS_PENDING = "pending"
const JOB_STATUS_RUNNING = "running"
const JOB_STATUS_SUCCEEDED = "succeeded"
const JOB_STATUS_FAILED = "failed"

@Injectable()
export class MeetingTranscriptionService {
  private readonly logger = new Logger(MeetingTranscriptionService.name)

  constructor(
    private readonly prisma: PrismaService,
    @Inject(MEETING_STORAGE_PORT) private readonly storage: MeetingStoragePort,
    @Inject(meetingConfigToken) private readonly config: MeetingConfig,
    // 通知是锦上添花：推送通道不可用时转写照样要成功，所以两个都是可选的。
    @Optional() private readonly liveDesktopGateway?: LiveDesktopGateway,
    @Optional() private readonly mobilePush?: MobilePushService,
  ) {}

  /**
   * 提交一次转写。
   *
   * 参数快照：`ChannelNum=1` 是硬要求（16k 音频只接受单声道，传 2 会被直接拒绝）；
   * `SourceType=0` 走 URL（base64 通道上限只有 5 MB，装不下会议）；`ResTextFormat=1`
   * 才有词级时间戳。**不要**传 `ResTextFormat=4/5`（语义分段、口语转书面语只支持通用
   * 引擎）和 `SpeakerDiarization=3`（声纹角色分离只支持另两款引擎）；
   * `SpeakerNumber` 只能是 0，16k 引擎不支持指定人数。
   */
  async submit(meetingId: string): Promise<void> {
    const job = await this.prisma.meetingTranscriptionJob.findUnique({
      where: { meetingId },
      include: { meeting: { include: { recording: true } } },
    })
    if (!job) throw new NotFoundException("转写任务不存在。")
    if (job.status === JOB_STATUS_SUCCEEDED || job.status === JOB_STATUS_RUNNING) return

    const credentials = this.credentials()
    if (!credentials) {
      await this.failJob(job.id, meetingId, "语音识别未配置，暂时无法转写。")
      return
    }
    const recording = job.meeting.recording
    if (!recording || recording.status !== "ready") {
      await this.failJob(job.id, meetingId, "这段录音已经没有了，无法转写。")
      return
    }

    try {
      const url = await this.storage.createDownloadUrl(recording.storageKey, MEETING_ASR_URL_TTL_SECONDS)
      const parameters = {
        EngineModelType: this.config.engineModelType,
        ChannelNum: 1,
        SourceType: 0,
        SpeakerDiarization: 1,
        SpeakerNumber: 0,
        ResTextFormat: 1,
        FilterDirty: 1,
        FilterModal: 1,
        ConvertNumMode: 1,
        HotwordList: this.config.hotwordList ?? null,
      }
      const result = await createRecTask(
        {
          engineModelType: parameters.EngineModelType,
          channelNum: parameters.ChannelNum,
          resTextFormat: parameters.ResTextFormat,
          sourceType: parameters.SourceType,
          url,
          speakerDiarization: parameters.SpeakerDiarization,
          speakerNumber: parameters.SpeakerNumber,
          filterDirty: parameters.FilterDirty,
          filterModal: parameters.FilterModal,
          convertNumMode: parameters.ConvertNumMode,
          hotwordList: this.config.hotwordList,
        },
        credentials,
      )
      await this.prisma.meetingTranscriptionJob.update({
        where: { id: job.id },
        data: {
          taskId: String(result.taskId),
          status: JOB_STATUS_RUNNING,
          parameters,
          submittedAt: new Date(),
          // 任务号 24 小时后失效，过了这个点再取也取不回来，不如早点让用户看到失败。
          expiresAt: new Date(Date.now() + MEETING_TRANSCRIPTION_TTL_MS),
          attempts: 0,
          lastError: null,
        },
      })
      await this.prisma.meeting.update({ where: { id: meetingId }, data: { status: "transcribing", failureReason: null } })
    } catch (error) {
      await this.recordAttemptFailure(job.id, meetingId, error)
    }
  }

  /**
   * 轮询取结果。
   *
   * 主用路径是轮询而不是回调：回调要求服务端有公网地址，而且丢一次就没有兜底，而
   * 结果只在腾讯云那边留 24 小时。
   */
  @Cron("*/1 * * * *")
  async poll(): Promise<void> {
    if (!this.config.transcriptionEnabled) return
    try {
      const pending = await this.prisma.meetingTranscriptionJob.findMany({
        where: { status: JOB_STATUS_PENDING },
        orderBy: { updatedAt: "asc" },
        take: POLL_BATCH_SIZE,
        select: { meetingId: true },
      })
      for (const job of pending) await this.submit(job.meetingId)

      const running = await this.prisma.meetingTranscriptionJob.findMany({
        where: { status: JOB_STATUS_RUNNING, taskId: { not: null } },
        orderBy: { updatedAt: "asc" },
        take: POLL_BATCH_SIZE,
      })
      for (const job of running) await this.collectJob(job.id, job.meetingId, job.taskId, job.expiresAt)
    } catch (error) {
      this.logger.warn(
        { errorMessage: error instanceof Error ? error.message : String(error) },
        "Meeting transcription poll failed",
      )
    }
  }

  /** 单独取出一个任务的结果，测试直接调它，不用等定时器。 */
  async collectJob(jobId: string, meetingId: string, taskId: string | null, expiresAt: Date | null): Promise<void> {
    if (!taskId) return
    if (expiresAt && expiresAt.getTime() <= Date.now()) {
      await this.recordAttemptFailure(jobId, meetingId, new Error("转写任务已超过 24 小时有效期。"))
      return
    }
    const credentials = this.credentials()
    if (!credentials) return

    try {
      const status = await describeTaskStatus(Number(taskId), credentials)
      if (status.Status === MEETING_TENCENT_TASK_STATUS.waiting || status.Status === MEETING_TENCENT_TASK_STATUS.doing) {
        return
      }
      if (status.Status === MEETING_TENCENT_TASK_STATUS.failed) {
        await this.recordAttemptFailure(jobId, meetingId, new Error(status.ErrorMsg || "转写失败。"))
        return
      }
      await this.storeResult(jobId, meetingId, status.Result ?? null)
    } catch (error) {
      await this.recordAttemptFailure(jobId, meetingId, error)
    }
  }

  /**
   * 收尾没人管的未完成分块上传。
   *
   * 进程被杀、用户直接合上电脑，都会留下一次没有收尾的分块上传。它的分片不在任何
   * 删除路径的覆盖范围里，会一直按量计费——所以必须有一处专门扫它。
   */
  @Cron("37 4 * * *")
  async cleanupStaleUploads(): Promise<void> {
    if (!this.config.transcriptionEnabled) return
    try {
      const aborted = await this.storage.listStaleMultipartUploads(STALE_UPLOAD_MS)
      if (aborted.length > 0) {
        this.logger.log({ count: aborted.length }, "Aborted stale meeting multipart uploads")
      }
    } catch (error) {
      this.logger.warn(
        { errorMessage: error instanceof Error ? error.message : String(error) },
        "Meeting multipart cleanup failed",
      )
    }
  }

  /** 删对象失败留下的重试入口。 */
  @Cron("23 * * * *")
  async retryPendingRecordingDeletes(): Promise<void> {
    const pending = await this.prisma.meetingRecording.findMany({
      where: { deletePending: true },
      take: 100,
    })
    for (const recording of pending) {
      try {
        await this.storage.deleteObject(recording.storageKey)
        await this.prisma.meetingRecording.update({
          where: { id: recording.id },
          data: { deletePending: false },
        })
      } catch (error) {
        this.logger.warn(
          { recordingId: recording.id, errorMessage: error instanceof Error ? error.message : String(error) },
          "Meeting recording object deletion retry failed",
        )
      }
    }
  }

  private credentials(): TencentAsrCredentials | null {
    const { secretId, secretKey } = this.config
    if (!secretId || !secretKey) return null
    return { secretId, secretKey, region: this.config.region }
  }

  /** 结果落库。逐字稿按段落存，说话人编号同时建一条映射记录。 */
  private async storeResult(jobId: string, meetingId: string, raw: string | null): Promise<void> {
    const parsed = parseTencentTranscript(raw)
    await this.prisma.$transaction(async (tx) => {
      // 重试会重跑一次，先清干净再写，避免同一段话出现两遍。
      await tx.meetingTranscriptSegment.deleteMany({ where: { meetingId } })
      if (parsed.segments.length > 0) {
        await tx.meetingTranscriptSegment.createMany({
          data: parsed.segments.map((segment, index) => ({
            meetingId,
            segmentIndex: index,
            speakerId: segment.speakerId,
            startMs: segment.startMs,
            endMs: segment.endMs,
            text: segment.text,
            words: segment.words.map((word) => ({ ...word })),
          })),
        })
      }
      for (const speakerId of new Set(parsed.segments.map((segment) => segment.speakerId))) {
        await tx.meetingSpeaker.upsert({
          where: { meetingId_speakerId: { meetingId, speakerId } },
          create: { meetingId, speakerId },
          update: {},
        })
      }
      await tx.meetingTranscriptionJob.update({
        where: { id: jobId },
        data: { status: JOB_STATUS_SUCCEEDED, completedAt: new Date(), lastError: null },
      })
      await tx.meeting.update({
        where: { id: meetingId },
        data: {
          status: "done",
          speakerCount: parsed.speakerCount,
          failureReason: null,
        },
      })
    })
    await this.notifyCompletion(meetingId, "done")
  }

  /**
   * 记一次失败。
   *
   * 没到上限就退回 `pending` 让下一轮重试——提交阶段失败通常是网络或配额抖动，重试
   * 一次就好了；到了上限才真正判失败，让用户看到失败原因和重试按钮。
   */
  private async recordAttemptFailure(jobId: string, meetingId: string, error: unknown): Promise<void> {
    const message = error instanceof Error ? error.message : String(error)
    const job = await this.prisma.meetingTranscriptionJob.update({
      where: { id: jobId },
      data: { attempts: { increment: 1 }, lastError: message.slice(0, 1000) },
    })
    const exhausted = job.attempts >= MEETING_TRANSCRIPTION_MAX_ATTEMPTS
    if (!exhausted) {
      await this.prisma.meetingTranscriptionJob.update({
        where: { id: jobId },
        data: { status: JOB_STATUS_PENDING, taskId: null },
      })
      return
    }
    this.logger.warn({ meetingId, attempts: job.attempts, errorMessage: message }, "Meeting transcription failed")
    await this.failJob(jobId, meetingId, message)
  }

  /**
   * 转写收尾之后告诉两边。
   *
   * 桌面端本来就每隔几秒轮询一次，这条实时消息只是让它当场就知道；手机是另一台设备，
   * 转写往往在用户离开电脑之后才跑完，所以**手机始终推**，不因为桌面端在线就跳过。
   */
  private async notifyCompletion(meetingId: string, status: "done" | "failed"): Promise<void> {
    const meeting = await this.prisma.meeting.findUnique({
      where: { id: meetingId },
      select: { userId: true, title: true },
    })
    if (!meeting) return
    const payload: MeetingTranscriptionCompletedPayload = { meetingId, title: meeting.title, status }

    if (this.liveDesktopGateway) {
      try {
        this.liveDesktopGateway.broadcastToUser(
          meeting.userId,
          createLiveEnvelope(LIVE_MESSAGE_TYPES.meetingTranscriptionCompleted, payload, {
            id: meetingId,
            sentAt: new Date().toISOString(),
          }),
        )
      } catch (error) {
        this.logger.warn(
          { meetingId, errorMessage: error instanceof Error ? error.message : String(error) },
          "Meeting transcription broadcast failed",
        )
      }
    }

    if (!this.mobilePush) return
    try {
      await this.mobilePush.sendMeetingTranscription(meeting.userId, {
        title: meeting.title,
        body: status === "done" ? "转写已完成，逐字稿可以看了。" : "转写失败，可以重新试一次。",
        meetingId,
        detail: meeting.title,
      })
    } catch (error) {
      this.logger.warn(
        { meetingId, errorMessage: error instanceof Error ? error.message : String(error) },
        "Meeting transcription push failed",
      )
    }
  }

  private async failJob(jobId: string, meetingId: string, reason: string): Promise<void> {
    await this.prisma.meetingTranscriptionJob.update({
      where: { id: jobId },
      data: { status: JOB_STATUS_FAILED, lastError: reason.slice(0, 1000) },
    })
    await this.prisma.meeting.update({
      where: { id: meetingId },
      data: { status: "failed", failureReason: reason.slice(0, 1000) },
    })
    await this.notifyCompletion(meetingId, "failed")
  }
}
