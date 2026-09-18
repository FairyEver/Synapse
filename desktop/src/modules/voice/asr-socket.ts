import { AsrTranscriptAccumulator, type AsrTranscript } from "./asr-transcript"

/**
 * 连接腾讯云实时语音识别的 WebSocket。
 *
 * URL 由主进程签好带过来，这里不接触任何密钥。音频按 200ms 一包送：比实时快、或
 * 两包间隔超过 6 秒，引擎都会主动断开，所以送包节奏由调用方的定时器保证。
 */

export type AsrFailureKind = "network" | "server"

export type AsrSocketHandlers = {
  readonly onTranscript: (transcript: AsrTranscript) => void
  /** 服务端错误会带上它自己的 code，调用方据此判断重连有没有意义。 */
  readonly onFailure: (kind: AsrFailureKind, code?: number) => void
  /** 引擎确认收尾（final=1）或连接正常关闭。 */
  readonly onFinished: () => void
}

type AsrServerMessage = {
  code?: number
  final?: number
  result?: { slice_type?: number; index?: number; voice_text_str?: string }
}

export class AsrSocket {
  private readonly socket: WebSocket
  private readonly accumulator = new AsrTranscriptAccumulator()
  private readonly handlers: AsrSocketHandlers
  private closed = false
  private finished = false
  private failureReported = false

  constructor(url: string, handlers: AsrSocketHandlers) {
    this.handlers = handlers
    this.socket = new WebSocket(url)
    this.socket.onmessage = (event) => { this.handleMessage(event.data) }
    this.socket.onerror = () => { this.reportFailure("network") }
    this.socket.onclose = () => {
      if (this.closed) return
      // 先报失败再置 closed —— reportFailure 自己会看 closed，顺序反了就报不出去，
      // 界面会静静停住，看起来像"没反应"而不是"网络断了"。
      // 没走到 final 就断了，对用户来说就是"网络已断开"，不是正常结束。
      if (!this.finished) this.reportFailure("network")
      this.closed = true
      this.handlers.onFinished()
    }
  }

  get transcript(): AsrTranscript {
    return this.accumulator.snapshot()
  }

  /**
   * 握手完成、现在送音频引擎真的收得下。
   *
   * 在它变 true 之前送出去的包会被 `send` 丢掉，所以调用方拿它当"这条连接开始计时"
   * 的起点——引擎的 60 秒额度是从收到第一段采样开始算的，不是从 new WebSocket 算的。
   */
  get isOpen(): boolean {
    return this.socket.readyState === WebSocket.OPEN
  }

  send(chunk: Uint8Array<ArrayBuffer>): void {
    if (this.socket.readyState !== WebSocket.OPEN) return
    this.socket.send(chunk)
  }

  /** 告诉引擎音频送完了，等它把最后一句定稿回来。 */
  finish(): void {
    if (this.socket.readyState !== WebSocket.OPEN) return
    this.socket.send(JSON.stringify({ type: "end" }))
  }

  /** 用户取消：直接断，不等收尾。 */
  close(): void {
    this.closed = true
    this.socket.close()
  }

  private handleMessage(payload: unknown): void {
    if (typeof payload !== "string") return
    let message: AsrServerMessage
    try {
      message = JSON.parse(payload) as AsrServerMessage
    } catch {
      return
    }
    if (typeof message.code === "number" && message.code !== 0) {
      this.reportFailure("server", message.code)
      this.close()
      return
    }
    const result = message.result
    if (result && typeof result.voice_text_str === "string") {
      this.accumulator.apply({
        sliceType: result.slice_type ?? 2,
        index: result.index ?? 0,
        text: result.voice_text_str,
      })
      this.handlers.onTranscript(this.accumulator.snapshot())
    }
    if (message.final === 1) {
      this.finished = true
      this.handlers.onFinished()
    }
  }

  private reportFailure(kind: AsrFailureKind, code?: number): void {
    if (this.failureReported || this.closed) return
    this.failureReported = true
    this.handlers.onFailure(kind, code)
  }
}
