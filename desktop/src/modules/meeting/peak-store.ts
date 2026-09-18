import { encodeMeetingPeaks, MEETING_PEAK_MS } from "@synapse/shared"

/**
 * 录音过程中的振幅采样。
 *
 * 波形必须是真数据：同一路麦克风流同时喂给编码器和分析节点，定时取时域数据算振幅。
 * 拿随机柱状图冒充波形，用户第一眼就会看出来——它跟说话不同步。
 */

/** 时域数据的 RMS 转成一个 0-1 的包络。乘 6 是把正常说话的音量顶到可视高度。 */
export const AMPLITUDE_GAIN = 6

/** 包络下降比上升慢，看起来更像人声，而不是一根抖动的刺。 */
export const AMPLITUDE_DECAY = 0.82

/** 静音也有一个极小的底，否则柱子会缩成一条看不见的线。 */
export const AMPLITUDE_FLOOR = 0.02

/** 认定「这一帧有声音」的门槛。与界面上的无声提示共用。 */
export const LOUD_AMPLITUDE = 0.1

export type PeakStore = {
  readonly length: number
  /** 追加一个采样。返回归一化之后的振幅。 */
  push(amplitude: number): number
  /** 只读快照，用于绘制。 */
  snapshot(): readonly number[]
  /** 给服务端的一行 base64。 */
  encode(): string
  reset(): void
}

/**
 * 从时域数据算一个归一化振幅。
 *
 * 用 RMS 而不是峰值：峰值会被一次键盘敲击、一声咳嗽顶满，整条波形看起来一样高；
 * RMS 才反映「这一段有多响」。
 */
export function amplitudeFromTimeDomain(samples: Float32Array): number {
  if (samples.length === 0) return 0
  let sum = 0
  for (let index = 0; index < samples.length; index += 1) sum += samples[index] * samples[index]
  return Math.sqrt(sum / samples.length) * AMPLITUDE_GAIN
}

/** 上升立刻跟上、下降缓慢回落，并夹在 [FLOOR, 1] 之间。 */
export function smoothAmplitude(previous: number, value: number): number {
  const smoothed = Math.max(value, previous * AMPLITUDE_DECAY)
  return Math.min(1, Math.max(AMPLITUDE_FLOOR, smoothed))
}

export function createPeakStore(): PeakStore {
  const peaks: number[] = []
  let smoothed = 0

  return {
    get length() {
      return peaks.length
    },
    push(amplitude: number) {
      smoothed = smoothAmplitude(smoothed, amplitude)
      peaks.push(smoothed)
      return smoothed
    },
    snapshot() {
      return peaks
    },
    encode() {
      return encodeMeetingPeaks(peaks)
    },
    reset() {
      peaks.length = 0
      smoothed = 0
    },
  }
}

/**
 * 到点才采一次。
 *
 * 定时器分辨率比 28 毫秒粗，所以记录「上一次采样的时刻」，用时间差判断，而不是数
 * 回调次数——后者在后台标签页里会把整条波形拉长。
 */
export function createPeakScheduler(intervalMs: number = MEETING_PEAK_MS) {
  let lastSampleAt = 0
  return {
    /** 到达采样间隔时返回 true，并推进时间戳。 */
    due(now: number): boolean {
      if (now - lastSampleAt < intervalMs) return false
      lastSampleAt = now
      return true
    },
    reset(now = 0) {
      lastSampleAt = now
    },
  }
}
