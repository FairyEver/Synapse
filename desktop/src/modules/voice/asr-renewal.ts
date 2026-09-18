import { type AsrTranscript } from "./asr-transcript"

/**
 * 一条识别连接能用多久，以及接缝处两段文字怎么接。
 *
 * 现用的 `Hy-ASR-3.0-preview` 是混元内测版，**不接受 `needvad`**（服务端签名一直带着
 * `needvad=1`，这个引擎不认），于是落到「未开 VAD 时单次连续识别最长 60 秒」这条规则
 * 上：实测第 60.90 秒收到 `{"code":4014,"message":"音频过长, 请设置参数needvad为1"}`，
 * 随后连接被掐，攒下的一整段文字全部丢失。
 *
 * 所以轮换不是对用户说话时长的限制，而是**引擎连接的寿命管理**：快到上限时换一条新
 * 连接接着写。用户视角是一段连续转写，界面不加计时、不加提示、不设时长上限。
 */

/** 接缝：换连接之前那一段已经冻结的文本。 */
export type AsrSeam = {
  readonly text: string
  /**
   * 还没定稿。它只影响**画成什么颜色**，不影响排在哪 —— 引擎收尾时还会改写它，
   * 所以那时只能算未定稿；但把它挪到后面去是另一回事，那是把用户说的话前后颠倒。
   */
  readonly provisional: boolean
}

/**
 * 到了这个时间就开始预热下一条连接。
 *
 * 不等停顿再预热：预热要走一次签名加一次握手（实测 0.26 秒，弱网更久），等停顿才
 * 开始的话，接棒就会落在停顿结束、用户已经说回话之后 —— 从词中间切开。
 */
export const PLAN_AFTER_MS = 46_000

/**
 * 到这个时间无条件接棒，不再等停顿。
 *
 * 实测硬边是 60.90 秒，这里留了 10 秒余量。等引擎自己动手就晚了：它不是「收尾」，
 * 是直接报错掐连接。
 */
export const FORCE_AFTER_MS = 50_000

/**
 * 包内均方根低于这个值算静音。
 *
 * 实测同一段语音里，说话包在 0.07~0.18，句间隙接近 0.0001，0.01 落在两者中间，
 * 不敏感。包粒度是 200ms，所以「本包是静音」就等于「这 200ms 里没有人声」，
 * 已经够窄，不需要再攒连续几包。
 */
export const SILENCE_RMS = 0.01

/** 本拍该不该开始预热。年龄是**这条连接**已经收了多久音频，不是这次录音录了多久。 */
export function shouldStartWarming(connectionAgeMs: number): boolean {
  return connectionAgeMs >= PLAN_AFTER_MS
}

/**
 * 暖连接已经就绪时，本拍该不该接棒。
 *
 * 在停顿处接棒，接缝两边都不缺字；一直不停就拖到硬顶，那时只能从词中间切开，
 * 实测会让跨在接缝上的那个词两边各认领一次（多出两三个字）。选停顿只是为了让接缝
 * 干净，**不决定换不换**：引擎数的是收到的采样，用户不出声也在烧它的额度。
 *
 * 这两个阈值取错只会退化、不会越界：一个高到天上去也只会走停顿那条路，一个低到零
 * 也只会 46 秒就走，两者都不会让连接活过 `FORCE_AFTER_MS`。
 */
export function shouldHandOver(rms: number, connectionAgeMs: number): boolean {
  if (connectionAgeMs < PLAN_AFTER_MS) return false
  return connectionAgeMs >= FORCE_AFTER_MS || rms < SILENCE_RMS
}

/**
 * 接缝定稿。引擎收到 `end` 之后会把最后一句整个重写一遍（实测补完了半截词、顺带
 * 改掉了错字），所以定稿是拿这一份**换掉**暂定的那一份，不是接在它后面 ——
 * 接在后面同一句话会出现两遍，用户只能自己删。
 */
export function promoteSeam(seam: AsrSeam, text: string): AsrSeam {
  return { text, provisional: false }
}

/**
 * 把冻结的接缝和活连接的文本接起来。
 *
 * 接缝还没有定稿时，活连接**已经定稿**的句子也只能排进未定稿的那一半。顺序比颜色
 * 重要：颜色错了只是看着别扭，等定稿回来就恢复；顺序错了是用户提交的文字前后颠倒，
 * 只能自己手改。
 */
export function mergeTranscript(seam: AsrSeam | null, live: AsrTranscript): AsrTranscript {
  if (!seam) return live
  if (seam.provisional) {
    const unstable = `${seam.text}${live.stable}${live.unstable}`
    return { stable: "", unstable, combined: unstable }
  }
  const stable = `${seam.text}${live.stable}`
  return { stable, unstable: live.unstable, combined: `${stable}${live.unstable}` }
}

/**
 * 一包 PCM 的响度。包是 16k / 16bit / 单声道的小端字节，和送出去的那一份完全一样。
 *
 * 用 `DataView` 而不是 `Int16Array`：后者要求字节偏移对齐，分片出来的视图不保证满足。
 */
export function chunkRms(chunk: Uint8Array): number {
  const sampleCount = Math.floor(chunk.length / 2)
  if (sampleCount === 0) return 0
  const view = new DataView(chunk.buffer, chunk.byteOffset, chunk.byteLength)
  let sum = 0
  for (let index = 0; index < sampleCount; index += 1) {
    const value = view.getInt16(index * 2, true) / 32_768
    sum += value * value
  }
  return Math.sqrt(sum / sampleCount)
}
