import type {
  MeetingDetailDto,
  MeetingFinalizeInput,
  MeetingSummaryDto,
} from "@synapse/shared" with { "resolution-mode": "import" }

import { createMeetingSpool, sweepStaleMeetingSpools, type MeetingSpool } from "./spool"

/**
 * 录音的桌面侧。
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
  /** 收尾只跑一次：启动流程和别处同时叫它也只会走一趟。 */
  let finalizeInFlight: Promise<void> | null = null

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
    const response = await deps.fetchAuthenticated("/meetings", {}, "读取录音列表失败。")
    const body = (await response.json()) as { items?: unknown }
    return Array.isArray(body.items) ? (body.items as MeetingSummaryDto[]) : []
  }

  async function getMeeting(meetingId: string): Promise<MeetingDetailDto> {
    const response = await deps.fetchAuthenticated(
      `/meetings/${encodeURIComponent(meetingId)}`,
      {},
      "读取录音详情失败。",
    )
    return (await response.json()) as MeetingDetailDto
  }

  async function findPendingRecording(): Promise<PendingRecording> {
    const response = await deps.fetchAuthenticated("/meetings/recordings/pending", {}, "读取未完成录音失败。")
    return (await response.json()) as PendingRecording
  }

  /** 上次没收尾的录音还留在本机的那几片。 */
  async function readSpooledParts(recordingId: string) {
    return spoolFor(recordingId).pending()
  }

  /**
   * 把上一次异常退出留下的那段录音收尾。
   *
   * 进程被杀、强退、更新重启时，最后一片可能还留在本机，这里补传它，再把这段录音按正常
   * 录音收掉——**界面上不出现任何询问**，用户不需要知道发生过异常退出。这是全仓唯一一
   * 处「用户没点完成也照样收尾」的地方，所以它只跑一次、失败只记日志。
   *
   * 两个已经认下的代价：这段录音会照常送去转写（费用照算）；波形只存在内存里，跟着进程
   * 一起没了，只能用已传字节数估一个时长，那条录音的语音视图会是一条平的线。
   */
  async function finalizePendingRecording(): Promise<void> {
    if (finalizeInFlight) return finalizeInFlight
    finalizeInFlight = runFinalize()
    try {
      await finalizeInFlight
    } finally {
      finalizeInFlight = null
    }
  }

  async function runFinalize(): Promise<void> {
    try {
      const pending = await findPendingRecording()
      if (!pending) return
      for (const part of await readSpooledParts(pending.recordingId)) {
        await uploadPart(pending.recordingId, part.partNumber, part.bytes)
      }
      // 64 kbps 单声道：字节数换算成时长的近似值，只用来显示。
      const durationMs = Math.round((pending.receivedBytes / (64_000 / 8)) * 1000)
      await completeRecording(pending.recordingId, { durationMs, peaks: "" })
    } catch (error) {
      // 收尾失败只记日志：应用照常起来，用户那边这段录音停在「转写中」，不需要被打扰。
      deps.logger?.warn("Meeting pending recording finalize failed.", {
        errorName: error instanceof Error ? error.name : typeof error,
      })
    }
  }

  async function renameMeeting(meetingId: string, title: string): Promise<void> {
    await deps.fetchAuthenticated(
      `/meetings/${encodeURIComponent(meetingId)}`,
      { method: "PATCH", headers: { "content-type": "application/json" }, body: JSON.stringify({ title }) },
      "重命名失败。",
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

  return {
    startRecording,
    uploadPart,
    completeRecording,
    cancelRecording,
    listMeetings,
    getMeeting,
    findPendingRecording,
    readSpooledParts,
    finalizePendingRecording,
    renameMeeting,
    deleteMeeting,
    retryTranscription,
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
