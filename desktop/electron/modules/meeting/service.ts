import type {
  MeetingDetailDto,
  MeetingFinalizeInput,
  MeetingMinutesDto,
  MeetingSummaryDto,
} from "@synapse/shared" with { "resolution-mode": "import" }

import type { MeetingMinutesGenerator } from "./minutes"
import { createMeetingSpool, sweepStaleMeetingSpools, type MeetingSpool } from "./spool"

/**
 * 会议记录的桌面侧。
 *
 * 渲染进程**不能直接连服务端**，这是全仓一致的约定（令牌、刷新、重试都在主进程）。
 * 所以音频分片必须经这里转一手：分片先落到本机暂存，服务端确认之后再删掉——进程中途
 * 被杀时，没传走的那一片还在，重新进来可以接着完成。
 *
 * 界面不体现上传，也不体现存储位置，所以这一层不向渲染进程暴露任何进度；渲染进程
 * 只知道「这片传成功了」或「失败」。
 */

export type MeetingAuthenticatedFetch = (
  path: string,
  init?: RequestInit,
  errorMessage?: string,
) => Promise<Response>

export type MeetingServiceDeps = {
  readonly fetchAuthenticated: MeetingAuthenticatedFetch
  readonly spoolRoot?: string
  readonly logger?: {
    warn(message: string, meta?: Record<string, unknown>): void
  }
  /** 纪要由 Agent 生成；没有可用运行时就不暴露这个入口。 */
  readonly minutesGenerator?: MeetingMinutesGenerator
}

export type StartRecordingResult = {
  readonly meetingId: string
  readonly recordingId: string
  readonly uploadId: string
  readonly title: string
}

export type PendingRecording = {
  readonly meetingId: string
  readonly recordingId: string
  readonly title: string
  readonly receivedBytes: number
  readonly startedAt: string
} | null

type ServerRecordingStart = {
  readonly meetingId?: unknown
  readonly recordingId?: unknown
  readonly uploadId?: unknown
  readonly title?: unknown
}

