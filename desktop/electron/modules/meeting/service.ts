import { createWriteStream } from "node:fs"
import { mkdir, rename, rm, stat } from "node:fs/promises"
import { Readable } from "node:stream"
import { pipeline } from "node:stream/promises"
import type {
  MeetingDetailDto,
  MeetingFinalizeInput,
  MeetingSummaryDto,
} from "@synapse/shared" with { "resolution-mode": "import" }

import type { EventBus } from "../../runtime/event-bus"
import {
  createMeetingAudioCache,
  meetingAudioUrlForId,
  type MeetingAudioCache,
} from "./audio-cache"
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

/**
 * 不带令牌地取一个外部地址。
 *
 * 回放地址是服务端签好的对象存储直链，**不能把访问令牌也带上**：那是一台我们不控制的
 * 存储主机，令牌只该发给自己的服务端。所以这条路径走 `fetchPublic` 而不是
 * `fetchAuthenticated`。
 */
export type MeetingPublicFetch = (url: string) => Promise<Response>

export type MeetingServiceDeps = {
  readonly fetchAuthenticated: MeetingAuthenticatedFetch
  readonly fetchPublic: MeetingPublicFetch
  /** 音频缓存的落盘位置。由 `descriptors.ts` 从 userData 推出来传进来。 */
  readonly audioCacheRoot: string
  readonly eventBus?: Pick<EventBus, "emit">
  readonly spoolRoot?: string
  readonly logger?: {
    warn(message: string, meta?: Record<string, unknown>): void
  }
}

/**
 * `app.meeting.audio.ensure` 的返回。
 *
 * `unavailable` 是契约之外补的一个分支，只为兜住「详情还停在旧状态、服务端已经说这条没
 * 了」这个竞态：那种情况下没有音频可给，也不能假装在下载（那会一直转下去）。渲染进程
 * 拿到它就什么都不做，等下一次详情刷新把那一屏换成「录音已删除」。
 */
export type MeetingAudioEnsureResult =
  | { readonly state: "ready"; readonly url: string }
  | { readonly state: "downloading" }
  | { readonly state: "unavailable" }

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

/// 列表里的那一条。`null` 那个分支是单条接口「什么都没有」的写法，列出来的时候不存在。
export type PendingRecordingEntry = NonNullable<PendingRecording>

type ServerRecordingStart = {
  readonly meetingId?: unknown
  readonly recordingId?: unknown
  readonly uploadId?: unknown
  readonly title?: unknown
}

/**
 * 服务端列表一次给的条数上限（`server/src/meeting/meeting.service.ts` 的 `take: 200`）。
 *
 * 拿它判断「这次列表是不是给全了」：返回条数**少于**它才说明所有录音都在里面，本机那些
 * 不在列表里的才是真的被删了。刚好等于上限时还有更早的没返回，照这个规则会误删。
 */
const MEETING_LIST_LIMIT = 200

/** 一次 `ensure` 最多在后台试几轮。退避到 30 秒封顶，约四五分钟。 */
const AUDIO_DOWNLOAD_MAX_ATTEMPTS = 12
const AUDIO_DOWNLOAD_BACKOFF_CEILING_MS = 30_000

