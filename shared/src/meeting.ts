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

/** 转写任务的重试上限。投递阶段失败和取结果阶段失败共用这一个计数。 */
export const MEETING_TRANSCRIPTION_MAX_ATTEMPTS = 5

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
}

/** 录音结束、交给服务端合并时带上来的本机信息。 */
export type MeetingFinalizeInput = {
  readonly durationMs: number
  readonly peaks: string
  readonly speakerCount: number
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
