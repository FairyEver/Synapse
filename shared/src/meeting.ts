/**
 * 会议记录的共用契约。
 *
 * 服务端、桌面端和手机端都读这一份：状态字面量、参数上限、时间格式化，以及波形
 * 振幅的编解码。这些值加起来就是「会议录音长什么样」的全部约定，分散在三端各写一
 * 遍必然对不上。
 *
 * 有两条容易踩的边界写在这里而不是调用方：
 * - 音频不进云盘，对象路径前缀是独立的 `meeting-recordings/`，与文档图片平级。
 * - 识别引擎是会议专用档，它只接受单声道、不支持指定人数、不支持语义分段。
 */

/** 对象存储里的路径前缀。与 `document-images/` 平级，但互不相干。 */
export const MEETING_RECORDING_PATH_PREFIX = "meeting-recordings"

/**
 * 会议场景的识别引擎。
 *
 * 官方对多人重叠发声的推荐档；代价是用不了「口语转书面语」「语义分段」和声纹角色
 * 分离，这三项都只支持另外两款引擎。
 */
export const MEETING_ENGINE_MODEL_TYPE = "16k_zh_en_meeting"

/** 单条录音上限 5 小时，约 140 MB。到 4 小时提示。 */
export const MEETING_MAX_DURATION_MS = 5 * 60 * 60 * 1000
export const MEETING_WARN_DURATION_MS = 4 * 60 * 60 * 1000

/**
 * 上传分片的字节门槛，也是对象存储分块上传的最小分片。
 *
 * 约合 128 秒音频，所以一次会议只会产生几十个分片，而不是上千个。
 */
export const MEETING_PART_BYTES = 1024 * 1024

/** 编码器每 2 秒产出一个音频分片；够了 `MEETING_PART_BYTES` 才真的传走。 */
export const MEETING_CHUNK_MS = 2000

/** 对象存储一次分块上传最多 10000 片。 */
export const MEETING_MAX_UPLOAD_PARTS = 10000

/** 波形一个采样覆盖的音频时长。密度固定，不随画布宽度变化。 */
export const MEETING_PEAK_MS = 28

/** 录音中的波形只回看最近 5 秒。 */
export const MEETING_LIVE_WINDOW_MS = 5000

/** 一直没听到声音多久之后给提示。听到过一次就永远不再提示。 */
export const MEETING_SILENCE_HINT_MS = 4000

/** 判定「这一帧有声音」的振幅门槛。 */
export const MEETING_LOUD_PEAK = 0.1

export const MEETING_DEFAULT_TITLE = "新录音"

export const MEETING_RECORDING_MIME_TYPE = "audio/mp4"

/** 录音时的码率。约 28 MB/小时。 */
export const MEETING_AUDIO_BITS_PER_SECOND = 64_000

/**
 * 存播放波形时的降采样倍数。
 *
 * 录音中每 28 毫秒取一个采样（画面上必须这么密才不丢细节），但播放波形最后会被重
 * 采样到画布宽度——最多一千个左右的柱子——所以四个合一个已经远超它需要的精度。不降
 * 的话五小时的会议要多存几倍的体积。
 */
export const MEETING_PEAK_DOWNSAMPLE_FACTOR = 4

export const MEETING_ASR_URL_TTL_SECONDS = 3600

/** 腾讯云 `TaskId` 24 小时后失效，超过这个时间还没取回结果就不再重试。 */
export const MEETING_TRANSCRIPTION_TTL_MS = 24 * 60 * 60 * 1000

/**
 * 任务投出去多久还没被引擎读过，就认定它已经死了。
 *
 * 起因是一次真实故障：一段 6 秒、几乎没有语音的录音（峰值只有满量程的 4%，通篇是麦克
 * 风底噪），配上 `SpeakerDiarization=1` 之后，腾讯云的会议引擎**永久卡在 `doing`**——
 * 既不出结果也不报错。直接查 `DescribeTaskStatus` 连等 20 多分钟，`Status` 一直是 1、
 * `AudioDuration` 一直是 0。同一份音频关掉说话人分离 5 秒就出结果，所以卡住的是引擎的
 * 说话人分离，跟音频采样率、跟网络都没有关系。
 *
 * 判定认的是 `AudioDuration`：引擎只要真读到过这份音频，这个数在提交后几秒内就会被填上
 * （实测 6 秒到 34 秒的音频都在 5 秒内填好）。于是「等够了 + 这个数还是 0」等于「引擎
 * 根本没碰过它」，而不是「还在排队」。反过来，只要 `AudioDuration` 有值这个兜底就不介
 * 入，真正跑得久的长录音仍然按 24 小时的有效期等。
 *
 * 取 15 分钟是给队列积压和超大文件下载留的余量。没有这个兜底，任务表里唯一的界就是
 * `MEETING_TRANSCRIPTION_TTL_MS`，用户要在「转写中」上干等 24 小时。
 */
