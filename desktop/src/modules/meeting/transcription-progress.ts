import { MEETING_TRANSCRIPTION_PROGRESS_CAP, type MeetingTranscriptionProgressDto } from "@synapse/shared"

/**
 * 转写进度条上那些「算错了不报错，只是看错」的纯逻辑：条画到哪儿、秒表此刻读到几。
 *
 * 单独一个文件是为了能单测：它不认识 React，也不认识 DOM。
 *
 * **这不是一个真实比例。** 腾讯云只回「排队 / 识别中 / 完成 / 失败」四个状态，没有百分
 * 比，服务端能给的也只有「已经等了多久」加一个估算出来的总时长。所以这条的作用是让人看
 * 出「在动、没死」，而不是报一个准数。由此两条规矩：
 *
 * - **封顶 95%**（`MEETING_TRANSCRIPTION_PROGRESS_CAP`）：估算不是承诺，结果没回来之前
 *   不许画满——画满了还不出结果，比不画更让人怀疑；
 * - **只往前走**：超过估算时间之后停在 95%，不回头。
 */
export function transcriptionProgressPercent(elapsedMs: number, expectedMs: number): number {
  if (!Number.isFinite(elapsedMs) || !Number.isFinite(expectedMs) || expectedMs <= 0) return 0
  const ratio = Math.max(0, elapsedMs) / expectedMs
  return Math.min(MEETING_TRANSCRIPTION_PROGRESS_CAP, ratio) * 100
}

/**
 * 此刻该报的已用时长。
 *
 * 服务端给的 `elapsedMs` 只到「它生成这个响应的那一刻」为止，而两边是每几秒才刷一次。
 * 刷新间隔里由客户端接着往下走，用的是**本机两次读取之间的差值**，不是本机挂钟减服务端
 * 时间戳：设备时钟和服务端差几分钟也照样算得对。
 */
export function transcriptionElapsedMs(
  progress: MeetingTranscriptionProgressDto | undefined,
  receivedAt: number,
  now: number,
): number {
  if (!progress) return 0
  const spread = Number.isFinite(receivedAt) && Number.isFinite(now) ? Math.max(0, now - receivedAt) : 0
  return Math.max(0, progress.elapsedMs) + spread
}

/** 阶段那一小段文字。`queued` 只在投递失败退回队列时短暂出现。 */
export function transcriptionStageLabel(progress: MeetingTranscriptionProgressDto | undefined): string {
  return progress?.stage === "running" ? "识别中" : "排队中"
}
