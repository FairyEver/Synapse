import { formatMeetingClock, MEETING_SILENCE_HINT_MS } from "@synapse/shared"
import { useEffect, useRef, useState } from "react"

import { Button } from "@/components/ui/button"
import { requireSynapseBridge } from "@/lib/electron-bridge"
import { createChunkUploader, type ChunkUploader } from "./chunk-uploader"
import { createPeakScheduler, createPeakStore } from "./peak-store"
import { startRecorder, type Recorder } from "./recorder"
import { drawLiveWaveform } from "./waveform"

/**
 * 录音页。
 *
 * 这一屏只回答两个问题：**是不是在录**、**麦克风到底听没听见**。所以只有一个小波形、
 * 一个计时、取消和完成两个按钮。没有暂停——录音中途要暂停的需求远少于误触成本。
 *
 * 界面上**不出现任何上传相关的东西**：不显示进度、不显示分片、不显示状态。上传在后台，
 * 用户不需要知道它存在。
 */

export type MeetingRecordingFinalize = {
  readonly durationMs: number
  readonly peaks: string
}

type MeetingRecordingViewProps = {
  readonly recordingId: string
  readonly title: string
  readonly onFinalize: (input: MeetingRecordingFinalize) => Promise<void>
  readonly onCancel: () => Promise<void>
}

export function MeetingRecordingView(props: MeetingRecordingViewProps) {
  const { recordingId, title, onFinalize, onCancel } = props
  const canvasRef = useRef<HTMLCanvasElement | null>(null)
  const [elapsedMs, setElapsedMs] = useState(0)
  const [hint, setHint] = useState("")
  const [busy, setBusy] = useState(false)
  const [failure, setFailure] = useState<string | null>(null)

  // 录音相关的对象活在 ref 里：它们不该参与渲染，重建一次就等于重启一段录音。
  const storeRef = useRef(createPeakStore())
  const uploaderRef = useRef<ChunkUploader | null>(null)
  const recorderRef = useRef<Recorder | null>(null)
  const startedAtRef = useRef(0)
  const stateRef = useRef({ sawSound: false, lastSoundAt: 0, hasMicrophone: true })

  useEffect(() => {
    let disposed = false
    const store = storeRef.current
    const scheduler = createPeakScheduler()

    const uploader = createChunkUploader({
      uploadPart: async (partNumber, bytes) => {
        await requireSynapseBridge().meeting.recording.uploadPart({
          recordingId,
          partNumber,
          bytes: new Uint8Array(bytes),
        })
      },
      abort: async () => {
        await requireSynapseBridge().meeting.recording.cancel({ recordingId })
      },
    })
    uploaderRef.current = uploader

    void startRecorder({
      onChunk: (chunk) => {
        void uploader.append(chunk.bytes).catch((error: unknown) => {
          setFailure(error instanceof Error ? error.message : "录音分片发送失败。")
        })
      },
      onPeak: (amplitude) => {
        if (disposed) return
        const now = performance.now()
        if (!scheduler.due(now)) return
        store.push(amplitude)
      },
      onFirstSound: () => {
        stateRef.current.sawSound = true
      },
    })
      .then((recorder) => {
        if (disposed) {
          void recorder.stop()
          return
        }
        recorderRef.current = recorder
        startedAtRef.current = performance.now()
        stateRef.current.hasMicrophone = recorder.hasMicrophone
        stateRef.current.lastSoundAt = performance.now()
        if (!recorder.hasMicrophone) setHint("未取得麦克风权限，波形为示意")
      })
      .catch((error: unknown) => {
        setFailure(error instanceof Error ? error.message : "没有可用的麦克风。")
      })

    let frame = 0
    const draw = () => {
      const canvas = canvasRef.current
      if (canvas) drawLiveWaveform(canvas, store.snapshot())
      frame = requestAnimationFrame(draw)
    }
    frame = requestAnimationFrame(draw)

    const clock = window.setInterval(() => {
      if (startedAtRef.current === 0) return
      setElapsedMs(performance.now() - startedAtRef.current)
      const state = stateRef.current
      if (!state.hasMicrophone) return
      // 听到过一次就永远不再提示：开会中途弹一句「没有听到声音」只会打扰人。
      if (!state.sawSound && performance.now() - state.lastSoundAt > MEETING_SILENCE_HINT_MS) {
        setHint("没有听到声音")
      } else if (state.sawSound) {
        setHint("")
      }
    }, 200)

    return () => {
      disposed = true
      window.clearInterval(clock)
      cancelAnimationFrame(frame)
      void recorderRef.current?.stop()
      recorderRef.current = null
    }
  }, [recordingId])

  async function finish(): Promise<void> {
    if (busy) return
    setBusy(true)
    try {
      const recorder = recorderRef.current
      // 先停采集：最后一片要等它交出来，不然尾片会丢掉。
      await recorder?.stop()
      recorderRef.current = null
      const uploader = uploaderRef.current
      await uploader?.finish()
      const durationMs = Math.max(0, Math.round(performance.now() - startedAtRef.current))
      await onFinalize({ durationMs, peaks: storeRef.current.encode() })
    } catch (error) {
      setFailure(error instanceof Error ? error.message : "保存录音失败。")
      setBusy(false)
    }
  }

  async function cancel(): Promise<void> {
    if (busy) return
    setBusy(true)
    try {
      await recorderRef.current?.stop()
      recorderRef.current = null
      // 中止而不是删除：未完成的分块上传留在桶里的分片，删对象删不掉。
      await uploaderRef.current?.cancel()
      await onCancel()
    } catch (error) {
      setFailure(error instanceof Error ? error.message : "取消录音失败。")
      setBusy(false)
    }
  }

  return (
    <div className="flex flex-col items-center gap-6 py-14">
      <div className="flex flex-col items-center gap-1">
        <p className="text-sm text-muted-foreground">{title}</p>
        <p className="text-4xl font-medium tabular-nums">{formatMeetingClock(elapsedMs)}</p>
      </div>

      {/* 波形有自己的承载面，左侧还没长到的空位才读得出是「在长」而不是没画出来。 */}
      <div className="w-full max-w-xl rounded-lg border bg-card px-3">
        <canvas ref={canvasRef} className="h-16 w-full" aria-label="录音波形" />
      </div>

      <div className="flex flex-col items-center gap-1.5">
        {/* 高度固定：录音中途冒出「没有听到声音」时，下面的按钮不该跟着跳一下。 */}
        <p className="h-5 text-xs font-medium text-foreground">{hint}</p>
        <p className="text-xs text-muted-foreground">录音会保存，用于转写</p>
        {failure ? <p className="text-xs text-destructive">{failure}</p> : null}
      </div>

      <div className="flex items-center gap-3">
        <Button variant="outline" onClick={() => void cancel()} disabled={busy}>
          取消
        </Button>
        <Button onClick={() => void finish()} disabled={busy}>
          完成
        </Button>
      </div>
    </div>
  )
}
