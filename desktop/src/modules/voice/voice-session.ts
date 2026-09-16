import { createRendererLogger } from "@/app-shell/logging"
import { requireSynapseBridge } from "@/lib/electron-bridge"
import { AsrPcmChunker } from "./asr-pcm"
import { AsrSocket } from "./asr-socket"
import { EMPTY_TRANSCRIPT, type AsrTranscript } from "./asr-transcript"
import { MicrophoneCapture } from "./microphone-capture"

const logger = createRendererLogger("voice")

/** 送包节奏。快于实时、或两包间隔超过 6 秒，引擎都会主动断开。 */
const SEND_INTERVAL_MS = 200
/** 约 3 秒没有出字就提示「没有听到声音」，但不自动结束录音。 */
const SILENCE_HINT_MS = 3_000
/** 点完成后等引擎把最后一句定稿回来的上限。 */
const FINALIZE_TIMEOUT_MS = 1_200
const TIMER_TICK_MS = 100
/** 腾讯云的「鉴权失败」。签名过期就是这个码，换一条新签名重连一次就好。 */
const ASR_AUTH_REJECTED_CODE = 4002

export type VoiceFailure = "network" | "silence" | "permission" | "unavailable"

export type VoiceSessionEvents = {
  readonly onTranscript: (transcript: AsrTranscript) => void
  readonly onElapsed: (elapsedMs: number) => void
  readonly onFailure: (failure: VoiceFailure) => void
}

/**
 * 一次录音的完整生命周期：签发 URL → 开麦 → 建连 → 按 200ms 送包 → 收尾。
 *
 * 每次连接都换新的 voice_id，中断后旧的一律作废；签名只有 5 分钟有效期，用户停一
 * 会儿再点完成就可能已经过期，所以握手中断时换一条新签名重连一次——用户感知到的
 * 只是"卡了一下"。
 */
export class VoiceSession {
  private readonly capture: MicrophoneCapture
  private readonly events: VoiceSessionEvents
  private chunker: AsrPcmChunker | null = null
  private socket: AsrSocket | null = null
  private sendTimer: ReturnType<typeof setInterval> | null = null
  private tickTimer: ReturnType<typeof setInterval> | null = null
  private transcript: AsrTranscript = EMPTY_TRANSCRIPT
  private finalize: (() => void) | null = null
  private stopped = false
  private retried = false
  private readonly startedAt = Date.now()

  private constructor(events: VoiceSessionEvents, capture: MicrophoneCapture) {
    this.events = events
    this.capture = capture
  }

  /**
   * 开麦并建连。权限被拒或未配置时抛错，调用方据此决定回到 idle 还是提示去设置。
   */
  static async begin(events: VoiceSessionEvents): Promise<VoiceSession> {
    const capture = new MicrophoneCapture()
    const session = new VoiceSession(events, capture)
    try {
      await capture.start({
        onSamples: (samples) => { session.pushSamples(samples) },
        onEnded: () => { session.reportFailure("network") },
      })
      // 采样率要等 AudioContext 建好才知道，重采样比由此决定。
      session.chunker = new AsrPcmChunker(capture.sampleRate)
      await session.connect()
    } catch (error) {
      session.dispose()
      throw error
    }
    session.startTimers()
    return session
  }

  private async connect(): Promise<void> {
    const signed = await requireSynapseBridge().voice.session.sign({})
    if (this.stopped) return
    this.socket = new AsrSocket(signed.url, {
      onTranscript: (transcript) => {
        this.transcript = transcript
        this.events.onTranscript(transcript)
      },
      onFailure: (kind, code) => { this.handleSocketFailure(kind, code) },
      onFinished: () => { this.finalize?.() },
    })
    logger.info("Voice session connected.", { voiceId: signed.voiceId })
  }

  private handleSocketFailure(kind: "network" | "server", code?: number): void {
    if (this.stopped) return
    /*
     * 只有「换个签名可能就好」的失败才值得重连一次：传输中断，或者鉴权被拒
     * （签名过期就是这个样子）。服务端说服务没开通之类的错误，重连只是原地打转，
     * 不如直接把话说清楚。
     *
     * 已经听到内容了也不再自动重连：重连丢上下文，不如把已识别的部分留着让用户
     * 决定重试还是直接完成。
     */
    const worthRetrying = kind === "network" || code === ASR_AUTH_REJECTED_CODE
    if (worthRetrying && !this.retried && !this.transcript.combined) {
      this.retried = true
      this.socket = null
      void this.connect().catch(() => { this.reportFailure("network") })
      return
    }
    this.reportFailure(kind === "network" ? "network" : "unavailable")
  }

  private reportFailure(failure: VoiceFailure): void {
    if (this.stopped) return
    if (this.sendTimer) { clearInterval(this.sendTimer); this.sendTimer = null }
    this.events.onFailure(failure)
  }

  private pushSamples(samples: Float32Array): void {
    this.chunker?.push(samples)
  }

  private startTimers(): void {
    this.sendTimer = setInterval(() => {
      // 采样不够时 takeChunk 会补静音，送出去的音频时长因此严格等于真实时间。
      this.socket?.send(this.chunker?.takeChunk() ?? new Uint8Array())
    }, SEND_INTERVAL_MS)

    this.tickTimer = setInterval(() => {
      const elapsedMs = Date.now() - this.startedAt
      this.events.onElapsed(elapsedMs)
      if (!this.transcript.combined && elapsedMs > SILENCE_HINT_MS) {
        this.events.onFailure("silence")
      }
    }, TIMER_TICK_MS)
  }

  /** 收尾并返回要落到输入框的文本。没识别到内容时返回空串。 */
  async finish(): Promise<string> {
    if (this.stopped) return ""
    const socket = this.socket
    if (this.sendTimer) { clearInterval(this.sendTimer); this.sendTimer = null }
    if (this.tickTimer) { clearInterval(this.tickTimer); this.tickTimer = null }
    // 收尾前把缓冲里剩的采样送出去，最后一帧才不会被丢掉。
    for (const chunk of this.chunker?.drain() ?? []) socket?.send(chunk)
    socket?.finish()
    await this.capture.stop()
    if (socket) {
      // 等引擎把最后一句定稿回来，超时就用手上已有的结果。
      await new Promise<void>((resolve) => {
        this.finalize = resolve
        setTimeout(resolve, FINALIZE_TIMEOUT_MS)
      })
    }
    const text = this.transcript.combined.trim()
    this.dispose()
    return text
  }

  /** 用户取消：丢弃全部文本，含已定稿部分。 */
  cancel(): void {
    this.dispose()
  }

  private dispose(): void {
    this.stopped = true
    this.finalize = null
    if (this.sendTimer) { clearInterval(this.sendTimer); this.sendTimer = null }
    if (this.tickTimer) { clearInterval(this.tickTimer); this.tickTimer = null }
    void this.capture.stop()
    this.socket?.close()
    this.socket = null
  }
}
