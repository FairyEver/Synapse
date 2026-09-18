import { createRendererLogger } from "@/app-shell/logging"
import { requireSynapseBridge } from "@/lib/electron-bridge"
import { AsrPcmChunker } from "./asr-pcm"
import {
  chunkRms,
  mergeTranscript,
  promoteSeam,
  shouldHandOver,
  shouldStartWarming,
  type AsrSeam,
} from "./asr-renewal"
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
/**
 * 换连接时等前一段定稿的上限。比 `FINALIZE_TIMEOUT_MS` 宽，因为这一步等的是引擎
 * 重跑最后一句：实测 1.03~1.21 秒，压在 1.2 秒上会刚好输给超时，把引擎改写好的那份
 * 丢掉。多等这一会儿用户看不见——接缝的文字早就发布出去了，只是颜色还没落定。
 */
const SETTLE_TIMEOUT_MS = 2_000

export type VoiceFailure = "network" | "silence" | "permission" | "unavailable"

export type VoiceSessionEvents = {
  readonly onTranscript: (transcript: AsrTranscript) => void
  readonly onFailure: (failure: VoiceFailure) => void
}

/**
 * 一次录音的完整生命周期：签发 URL → 开麦 → 建连 → 按 200ms 送包 → 收尾。
 *
 * 每次连接都换新的 voice_id，中断后旧的一律作废；签名只有 5 分钟有效期，用户停一
 * 会儿再点完成就可能已经过期，所以握手中断时换一条新签名重连一次——用户感知到的
 * 只是"卡了一下"。
 *
 * 一条连接也只能写 60 秒（`asr-renewal.ts` 里写着实测数据），所以说到 46 秒就开始
 * 预热下一条、在停顿处把音频原子地交给它，文本接着往下写。轮换**不经过失败路径**：
 * 用户全程看到的是同一次录音、同一段转写，界面上没有任何计时或上限提示。
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

  /** 换连接之前那一段已经冻结的文本。没有换过就是 null，走的是和从前一字不差的路径。 */
  private seam: AsrSeam | null = null
  /** 正在收尾的那条旧连接，只负责把最后一句定稿回来。 */
  private drain: AsrSocket | null = null
  private drainTimer: ReturnType<typeof setTimeout> | null = null
  private drainSettled: (() => void) | null = null
  /** 已经握手完、等着接棒的那条新连接。 */
  private warm: AsrSocket | null = null
  private warming = false
  private warmRetryAtMs = 0
  private warmBackoffMs = 1_000
  /**
   * 连接代号。`AsrSocket` 的 handlers 是构造时定死的，换不了接线，所以靠代号让旧连接
   * 的迟到回调（包括它自己关闭时报的那句「网络已断开」）失效。
   */
  private liveToken = 0
  private drainToken = 0
  private warmToken = 0
  private nextToken = 0
  /** 握手完成没有。握手之前送出去的包会被引擎丢掉，不计入它的 60 秒。 */
  private liveReady = false
  private connectedAtMs = 0

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
    this.nextToken += 1
    this.liveToken = this.nextToken
    this.socket = this.openSocket(signed.url, this.liveToken)
    this.liveReady = false
    this.connectedAtMs = Date.now()
    logger.info("Voice session connected.", { voiceId: signed.voiceId })
  }

  private openSocket(url: string, token: number): AsrSocket {
    return new AsrSocket(url, {
      onTranscript: (transcript) => { this.handleTranscript(transcript, token) },
      onFailure: (kind, code) => { this.handleSocketFailure(kind, code, token) },
      onFinished: () => { this.handleFinished(token) },
    })
  }

  private handleTranscript(transcript: AsrTranscript, token: number): void {
    if (token !== this.liveToken) return
    this.publish(mergeTranscript(this.seam, transcript))
  }

  /**
   * 发布转写。**永远是整体赋值，绝不发布空值**：界面一旦拿到空串就会退回占位、
   * 把确定键置灰，再等 3 秒还会误报「没有听到声音」。
   */
  private publish(transcript: AsrTranscript): void {
    this.transcript = transcript
    this.events.onTranscript(transcript)
  }

  private handleFinished(token: number): void {
    if (token === this.drainToken) {
      this.settleSeam()
      return
    }
    if (token === this.liveToken) this.finalize?.()
  }

  private handleSocketFailure(kind: "network" | "server", code: number | undefined, token: number): void {
    if (this.stopped) return
    if (token !== this.liveToken) {
      // 预热失败不该冒到界面上：用户什么都没做错，而且主连接还在正常工作。
      if (token === this.warmToken) {
        logger.warn("ASR warm connection failed.", { kind, code })
        this.dropWarm()
      }
      // drain 收到的 1006 也一样：那是我们主动让它收尾的，不是断网。
      return
    }
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
      this.dropWarm()
      this.socket = null
      void this.connect().catch(() => { this.reportFailure("network") })
      return
    }
    this.dropWarm()
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
    this.sendTimer = setInterval(() => { this.sendOneChunk() }, SEND_INTERVAL_MS)

    // 这一拍只用来判断「多久没出字」。它不再往上报耗时：录音界面里没有计时，
    // 每 100ms 推一次 state 只会让 composer 白重渲染。
    this.tickTimer = setInterval(() => {
      const elapsedMs = Date.now() - this.startedAt
      if (!this.transcript.combined && elapsedMs > SILENCE_HINT_MS) {
        this.events.onFailure("silence")
      }
    }, TIMER_TICK_MS)
  }

  /**
   * 一拍送一包。**这一拍只取一次采样**，取完立刻决定它去哪条连接——两条连接各自
   * 收到的是同一路音频的前后两段，既不重也不漏。
   */
  private sendOneChunk(): void {
    // 采样不够时 takeChunk 会补静音，送出去的音频时长因此严格等于真实时间。
    const chunk = this.chunker?.takeChunk() ?? new Uint8Array()
    const socket = this.socket
    if (!socket) return

    if (!this.liveReady) {
      if (!socket.isOpen) {
        socket.send(chunk)
        return
      }
      // 握手从这一刻起才真正成立。之前那几包引擎收不到，也不该算进它的 60 秒。
      this.liveReady = true
      this.connectedAtMs = Date.now()
    }

    const ageMs = Date.now() - this.connectedAtMs
    // 空包不是静音测量结果，不能拿它当「用户停下来了」把连接切走。
    const rms = chunk.length > 0 ? chunkRms(chunk) : Number.POSITIVE_INFINITY
    if (this.warm?.isOpen && shouldHandOver(rms, ageMs)) {
      this.handOver(chunk)
      return
    }
    socket.send(chunk)
    if (!this.warm && shouldStartWarming(ageMs)) void this.startWarming()
  }

  // MARK: - 接棒

  /** 预热下一条连接，让它到点就能立刻接手。失败就退避重试，主连接一直照常工作。 */
  private async startWarming(): Promise<void> {
    if (this.warming || this.warm || Date.now() < this.warmRetryAtMs) return
    this.warming = true
    this.nextToken += 1
    this.warmToken = this.nextToken
    const token = this.warmToken
    try {
      const signed = await requireSynapseBridge().voice.session.sign({})
      if (this.stopped || token !== this.warmToken) return
      this.warm = this.openSocket(signed.url, token)
      logger.info("ASR warm connection opening.", { voiceId: signed.voiceId })
    } catch (error) {
      if (token !== this.warmToken) return
      logger.warn("ASR warm connection signing failed.", { error: String(error) })
      this.dropWarm()
    }
  }

  /**
   * 把音频原子地交给暖连接：本拍起新连接收，旧连接只管把最后一句定稿回来。
   *
   * **全同步**，一次 await 都没有——中间让出主线程，后面的拍就会插进来，同一包音频
   * 可能被决定两次。
   */
  private handOver(chunk: Uint8Array<ArrayBuffer>): void {
    const next = this.warm
    if (!next) return
    const ageMs = Date.now() - this.connectedAtMs
    const retiring = this.socket
    const warmToken = this.warmToken

    // 冻结的是旧连接**已经吐出来的全部文本**，不是只有 stable：这个引擎约 60 秒才
    // 断一次句，实测轮换点上 stable 基本是空的，整段前缀都在 unstable 里。
    this.seam = { text: retiring?.transcript.combined.trim() ?? "", provisional: true }
    this.drain = retiring
    this.drainToken = this.liveToken
    retiring?.finish()
    // 独立定时器，绝不碰 `this.finalize` —— 那是单槽的，两处都去 await 它，后进去的
    // 会把先前的 continuation 顶掉，被顶掉的那个永远等不到唤醒（是挂住，不是报错）。
    const drainToken = this.drainToken
    this.drainTimer = setTimeout(() => {
      if (this.drainToken !== drainToken) return
      this.settleSeam()
    }, SETTLE_TIMEOUT_MS)

    this.socket = next
    this.liveToken = warmToken
    this.liveReady = true
    this.connectedAtMs = Date.now()
    // 先把它从暖连接的槽位上摘下来再清槽位：`clearWarm` 会关掉槽位上那条连接，
    // 而它现在正是刚接过来的活连接——不清空引用就把刚接棒的线路掐了。
    this.warm = null
    this.clearWarm()
    this.warmBackoffMs = 1_000
    this.warmRetryAtMs = 0

    this.publish(mergeTranscript(this.seam, next.transcript))
    next.send(chunk)
    logger.info("ASR connection handed over.", { frozen: this.seam.text.length, ageMs })
  }

  /**
   * 接缝定稿：拿引擎改写好的那份**换掉**暂定的那份（实测 1.03~1.21 秒后回来，
   * 补完了半截词、顺带改掉了错字）。到点还没回来就用手上的，总比一直不定稿强。
   */
  private settleSeam(): void {
    // 先把还在等接缝的人放走：下面可能要提前返回，不能让 finish() 挂在这里。
    this.drainSettled?.()
    this.drainSettled = null

    const seam = this.seam
    const retiring = this.drain
    if (!seam?.provisional || !retiring) return
    this.drainToken = 0
    this.drain = null
    if (this.drainTimer) { clearTimeout(this.drainTimer); this.drainTimer = null }
    retiring.close()

    this.seam = promoteSeam(seam, retiring.transcript.combined.trim())
    if (this.socket) this.publish(mergeTranscript(this.seam, this.socket.transcript))
    logger.info("ASR seam settled.", { length: this.seam.text.length })
  }

  /** 暖连接废了：关掉它，并退避一段时间再试，免得一路失败一路重签。 */
  private dropWarm(): void {
    this.clearWarm()
    this.warmRetryAtMs = Date.now() + this.warmBackoffMs
    this.warmBackoffMs = Math.min(this.warmBackoffMs * 2, 4_000)
  }

  /**
   * 关掉暖连接。正在签名的那一次会自己作废——`clearWarm` 把代号清零了，签名回来
   * 时代号对不上，就直接丢掉，不会再建出连接来。
   */
  private clearWarm(): void {
    this.warm?.close()
    this.warm = null
    this.warmToken = 0
    this.warming = false
  }

  /** 收尾并返回要落到输入框的文本。没识别到内容时返回空串。 */
  async finish(): Promise<string> {
    if (this.stopped) return ""
    const socket = this.socket
    if (this.sendTimer) { clearInterval(this.sendTimer); this.sendTimer = null }
    if (this.tickTimer) { clearInterval(this.tickTimer); this.tickTimer = null }
    // 收尾前不再预热，也把已经暖好的那条关掉：它没收到过音频，留着只是一条空连接。
    this.clearWarm()
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
    if (this.drain) {
      // 接缝还没定稿。它自己的定时器最迟 SETTLE_TIMEOUT_MS 后会叫醒这里——那时候
      // 定稿版已经并进 transcript 了，不等就会把接缝那一整段前缀丢掉。
      await new Promise<void>((resolve) => { this.drainSettled = resolve })
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
    this.drainSettled?.()
    this.drainSettled = null
    if (this.sendTimer) { clearInterval(this.sendTimer); this.sendTimer = null }
    if (this.tickTimer) { clearInterval(this.tickTimer); this.tickTimer = null }
    if (this.drainTimer) { clearTimeout(this.drainTimer); this.drainTimer = null }
    this.drain?.close()
    this.drain = null
    this.drainToken = 0
    this.clearWarm()
    this.seam = null
    this.liveReady = false
    void this.capture.stop()
    this.socket?.close()
    this.socket = null
  }
}
