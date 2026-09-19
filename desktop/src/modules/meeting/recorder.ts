import { MEETING_AUDIO_BITS_PER_SECOND, MEETING_CHUNK_MS, MEETING_PEAK_MS } from "@synapse/shared"

import { amplitudeFromTimeDomain, LOUD_AMPLITUDE } from "./peak-store"

/**
 * 麦克风录音。
 *
 * 与 `modules/voice/` 那条实时识别链路**没有任何共用代码**，这是有意的：那条是为
 * 「按住说几十秒」设计的，音频只在内存里过一遍就发走、不落盘、还必须全程在线。录音
 * 要的是相反的东西——长时间、要落盘、录完可以关机。
 *
 * 一路麦流同时喂给两个去处：编码器（产出可上传的音频分片）和分析节点（画波形）。
 * **不要开两次 `getUserMedia`**：那会拿到两条不同的流，波形和音频对不上，而且第二
 * 次权限弹窗在某些系统上根本不出现。
 */

/** 麦克风权限被拒。不阻断录音，界面走示意波形并明说。 */
export class MicrophonePermissionError extends Error {
  readonly code = "meeting_microphone_permission"

  constructor() {
    super("未取得麦克风权限，波形为示意")
    this.name = "MicrophonePermissionError"
  }
}

export class MicrophoneUnavailableError extends Error {
  readonly code = "meeting_microphone_unavailable"

  constructor() {
    super("没有可用的麦克风。")
    this.name = "MicrophoneUnavailableError"
  }
}

/**
 * 优先 m4a（AAC），这是识别引擎接受的格式。webkit/opus 只是兜底：它编出来的东西
 * 识别引擎不认，走到这条路上转写会失败并显示原因，而不是悄悄出一份空逐字稿。
 */
const MIME_CANDIDATES = [
  "audio/mp4;codecs=mp4a.40.2",
  "audio/mp4",
  "audio/webm;codecs=opus",
  "audio/webm",
] as const

export type RecorderChunk = {
  readonly bytes: ArrayBuffer
  readonly mimeType: string
}

export type RecorderHandlers = {
  /** 每 `MEETING_CHUNK_MS` 产出一个音频分片。 */
  readonly onChunk: (chunk: RecorderChunk) => void
  /** 每 `MEETING_PEAK_MS` 产出一个归一化振幅。 */
  readonly onPeak: (amplitude: number) => void
  /** 第一次听到声音时回调一次，用于撤掉无声提示。 */
  readonly onFirstSound?: () => void
}

export type Recorder = {
  /** 实际编码出来的格式。识别引擎只认 m4a，走到兜底格式时转写会失败。 */
  readonly mimeType: string
  readonly hasMicrophone: boolean
  stop(): Promise<void>
}

function pickMimeType(): string | null {
  if (typeof MediaRecorder === "undefined") return null
  for (const candidate of MIME_CANDIDATES) {
    if (MediaRecorder.isTypeSupported(candidate)) return candidate
  }
  return null
}

/**
 * 打开麦克风并开始录音。
 *
 * 拿不到权限**不抛错**：界面要继续可用，波形退化成示意，并且明说这件事。让用户对着
 * 一个「点了没反应」的按钮说话，比告诉他麦克风没开更糟。
 */
export async function startRecorder(handlers: RecorderHandlers): Promise<Recorder> {
  let stream: MediaStream | null = null
  let hasMicrophone = false
  try {
    stream = await navigator.mediaDevices.getUserMedia({
      audio: { channelCount: 1, echoCancellation: true, noiseSuppression: true },
    })
    hasMicrophone = true
  } catch (error) {
    if (error instanceof DOMException && (error.name === "NotAllowedError" || error.name === "SecurityError")) {
      // 明确是权限问题：界面照常录音界面，只是没有真波形。
      stream = null
    } else if (error instanceof DOMException && error.name === "NotFoundError") {
      throw new MicrophoneUnavailableError()
    } else if (error instanceof Error && !(error instanceof DOMException)) {
      throw error
    }
  }

  const audioContext = new AudioContext()
  const analyser = audioContext.createAnalyser()
  analyser.fftSize = 2048
  const source = stream ? audioContext.createMediaStreamSource(stream) : null
  source?.connect(analyser)

  const mimeType = pickMimeType()
  let mediaRecorder: MediaRecorder | null = null
  // 每次交片都是异步的（Blob → ArrayBuffer）。停的时候必须等它们全部落地，否则
  // 最后一片——也就是「完成」时要补的那个尾片——会刚好丢在收尾的空隙里。
  const pendingChunks = new Set<Promise<void>>()
  if (stream && mimeType) {
    mediaRecorder = new MediaRecorder(stream, { mimeType, audioBitsPerSecond: MEETING_AUDIO_BITS_PER_SECOND })
    mediaRecorder.ondataavailable = (event) => {
      if (!event.data || event.data.size === 0) return
      const task = event.data
        .arrayBuffer()
        .then((bytes) => {
          handlers.onChunk({ bytes, mimeType })
        })
        .catch(() => undefined)
        .finally(() => {
          pendingChunks.delete(task)
        })
      pendingChunks.add(task)
    }
    mediaRecorder.start(MEETING_CHUNK_MS)
  }

  let frame = 0
  let lastPeakAt = 0
  let sawSound = false
  let stopped = false
  const buffer = new Float32Array(analyser.fftSize)

  const tick = () => {
    if (stopped) return
    const now = performance.now()
    if (now - lastPeakAt >= MEETING_PEAK_MS) {
      lastPeakAt = now
      analyser.getFloatTimeDomainData(buffer)
      const amplitude = hasMicrophone ? amplitudeFromTimeDomain(buffer) : 0
      handlers.onPeak(amplitude)
      if (!sawSound && amplitude > LOUD_AMPLITUDE) {
        sawSound = true
        handlers.onFirstSound?.()
      }
    }
    frame = requestAnimationFrame(tick)
  }
  frame = requestAnimationFrame(tick)

  return {
    mimeType: mimeType ?? "",
    hasMicrophone,
    async stop() {
      if (stopped) return
      stopped = true
      cancelAnimationFrame(frame)
      const recorder = mediaRecorder
      mediaRecorder = null
      if (recorder && recorder.state !== "inactive") {
        await new Promise<void>((resolve) => {
          // `stop` 事件在最后一次 `dataavailable` 之后触发，所以等它就等于等到了尾片。
          recorder.addEventListener("stop", () => resolve(), { once: true })
          recorder.stop()
        })
      }
      // 再等交片本身的异步转换走完，调用方拿到的就是完整的最后一片。
      await Promise.all([...pendingChunks])
      stream?.getTracks().forEach((track) => track.stop())
      stream = null
      await audioContext.close().catch(() => undefined)
    },
  }
}