export function createMeetingService(deps: MeetingServiceDeps) {
  const spools = new Map<string, MeetingSpool>()
  const audioCache = createMeetingAudioCache({ root: deps.audioCacheRoot, logger: deps.logger })
  /**
   * 正在下载的音频，按 meetingId。
   *
   * 这就是 `ensure` 幂等的全部实现：同一个 meetingId 重复调用（重渲染、用户点重试）看到
   * 已经有在跑的了就原样返回，不起第二个下载。
   */
  const audioDownloads = new Map<string, Promise<void>>()
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
    const spool = spoolFor(body.recordingId)
    await spool.clear()
    // 清完立刻把目录建回来：**目录本身就是「这条是本机录的」的凭据**。不建的话，在第一个
    // 分片攒够（1 MB，约 128 秒）之前被杀，这条录音就再也认不出是本机录的。
    await mkdir(spool.directory, { recursive: true })
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
    const items = Array.isArray(body.items) ? (body.items as MeetingSummaryDto[]) : []
    // 列表刷新是「别的设备把这条删了」唯一能被本机看见的时机：本机缓存里那些不在列表里
    // 的条目就是已经被删掉的，顺手清掉，不然那台电脑上还留着一份能播的副本。
    await audioCache.pruneMissing(items.map((item) => item.id), items.length < MEETING_LIST_LIMIT)
    return items
  }

  async function getMeeting(meetingId: string): Promise<MeetingDetailDto> {
    const response = await deps.fetchAuthenticated(
      `/meetings/${encodeURIComponent(meetingId)}`,
      {},
      "读取录音详情失败。",
    )
    return (await response.json()) as MeetingDetailDto
  }

  /**
   * 暂存目录在不在。
   *
   * 判据是**目录在不在**，不是「里面还有没有分片」：分片是服务端确认一片就删一片，所以
   * 录到一半被杀时目录往往是空的。拿「有没有分片」当判据，会把本机自己录的那条判成别人
   * 的——而那条从此再也没人收尾，永远停在「转写中」。
   *
   * 目录由 `startRecording` 建，收尾或取消时清掉，所以它就是「本机录了这一条」的凭据。
   */
  async function ownsSpool(recordingId: string): Promise<boolean> {
    try {
      await stat(spoolFor(recordingId).directory)
      return true
    } catch {
      return false
    }
  }

  /**
   * 本机自己录的、还没收尾的那条。
   *
   * **按本机残片挑，不是按服务端的「最新一条」挑。** 手机和电脑现在录的是同一批数据，
   * 而 `/recordings/pending` 只按账号过滤、默认只给最新的一条——照它返回的那条去收尾，
   * 手机上正在录的那条就会被电脑抢掉：时长是按已传字节估的，波形是空的，手机后续的分片
   * 也全都会失败。残片只在本机，所以「本机有这个 recordingId 的暂存目录」就是「这条是
   * 本机录的」。
   */
  async function findOwnPendingRecording(): Promise<PendingRecording | null> {
    const response = await deps.fetchAuthenticated(
      "/meetings/recordings/pending?all=1",
      {},
      "读取未完成录音失败。",
    )
    const body = (await response.json()) as { items?: unknown }
    if (!Array.isArray(body.items)) return null
    for (const item of body.items as PendingRecordingEntry[]) {
      if (await ownsSpool(item.recordingId)) return item
    }
    // 服务端说有几条没收尾，但一条都不是本机录的。**不是本机的就不要碰**：别的设备录的
    // 那条，本机既没有字节也没有波形，抢过来收尾只会毁掉它。
    return null
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
      const pending = await findOwnPendingRecording()
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

  /**
   * 这条录音的音频在本机能不能直接用。
   *
   * 返回 `ready` 时渲染进程拿到的是一个本机协议地址，播放、拖动、±15 秒全走本机文件，
   * 一次网络请求都不发。
   *
   * 三件套判据在 `audio-cache.lookup` 里，这里只负责补上服务端那一半：**列表和详情本来
   * 就要拉，所以这一趟详情请求是顺带的**——拿不到（没网）不算失败，退化成「文件在、大小
   * 对得上」就当命中，否则离线就听不了听过的录音了。
   */
  async function ensureAudio(meetingId: string): Promise<MeetingAudioEnsureResult> {
    const inFlight = audioDownloads.get(meetingId)
    if (inFlight) return { state: "downloading" }

    let detail: MeetingDetailDto | null = null
    try {
      detail = await getMeeting(meetingId)
    } catch {
      // 离线、服务端慢、这条刚被删——都走「按本机索引判命中」这条路。
    }
    // 服务端说这条录音没了：不下载、不缓存。界面上那屏由详情自己渲染成「录音已删除」。
    if (detail && detail.recording.status === "deleted") return { state: "unavailable" }

    const serverSize = detail?.recording.size ?? 0
    const cached = await audioCache.lookup(meetingId, serverSize)
    if (cached) {
      await audioCache.touch(meetingId, new Date().toISOString())
      return { state: "ready", url: meetingAudioUrlForId(meetingId) }
    }

    startAudioDownload(meetingId, serverSize)
    return { state: "downloading" }
  }

  function startAudioDownload(meetingId: string, serverSize: number): void {
    if (audioDownloads.has(meetingId)) return
    const task = runAudioDownload(meetingId, serverSize)
      .catch(() => undefined)
      .finally(() => audioDownloads.delete(meetingId))
    audioDownloads.set(meetingId, task)
  }

  /**
   * 下载失败不推失败事件、也不告诉渲染进程——设计上它就不是失败（网一回来自己会下完）。
   * 这里按退避继续重试，渲染进程那边由「转满 10 秒给一个重试」兜住；那个重试只是再叫
   * 一次 `ensure` 催一下，不取代这里的自动恢复。
   */
  async function runAudioDownload(meetingId: string, serverSize: number): Promise<void> {
    for (let attempt = 0; attempt < AUDIO_DOWNLOAD_MAX_ATTEMPTS; attempt += 1) {
      if (attempt > 0) {
        await new Promise((resolve) => setTimeout(resolve, Math.min(2 ** attempt * 500, AUDIO_DOWNLOAD_BACKOFF_CEILING_MS)))
      }
      try {
        await downloadAudioOnce(meetingId, serverSize)
        return
      } catch (error) {
        deps.logger?.warn("Meeting audio download attempt failed.", {
          attempt: attempt + 1,
          errorName: error instanceof Error ? error.name : typeof error,
        })
      }
    }
    deps.logger?.warn("Meeting audio download gave up after retries.", {
      attempts: AUDIO_DOWNLOAD_MAX_ATTEMPTS,
    })
  }

  async function downloadAudioOnce(meetingId: string, serverSize: number): Promise<void> {
    const { url } = await getPlaybackUrl(meetingId)
    if (!url) throw new Error("这条录音没有可用的音频。")

    const target = audioCache.audioPath(meetingId)
    const temporary = `${target}.tmp`
    await mkdir(deps.audioCacheRoot, { recursive: true })
    try {
      const response = await deps.fetchPublic(url)
      if (!response.body) throw new Error("音频响应为空。")
      const source = Readable.fromWeb(response.body as unknown as Parameters<typeof Readable.fromWeb>[0])
      // 先写临时文件再改名：中途断了不会在缓存目录里留下一个尺寸不对的 m4a——那种文件
      // 会被下一次的命中判据当成「大小对不上」重新下载，但留着本身就是个坑。
      await pipeline(source, createWriteStream(temporary, { flags: "w" }))
      const size = (await stat(temporary)).size
      // 服务端记的字节数与实际下到的对不上，说明这份音频是残的。当作失败，退避后再来。
      if (serverSize > 0 && size !== serverSize) throw new Error("音频大小与服务端记录不一致。")
      await rename(temporary, target)
      const peaks = await readPeaksFromServer(meetingId)
      await audioCache.save({ meetingId, size, peaks, lastPlayedAt: new Date().toISOString() })
      await audioCache.enforceLimit()
      deps.eventBus?.emit({
        domain: "meeting",
        type: "meeting.audioReady",
        payload: { meetingId, url: meetingAudioUrlForId(meetingId) },
        timestamp: new Date().toISOString(),
      })
    } finally {
      await rm(temporary, { force: true }).catch((error: unknown) => {
        deps.logger?.warn("Meeting audio temp file cleanup failed.", {
          errorName: error instanceof Error ? error.name : typeof error,
        })
      })
    }
  }

  /** 波形取不到就存空串：下次打开详情时 `getPeaks` 会照常去服务端补。 */
  async function readPeaksFromServer(meetingId: string): Promise<string> {
    try {
      const { peaks } = await getPeaks(meetingId)
      return peaks ?? ""
    } catch {
      return ""
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
    // 删干净包括本机这一份：服务器上没了、这台机器上还能播，是同一个「删除」的两套答案。
    await audioCache.remove(meetingId)
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
    // 缓存里记着波形就直接用：波形是跟音频一起存下来的，离线时不该因为拉不到它画一条平线。
    const cached = await audioCache.peaksFor(meetingId)
    if (cached) return { peaks: cached }
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
    findOwnPendingRecording,
    readSpooledParts,
    finalizePendingRecording,
    renameMeeting,
    deleteMeeting,
    retryTranscription,
    getPlaybackUrl,
    getPeaks,
    ensureAudio,
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