export const MEETING_TRANSCRIPTION_STALL_MS = 15 * 60 * 1000

/**
 * 转写任务的重试上限。
 *
 * 只管**投递阶段**的失败——那一类通常是网络或配额抖动，重试一次就好。取结果阶段拿到
 * 的失败是引擎已经真的跑过并拒绝了这段音频，同样的音频再提交一次结果只会一样，所以那
 * 一类直接判失败，不进这个计数（见 `MeetingTranscriptionService.collectJob`）。
 */
export const MEETING_TRANSCRIPTION_MAX_ATTEMPTS = 5

/**
 * 转写耗时的粗估。
 *
 * 腾讯云既不给百分比也不说任务排在第几位，所以进度条只能拿「已经等了多久」去比一个估
 * 出来的总时长。这两个数决定它的手感，也决定它什么时候开始骗人：
 *
 * - 服务端是每分钟轮询一次，**任何**一条录音都要等到下一个整分钟才可能被取回结果，
 *   所以一分钟是下限；
 * - 识别本身按音频时长走，取 0.3 倍——比实测偏慢一点。宁可条走得比真实慢，也不要它
 *   在结果还没回来的时候先顶满。
 *
 * 它只用来画条，界面一律封顶在 95%：估算不是承诺。
 */
export const MEETING_TRANSCRIPTION_POLL_MS = 60_000
export const MEETING_TRANSCRIPTION_ESTIMATE_RATIO = 0.3

export function estimateMeetingTranscriptionMs(durationMs: number): number {
  const audio = Number.isFinite(durationMs) ? Math.max(0, durationMs) : 0
  return Math.round(MEETING_TRANSCRIPTION_POLL_MS + audio * MEETING_TRANSCRIPTION_ESTIMATE_RATIO)
}

/** 进度条画到多少就停。估算不是承诺，没出结果之前不许画满。 */
export const MEETING_TRANSCRIPTION_PROGRESS_CAP = 0.95

/**
 * 转写任务此刻走到哪一步。
 *
 * `queued` 是「还没投出去」，正常路径上看不到它——录音一收尾就当场提交，只有提交失败
 * 退回队列等下一轮时才会短暂停在这里。
 */
export type MeetingTranscriptionStage = "queued" | "running"

export type MeetingTranscriptionProgressDto = {
  readonly stage: MeetingTranscriptionStage
  /** 从投递成功到服务端生成这个响应之间的毫秒数。客户端的秒表在两次刷新之间接着它走。 */
  readonly elapsedMs: number
  /** 按音频时长估的预期耗时。 */
  readonly expectedMs: number
}

export type MeetingStatus = "transcribing" | "done" | "failed"
export type MeetingRecordingStatus = "pending" | "ready" | "deleted"
export type MeetingTranscriptionStatus = "pending" | "running" | "succeeded" | "failed"
export type MeetingMinutesStatus = "none" | "generating" | "ready" | "failed"

/** `DescribeTaskStatus` 的 `Data.Status`。 */
export const MEETING_TENCENT_TASK_STATUS = {
  waiting: 0,
  doing: 1,
  success: 2,
  failed: 3,
} as const

export type MeetingSpeakerDto = {
  readonly speakerId: number
  readonly name: string | null
}

export type MeetingTranscriptWordDto = {
  readonly text: string
  readonly startMs: number
  readonly endMs: number
}

export type MeetingTranscriptSegmentDto = {
  readonly id: string
  readonly speakerId: number
  readonly startMs: number
  readonly endMs: number
  readonly text: string
  readonly words: readonly MeetingTranscriptWordDto[]
}

export type MeetingTodoDto = {
  readonly id: string
  readonly text: string
  readonly owner: string | null
  readonly due: string | null
  readonly done: boolean
}

export type MeetingMinutesDto = {
  readonly topics: readonly string[]
  readonly conclusions: readonly string[]
  readonly todos: readonly MeetingTodoDto[]
  readonly editedAt: string | null
}