export function createMeetingService(deps: MeetingServiceDeps) {
  const spools = new Map<string, MeetingSpool>()

  function spoolFor(recordingId: string): MeetingSpool {
    const existing = spools.get(recordingId)
    if (existing) return existing
    const created = createMeetingSpool(recordingId, deps.spoolRoot)
    spools.set(recordingId, created)
    return created
  }

  async function startRecording(input: { readonly title?: string }): Promise<StartRecordingResult> {
    const response = await deps.fetchAuthenticated(
      "/meetings/recordings",
      {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify(input.title ? { title: input.title } : {}),
      },
      "开始录音失败。",
    )
    const body = (await response.json()) as ServerRecordingStart
    if (typeof body.meetingId !== "string" || typeof body.recordingId !== "string") {
      throw new Error("服务端返回的录音信息不完整。")
    }
    // 新录音用的是新的 recordingId，理论上不会有旧暂存；清一次是防御——真出现同名
    // 目录，说明上一次的清理没跑完，留着会把两段录音的分片混进同一次上传。
    await spoolFor(body.recordingId).clear()
    return {
      meetingId: body.meetingId,
      recordingId: body.recordingId,
      uploadId: typeof body.uploadId === "string" ? body.uploadId : "",
      title: typeof body.title === "string" ? body.title : "新录音",
    }
  }

  /**
   * 传一个分片。
   *
   * 顺序是：先落盘 → 再发 → 确认后删本地。任何一步失败都不会让已经拿到手的字节消失。
   */
  async function uploadPart(recordingId: string, partNumber: number, bytes: Uint8Array): Promise<void> {
    const spool = spoolFor(recordingId)
    await spool.stage(partNumber, bytes)
    await deps.fetchAuthenticated(
      `/meetings/recordings/${encodeURIComponent(recordingId)}/parts/${partNumber}`,
      {
        method: "PUT",
        headers: { "content-type": "application/octet-stream" },
        body: new Uint8Array(bytes),
      },
      "录音分片发送失败。",
    )
    await spool.confirm(partNumber)
  }

  async function completeRecording(recordingId: string, input: MeetingFinalizeInput): Promise<void> {
    await deps.fetchAuthenticated(
      `/meetings/recordings/${encodeURIComponent(recordingId)}/complete`,
      {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify(input),
      },
      "保存录音失败。",
    )
    await spoolFor(recordingId).clear()
    spools.delete(recordingId)
  }

  /**
   * 取消录音。
   *
   * 服务端会**中止**这次分块上传（丢弃已传分片），本机的暂存也一并清掉。先清本机再
   * 发请求：请求失败时服务端那边由定时清理兜底，而本机不该留着一份永远用不上的字节。
   */
  async function cancelRecording(recordingId: string): Promise<void> {
    await spoolFor(recordingId).clear()
    spools.delete(recordingId)
    await deps.fetchAuthenticated(
      `/meetings/recordings/${encodeURIComponent(recordingId)}`,
      { method: "DELETE" },
      "取消录音失败。",
    )
  }

  async function listMeetings(): Promise<readonly MeetingSummaryDto[]> {
    const response = await deps.fetchAuthenticated("/meetings", {}, "读取会议列表失败。")
    const body = (await response.json()) as { items?: unknown }
    return Array.isArray(body.items) ? (body.items as MeetingSummaryDto[]) : []
  }

  async function getMeeting(meetingId: string): Promise<MeetingDetailDto> {
    const response = await deps.fetchAuthenticated(
      `/meetings/${encodeURIComponent(meetingId)}`,
      {},
      "读取会议详情失败。",
    )
    return (await response.json()) as MeetingDetailDto
  }

  async function findPendingRecording(): Promise<PendingRecording> {
    const response = await deps.fetchAuthenticated("/meetings/recordings/pending", {}, "读取未完成录音失败。")
    return (await response.json()) as PendingRecording
  }

  /** 上次没收尾的录音还留在本机的那几片，交给渲染进程接着传。 */
  async function readSpooledParts(recordingId: string) {
    return spoolFor(recordingId).pending()
  }

  async function renameMeeting(meetingId: string, title: string): Promise<void> {
    await deps.fetchAuthenticated(
      `/meetings/${encodeURIComponent(meetingId)}`,
      { method: "PATCH", headers: { "content-type": "application/json" }, body: JSON.stringify({ title }) },
      "重命名失败。",
    )
  }

  async function nameSpeaker(meetingId: string, speakerId: number, name: string | null): Promise<void> {
    await deps.fetchAuthenticated(
      `/meetings/${encodeURIComponent(meetingId)}/speakers/${speakerId}`,
      { method: "PUT", headers: { "content-type": "application/json" }, body: JSON.stringify({ name }) },
      "保存发言人名称失败。",
    )
  }

  async function deleteRecording(meetingId: string): Promise<void> {
    await deps.fetchAuthenticated(
      `/meetings/${encodeURIComponent(meetingId)}/recording`,
      { method: "DELETE" },
      "删除录音失败。",
    )
  }

  /** 删除整条录音：录音和文字一起删，服务端级联清掉逐字稿、发言人和纪要。 */
  async function deleteMeeting(meetingId: string): Promise<void> {
    await deps.fetchAuthenticated(
      `/meetings/${encodeURIComponent(meetingId)}`,
      { method: "DELETE" },
      "删除录音失败。",
    )
  }

  async function retryTranscription(meetingId: string): Promise<void> {
    await deps.fetchAuthenticated(
      `/meetings/${encodeURIComponent(meetingId)}/transcription/retry`,
      { method: "POST" },
      "重新转写失败。",
    )
  }

  async function saveMinutes(meetingId: string, minutes: MeetingMinutesDto): Promise<void> {
    await deps.fetchAuthenticated(
      `/meetings/${encodeURIComponent(meetingId)}/minutes`,
      { method: "PUT", headers: { "content-type": "application/json" }, body: JSON.stringify(minutes) },
      "保存纪要失败。",
    )
  }

  async function getPlaybackUrl(meetingId: string): Promise<{ readonly url: string | null }> {
    const response = await deps.fetchAuthenticated(
      `/meetings/${encodeURIComponent(meetingId)}/audio-url`,
      {},
      "读取录音地址失败。",
    )
    const body = (await response.json()) as { url?: unknown }
    return { url: typeof body.url === "string" ? body.url : null }
  }

  async function getPeaks(meetingId: string): Promise<{ readonly peaks: string | null }> {
    const response = await deps.fetchAuthenticated(
      `/meetings/${encodeURIComponent(meetingId)}/peaks`,
      {},
      "读取波形失败。",
    )
    const body = (await response.json()) as { peaks?: unknown }
    return { peaks: typeof body.peaks === "string" ? body.peaks : null }
  }

  /**
   * 一键生成纪要：拿逐字稿交给 Agent，整理成议题/结论/待办之后存下来。
   *
   * 生成结果直接落库而不是只回给界面——用户可能点完就切走，回来后纪要应该在那里。
   */
  async function generateMinutes(meetingId: string): Promise<MeetingMinutesDto> {
    const generator = deps.minutesGenerator
    if (!generator) throw new Error("纪要生成暂不可用。")
    const detail = await getMeeting(meetingId)
    const minutes = await generator.generate({
      title: detail.title,
      speakers: detail.speakers,
      segments: detail.segments,
    })
    await saveMinutes(meetingId, minutes)
    return minutes
  }

  return {
    generateMinutes,
    startRecording,
    uploadPart,
    completeRecording,
    cancelRecording,
    listMeetings,
    getMeeting,
    findPendingRecording,
    readSpooledParts,
    renameMeeting,
    nameSpeaker,
    deleteRecording,
    deleteMeeting,
    retryTranscription,
    saveMinutes,
    getPlaybackUrl,
    getPeaks,
    async sweepStaleSpools() {
      try {
        const removed = await sweepStaleMeetingSpools(deps.spoolRoot)
        if (removed.length > 0) deps.logger?.warn("Removed stale meeting spools.", { count: removed.length })
      } catch (error) {
        // 清理失败不该拦住启动：这些目录只是磁盘占用，不影响任何功能。
        deps.logger?.warn("Meeting spool sweep failed.", {
          errorName: error instanceof Error ? error.name : typeof error,
        })
      }
    },
  }
}

export type MeetingService = ReturnType<typeof createMeetingService>
