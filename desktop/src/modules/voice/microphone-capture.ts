/**
 * 麦克风采集。
 *
 * 优先让 AudioContext 直接以 16k 建图——重采样交给 Web Audio 做，它在首字延迟的
 * 关键路径上，手写循环既慢又容易出错。拿不到 16k 时由 AsrPcmChunker 兜底重采样。
 *
 * 用 ScriptProcessorNode 而不是 AudioWorklet：AudioWorklet 的 addModule 走模块
 * 脚本加载，生产环境渲染进程是 file:// 页面，跨源限制会让它加载失败，而这一点在
 * 开发环境（http://localhost）看不出来。ScriptProcessor 已废弃但无此限制，且我们
 * 本来就是按 200ms 切帧，它被诟病的实时监听延迟在这里无关紧要。
 */

export class MicrophonePermissionError extends Error {
  constructor() {
    super("麦克风权限未开启。")
    this.name = "MicrophonePermissionError"
  }
}

export type MicrophoneCaptureHandlers = {
  readonly onSamples: (samples: Float32Array) => void
  /** 设备被拔掉、来电话、切后台等导致轨道结束。 */
  readonly onEnded: () => void
}

/** ScriptProcessor 的缓冲区：1024 帧约 64ms（16k）或 21ms（48k），延迟足够小。 */
const PROCESSOR_BUFFER_SIZE = 1024

export class MicrophoneCapture {
  private context: AudioContext | null = null
  private stream: MediaStream | null = null
  private source: MediaStreamAudioSourceNode | null = null
  private processor: ScriptProcessorNode | null = null

  /** 建图时实际拿到的采样率，交给 chunker 决定要不要重采样。 */
  get sampleRate(): number {
    return this.context?.sampleRate ?? 0
  }

  async start(handlers: MicrophoneCaptureHandlers): Promise<void> {
    let stream: MediaStream
    try {
      stream = await navigator.mediaDevices.getUserMedia({
        audio: { channelCount: 1, echoCancellation: true, noiseSuppression: true },
      })
    } catch (error) {
      if (error instanceof DOMException && error.name === "NotAllowedError") {
        throw new MicrophonePermissionError()
      }
      throw error
    }
    this.stream = stream
    const context = new AudioContext({ sampleRate: 16_000 })
    this.context = context
    this.source = context.createMediaStreamSource(stream)
    const processor = context.createScriptProcessor(PROCESSOR_BUFFER_SIZE, 1, 1)
    this.processor = processor
    processor.onaudioprocess = (event) => {
      const channel = event.inputBuffer.getChannelData(0)
      // 必须拷一份：这个 buffer 下一帧就会被复用。
      handlers.onSamples(new Float32Array(channel))
    }
    this.source.connect(processor)
    // 脚本处理器只有接到目的地才会被驱动；输出静音，不会回放麦克风。
    processor.connect(context.destination)

    for (const track of stream.getAudioTracks()) {
      track.onended = () => { handlers.onEnded() }
    }
    // 录音态绝不能弹键盘，所以不给输入框留焦点；这里只需要音频轨道。
    await context.resume()
  }

  async stop(): Promise<void> {
    if (this.processor) {
      this.processor.onaudioprocess = null
      this.processor.disconnect()
      this.processor = null
    }
    this.source?.disconnect()
    this.source = null
    for (const track of this.stream?.getTracks() ?? []) track.stop()
    this.stream = null
    const context = this.context
    this.context = null
    if (context && context.state !== "closed") await context.close()
  }
}