export type MeetingRecordingDto = {
  readonly status: MeetingRecordingStatus
  readonly mimeType: string
  readonly size: number
  readonly durationMs: number
  readonly deletedAt: string | null
}

export type MeetingSummaryDto = {
  readonly id: string
  readonly title: string
  readonly startedAt: string
  readonly durationMs: number
  readonly speakerCount: number
  readonly status: MeetingStatus
  readonly recording: MeetingRecordingDto
  readonly minutesStatus: MeetingMinutesStatus
  readonly createdAt: string
}

export type MeetingDetailDto = MeetingSummaryDto & {
  readonly failureReason: string | null
  readonly speakers: readonly MeetingSpeakerDto[]
  readonly segments: readonly MeetingTranscriptSegmentDto[]
  readonly minutes: MeetingMinutesDto | null
  readonly minutesFailureReason: string | null
  /**
   * 转写进度。可空是**有意的**：客户端比服务端先装上去的时候这个字段还不存在，界面要
   * 退回那条不确定的条，而不是因为读不到字段就崩。
   */
  readonly transcription?: MeetingTranscriptionProgressDto
}

/**
 * 录音结束、交给服务端合并时带上来的本机信息。
 *
 * 不再上报发言人数：它是为了列表里那句「N 位发言人」才有的，那句话已经去掉。服务端
 * 的 `speakerCount` 字段保留，历史数据仍按原样返回。
 */
export type MeetingFinalizeInput = {
  readonly durationMs: number
  readonly peaks: string
  readonly speakerCount?: number
}

/** 分片上传时服务端返回的进度，仅用于续传判断，不展示。 */
export type MeetingUploadStateDto = {
  readonly recordingId: string
  readonly uploadId: string | null
  readonly receivedBytes: number
  readonly receivedParts: number
}

const TRANSCRIPTION_STATUS_LABEL: Record<MeetingStatus, string> = {
  transcribing: "转写中",
  done: "已完成",
  failed: "转写失败",
}

export function meetingStatusLabel(status: MeetingStatus): string {
  return TRANSCRIPTION_STATUS_LABEL[status]
}

/**
 * 列表里的时长，例如「48 分」「1 小时 12 分」「36 秒」。
 *
 * 不到一分钟的录音要显示秒，否则 40 秒的测试录音会显示成「0 分」。
 */
export function formatMeetingDuration(ms: number): string {
  if (!Number.isFinite(ms) || ms <= 0) return "0 秒"
  const totalSeconds = Math.round(ms / 1000)
  const hours = Math.floor(totalSeconds / 3600)
  const minutes = Math.floor((totalSeconds % 3600) / 60)
  if (hours > 0) return minutes > 0 ? `${hours} 小时 ${minutes} 分` : `${hours} 小时`
  if (minutes > 0) return `${minutes} 分`
  return `${totalSeconds} 秒`
}

/** 录音中的计时器和播放进度，例如「00:42」「1:12:04」。 */
export function formatMeetingClock(ms: number): string {
  const totalSeconds = Math.max(0, Math.floor((Number.isFinite(ms) ? ms : 0) / 1000))
  const hours = Math.floor(totalSeconds / 3600)
  const minutes = Math.floor((totalSeconds % 3600) / 60)
  const seconds = totalSeconds % 60
  const pad = (value: number) => String(value).padStart(2, "0")
  return hours > 0 ? `${hours}:${pad(minutes)}:${pad(seconds)}` : `${pad(minutes)}:${pad(seconds)}`
}

type NodeBufferGlobal = {
  readonly Buffer?: {
    from(value: Uint8Array): { toString(encoding: string): string }
    from(value: string, encoding: string): Uint8Array
  }
}

function nodeBuffer(): NodeBufferGlobal["Buffer"] {
  return (globalThis as NodeBufferGlobal).Buffer
}

function bytesToBase64(bytes: Uint8Array): string {
  const buffer = nodeBuffer()
  if (buffer) return buffer.from(bytes).toString("base64")
  let binary = ""
  for (const byte of bytes) binary += String.fromCharCode(byte)
  return btoa(binary)
}

function base64ToBytes(encoded: string): Uint8Array {
  const buffer = nodeBuffer()
  if (buffer) return new Uint8Array(buffer.from(encoded, "base64"))
  const binary = atob(encoded)
  const bytes = new Uint8Array(binary.length)
  for (let index = 0; index < binary.length; index += 1) bytes[index] = binary.charCodeAt(index)
  return bytes
}

