/**
 * 麦克风采样到腾讯云送包格式的转换。
 *
 * 引擎要的是 16000Hz / 16bit / 单声道 PCM，每 200ms 一包共 6400 字节。设备原生
 * 采样率通常是 44.1k 或 48k，重采样这一步在首字延迟的关键路径上，所以优先让
 * AudioContext 直接以 16k 建图，下面的重采样只作为拿不到 16k 时的兜底。
 *
 * 发送速率必须贴近 1:1：快于实时、或两包间隔超过 6 秒，引擎都会主动断开。
 * 采样不够时补静音而不是少发，就是为了把这一点钉死。
 */

/** 16k / 16bit / 单声道，200ms 的字节数。 */
export const ASR_PCM_CHUNK_BYTES = 6400
export const ASR_PCM_TARGET_RATE = 16_000
export const ASR_PCM_CHUNK_SAMPLES = (ASR_PCM_TARGET_RATE * 200) / 1000

/**
 * 线性插值重采样。
 *
 * `carry` 是上一批的最后一个采样，插值跨批时需要它，否则批边界会出现咔哒声并
 * 让识别结果在每 200ms 处抖动。返回的 `position` 要原样传给下一批。
 */
export function resampleLinear(
  input: Float32Array,
  inputRate: number,
  targetRate: number,
  carry: { previous: number; position: number },
): Float32Array {
  if (inputRate === targetRate || input.length === 0) {
    if (input.length > 0) carry.previous = input[input.length - 1]!
    return input
  }
  const ratio = inputRate / targetRate
  const output: number[] = []
  let position = carry.position
  while (position < input.length) {
    const index = Math.floor(position)
    const fraction = position - index
    const previous = index === 0 ? carry.previous : input[index - 1]!
    const current = input[index]!
    output.push(previous + (current - previous) * fraction)
    position += ratio
  }
  carry.position = position - input.length
  carry.previous = input[input.length - 1]!
  return Float32Array.from(output)
}

const clampToInt16 = (sample: number): number => {
  const scaled = sample < 0 ? sample * 0x8000 : sample * 0x7fff
  return scaled < -0x8000 ? -0x8000 : scaled > 0x7fff ? 0x7fff : Math.round(scaled)
}

/** 小端 16bit PCM。引擎只认这个字节序。 */
export function floatToInt16Le(samples: Float32Array): Uint8Array<ArrayBuffer> {
  const bytes = new Uint8Array(samples.length * 2)
  const view = new DataView(bytes.buffer)
  for (let index = 0; index < samples.length; index += 1) {
    view.setInt16(index * 2, clampToInt16(samples[index]!), true)
  }
  return bytes
}

/**
 * 攒够一包就吐一包。`takeChunk` 永远返回 6400 字节：采样不足时补静音，多的留到
 * 下一次。这样定时器只要按 200ms 走，送出的音频时长就自动等于真实时间。
 */
export class AsrPcmChunker {
  private samples: Float32Array
  private readonly carry = { previous: 0, position: 0 }
  private buffered = 0

  constructor(
    private readonly inputRate: number,
    private readonly chunkSamples = ASR_PCM_CHUNK_SAMPLES,
  ) {
    this.samples = new Float32Array(chunkSamples)
  }

  push(input: Float32Array): void {
    const resampled = resampleLinear(input, this.inputRate, ASR_PCM_TARGET_RATE, this.carry)
    this.ensureCapacity(this.buffered + resampled.length)
    this.samples.set(resampled, this.buffered)
    this.buffered += resampled.length
  }

  /**
   * 定时器被节流时（后台窗口、主线程繁忙）会一次涌进多批采样，缓冲区必须能长。
   * 丢采样等于送出的音频短于真实时间，积到超过 6 秒引擎就会主动断开。
   */
  private ensureCapacity(required: number): void {
    if (required <= this.samples.length) return
    let size = this.samples.length
    while (size < required) size *= 2
    const next = new Float32Array(size)
    next.set(this.samples.subarray(0, this.buffered))
    this.samples = next
  }

  get pendingSamples(): number {
    return this.buffered
  }

  /** 取出恰好一包。不足的补静音，绝不返回半包。 */
  takeChunk(): Uint8Array<ArrayBuffer> {
    const frame = new Float32Array(this.chunkSamples)
    const available = Math.min(this.buffered, this.chunkSamples)
    frame.set(this.samples.subarray(0, available))
    this.samples.copyWithin(0, available, this.buffered)
    this.buffered -= available
    return floatToInt16Le(frame)
  }

  /** 停止录音后把尾巴一次性取空，最后一帧才不会被丢掉。 */
  drain(): readonly Uint8Array<ArrayBuffer>[] {
    const chunks: Uint8Array<ArrayBuffer>[] = []
    while (this.buffered > 0) chunks.push(this.takeChunk())
    return chunks
  }
}