/**
 * 把振幅数组压成一个字节一个采样再 base64。
 *
 * 振幅本来就是 0-1 的包络，8 位精度足够画柱子；按 32 位浮点存会让五小时的会议多出
 * 四倍体积，而读回来的一切都会被重采样到画布宽度。
 */
export function encodeMeetingPeaks(peaks: ArrayLike<number>): string {
  const bytes = new Uint8Array(peaks.length)
  for (let index = 0; index < peaks.length; index += 1) {
    const value = peaks[index] ?? 0
    bytes[index] = Math.max(0, Math.min(255, Math.round(value * 255)))
  }
  return bytesToBase64(bytes)
}

/** 标准 base64，含结尾 padding。 */
const BASE64_PATTERN = /^[A-Za-z0-9+/]*={0,2}$/

export function decodeMeetingPeaks(encoded: string | null | undefined): Uint8Array {
  if (!encoded) return new Uint8Array(0)
  // 先按格式挡住，再解码。Node 的 base64 解码器很宽松：喂它一段非 base64 的文字，
  // 它不报错，而是把里面碰巧合法的字符挑出来凑成几个字节。那样画出来的是一条乱八
  // 糟的波形，比「没有波形」更糟，也不会有任何地方报错。
  if (encoded.length % 4 !== 0 || !BASE64_PATTERN.test(encoded)) return new Uint8Array(0)
  try {
    return base64ToBytes(encoded)
  } catch {
    // 历史数据或人工改过的值解不开时按「没有波形」处理，不让详情页整页失败。
    return new Uint8Array(0)
  }
}

/**
 * 把录音中的密集采样降成播放波形的存储分辨率。
 *
 * 取窗口里的**最大值**而不是平均值：平均会把一个尖峰稀释掉，画出来比实际安静，
 * 而波形的用处正是让人一眼看出哪一段在说话。
 */
export function downsampleMeetingPeaks(
  peaks: ArrayLike<number>,
  factor: number = MEETING_PEAK_DOWNSAMPLE_FACTOR,
): number[] {
  const length = peaks.length
  if (length === 0) return []
  const step = Math.max(1, Math.floor(factor))
  if (step === 1) return Array.from({ length }, (_, index) => peaks[index] ?? 0)
  const result: number[] = []
  for (let start = 0; start < length; start += step) {
    let max = 0
    for (let index = start; index < Math.min(length, start + step); index += 1) {
      const value = peaks[index] ?? 0
      if (value > max) max = value
    }
    result.push(max)
  }
  return result
}

/**
 * 录音端上传的是「一行 base64」，这里在服务端把它压成存储用的体积。
 *
 * 解码出来的字节是 0-255，而降采样和编码都在 0-1 的浮点上做，中间必须换成同一套
 * 数值空间——直接拿字节当浮点传下去会得到一片削顶的柱子，而且不会报任何错。
 */
export function compactMeetingPeaks(encoded: string | null | undefined): string | null {
  const decoded = decodeMeetingPeaks(encoded)
  if (decoded.length === 0) return null
  const floats = Array.from(decoded, (byte) => byte / 255)
  const compacted = downsampleMeetingPeaks(floats)
  return compacted.length > 0 ? encodeMeetingPeaks(compacted) : null
}

/** 播放头相对整段的进度（0-1），越界一律夹住。 */
export function meetingPlaybackProgress(positionMs: number, durationMs: number): number {
  if (!Number.isFinite(durationMs) || durationMs <= 0) return 0
  return Math.max(0, Math.min(1, positionMs / durationMs))
}

/**
 * 转写收尾时发给桌面端的通知载荷。
 *
 * 桌面端本来就在轮询，这条消息只是让它在转完的当下就知道——用户在别的界面做事时，
 * 不该等下一次轮询才看到结果。
 */
export type MeetingTranscriptionCompletedPayload = {
  readonly meetingId: string
  readonly title: string
  readonly status: "done" | "failed"
}

export function isMeetingTranscriptionCompletedPayload(
  value: unknown,
): value is MeetingTranscriptionCompletedPayload {
  if (!value || typeof value !== "object") return false
  const payload = value as Record<string, unknown>
  return (
    typeof payload.meetingId === "string" &&
    payload.meetingId.length > 0 &&
    typeof payload.title === "string" &&
    (payload.status === "done" || payload.status === "failed")
  )
}
