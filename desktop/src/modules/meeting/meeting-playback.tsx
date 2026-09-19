import { decodeMeetingPeaks, formatMeetingClock, meetingPlaybackProgress } from "@synapse/shared"
import { Pause, Play, RotateCcw, RotateCw } from "lucide-react"
import { useCallback, useEffect, useRef, useState } from "react"

import { Button } from "@/components/ui/button"
import { Spinner } from "@/components/ui/spinner"
import { requireSynapseBridge } from "@/lib/electron-bridge"
import { cn } from "@/lib/utils"
import type { SynapseMeetingAudioEnsureResult } from "@/types/meeting"
import { useMeetingAudioReadySubscription } from "./hooks/use-meetings"
import { drawPlaybackWaveform, normalizePeaks, playbackPositionFromClick } from "./waveform"

/**
 * 回放。
 *
 * 一条可点击定位的波形加一个播放键，就够用了；再加一对 ±15 秒——录音动辄四十分钟以
 * 上，回退重听是刚需。仍然**没有**时间刻度尺、缩略图、倍速，也没有播放时跟随高亮的
 * 「当前这句」。
 *
 * 这条波形是**整段铺满宽度**的，与录音页那条滚动窗口在行为上刻意不同。
 *
 * 音频优先走本机那一份：听过一次之后，第二次点开连一次网络请求都不发。**界面上看不出
 * 这件事**——不写任何描述存储状态的字样，只有「还没到本机」时那行「正在下载」。
 */

/** 一次快退/快进多少。 */
const SKIP_MS = 15_000

/**
 * 载入态转满多久补一个「重试」。
 *
 * 真的一点网都没有时它会一直转下去——因为网一回来确实会自己接着下完，所以**不该说成
 * 失败**。但它也不能永远只转不说话，所以给一个出口。那个按钮只是催一下，不取代后台的
 * 自动重试。
 */
const LOAD_TIMEOUT_MS = 10_000

/**
 * 语音视图这一屏处在哪个阶段。
 *
 * `unknown` 是「还没问出本机有没有这份音频」，**必须和载入中分开**。React 的 effect 在
 * 第一次绘制之后才跑，所以进这一屏时至少要画一帧；把初始值写成载入中，缓存命中的那条也
 * 会先闪一下「正在下载」——而「第二次点开不出现正在下载」正是这次要的结果。这一帧什么都不
 * 说：播放器该有的样子都在，只是播放键还没到能按的时候。
 */
type AudioPhase = "unknown" | "loading" | "ready"

type MeetingPlaybackProps = {
  readonly meetingId: string
  readonly durationMs: number
  /** 语音视图现在是不是看得见。切回来时画布宽度才有值，要按这个重画一次。 */
  readonly visible: boolean
}

export function MeetingPlayback(props: MeetingPlaybackProps) {
  const { meetingId, durationMs } = props
  const canvasRef = useRef<HTMLCanvasElement | null>(null)
  const audioRef = useRef<HTMLAudioElement | null>(null)
  /** 绘制用的是 0-1 的振幅；服务端存的是 0-255 的字节，取值时就还原。 */
  const peaksRef = useRef<readonly number[]>([])
  const [url, setUrl] = useState<string | null>(null)
  const [phase, setPhase] = useState<AudioPhase>("unknown")
  const [timedOut, setTimedOut] = useState(false)
  const [playing, setPlaying] = useState(false)
  const [positionMs, setPositionMs] = useState(0)
  const [peaksLoaded, setPeaksLoaded] = useState(false)
  const loading = phase === "loading"

  const applyAudioState = useCallback((result: SynapseMeetingAudioEnsureResult) => {
    if (result.state === "ready") {
      setUrl(result.url)
      setPhase("ready")
      return
    }
    if (result.state === "downloading") {
      setPhase("loading")
      // 「不可用」什么都不做——那一屏由详情自己渲染成「录音已删除」，这里再画一个状态
      // 只会跟它抢。
    }
  }, [])

  // 换一条录音就从零开始。**只跟 meetingId 走**：切「语音 / 文字」不能走这里，播放要连着
  // 不断（两个视图都挂着就是为了这个），所以两件事得分开成两个 effect。
  useEffect(() => {
    setUrl(null)
    setPhase("unknown")
    setTimedOut(false)
  }, [meetingId])

  // 本机有没有这份音频：有就直接用它，没有就起一次后台下载（幂等，重复叫不会起第二个）。
  //
  // **只在语音视图真的在眼前时才问。** 视图切换是粘性的，而播放器为了不打断播放一直挂
  // 着——不看这一屏也照样问一次，就等于给「只用文字」的人偷偷下一份音频，正好是产品口径
  // 里「不做后台预取」要挡的事。`phase !== "unknown"` 是这道闸的另一半：切回语音时重跑
  // 到这里，已经就绪的那条什么都不做，播放不受影响。
  useEffect(() => {
    if (!props.visible || phase !== "unknown") return
    let disposed = false
    void requireSynapseBridge()
      .meeting.audio
      .ensure({ meetingId })
      .then((result) => {
        if (!disposed) applyAudioState(result)
      })
      .catch(() => {
        // 连主进程都没问到，是极少见的内部故障。进载入态：转满 10 秒用户能催一次，而主
        // 进程那边的自动重试照旧跑，网回来会推事件过来。这里**不写成失败**。
        if (!disposed) setPhase("loading")
      })
    return () => {
      disposed = true
    }
  }, [meetingId, props.visible, phase, applyAudioState])

  // 音频落到本机就换地址。用户不点「重试」也能等到这一步。
  useMeetingAudioReadySubscription(meetingId, (event) => {
    applyAudioState({ state: "ready", url: event.url })
  })

  useEffect(() => {
    let disposed = false
    void requireSynapseBridge()
      .meeting.entry.peaks({ meetingId })
      .then((peaks) => {
        if (disposed) return
        peaksRef.current = normalizePeaks(decodeMeetingPeaks(peaks.peaks))
        setPeaksLoaded(true)
      })
      .catch(() => {
        // 波形拿不到就画一条平线，播放本身不受影响。
        if (disposed) return
        peaksRef.current = []
        setPeaksLoaded(true)
      })
    return () => {
      disposed = true
    }
  }, [meetingId])

  // 换了另一条录音就从零开始：位置是上一条的，留着会把播放头画在错误的地方。
  useEffect(() => {
    setPositionMs(0)
    setPlaying(false)
  }, [meetingId])

  // 转满 10 秒就把「重试」露出来。**只多给一个按钮**，不取消后台下载、不改任何状态。
  // 用户按下它不会让计时重来，所以那行字不会闪回去。
  useEffect(() => {
    if (!loading) return
    const timer = window.setTimeout(() => setTimedOut(true), LOAD_TIMEOUT_MS)
    return () => window.clearTimeout(timer)
  }, [loading, meetingId])

  const progress = meetingPlaybackProgress(positionMs, durationMs)

  useEffect(() => {
    const canvas = canvasRef.current
    // 藏起来的时候画布宽高是 0，画不出东西；切回来时 visible 变化会再走一遍这里。
    if (!canvas || !props.visible) return
    const redraw = () => drawPlaybackWaveform(canvas, peaksRef.current, { progress, dimmed: loading })
    redraw()
    window.addEventListener("resize", redraw)
    return () => window.removeEventListener("resize", redraw)
  }, [peaksLoaded, loading, url, progress, props.visible])

  function toggle(): void {
    const audio = audioRef.current
    if (!audio) return
    if (audio.paused) {
      void audio.play().catch(() => undefined)
    } else {
      audio.pause()
    }
  }

  function seek(target: number): void {
    const audio = audioRef.current
    if (!audio) return
    const clamped = Math.max(0, Math.min(durationMs, target))
    audio.currentTime = clamped / 1000
    setPositionMs(clamped)
  }

  /** 催一下。主进程那边是幂等的：已经在下的不会被起第二个。 */
  function retryDownload(): void {
    void requireSynapseBridge()
      .meeting.audio
      .ensure({ meetingId })
      .then(applyAudioState)
      .catch(() => {
        // 同上：问不到就继续等，界面照旧停在「正在下载」。
      })
  }

  function seekFromClick(event: React.MouseEvent<HTMLCanvasElement>): void {
    const canvas = canvasRef.current
    if (!canvas) return
    const bounds = canvas.getBoundingClientRect()
    seek(playbackPositionFromClick(event.clientX - bounds.left, bounds.width, durationMs))
  }

  return (
    <div className="space-y-2.5">
      <div className="overflow-hidden rounded-lg border bg-card px-2.5">
        {/* 播放头按这个容器算比例，所以它必须紧包着画布，不能把外框的内边距算进去。 */}
        <div className="relative">
          <canvas
            ref={canvasRef}
            onClick={seekFromClick}
            data-track="meeting.playback.seek"
            data-track-native="true"
            className="h-32 w-full cursor-pointer"
            aria-label="录音波形，可点击定位"
          />
          {peaksRef.current.length > 0 && !loading ? (
            <span
              className="pointer-events-none absolute inset-y-0 w-px bg-foreground"
              style={{ left: `${progress * 100}%` }}
              aria-hidden
            />
          ) : null}
        </div>
      </div>

      <div className="flex items-center gap-2">
        <Button
          variant="ghost"
          size="sm"
          onClick={() => seek(positionMs - SKIP_MS)}
          disabled={!url}
          aria-label="后退 15 秒"
          title="后退 15 秒"
          className="pl-2 pr-2.5"
        >
          <RotateCcw />15
        </Button>
        <Button variant="ghost" size="icon" onClick={toggle} disabled={!url} aria-label={playing ? "暂停" : "播放"}>
          <PlayToggleIcon playing={playing} />
        </Button>
        <Button
          variant="ghost"
          size="sm"
          onClick={() => seek(positionMs + SKIP_MS)}
          disabled={!url}
          aria-label="前进 15 秒"
          title="前进 15 秒"
          className="pl-2.5 pr-2"
        >
          15<RotateCw />
        </Button>
        <span className="ml-1 text-xs tabular-nums">
          <span className="text-foreground">{formatMeetingClock(positionMs)}</span>
          <span className="text-muted-foreground"> / {formatMeetingClock(durationMs)}</span>
        </span>
      </div>

      {loading ? (
        <div className="space-y-1.5">
          <div className="flex items-center gap-2 text-xs text-muted-foreground">
            <Spinner className="size-3.5" />
            <span>正在下载</span>
          </div>
          {timedOut ? (
            <Button variant="ghost" size="sm" className="h-7 px-2" onClick={retryDownload}>
              重试
            </Button>
          ) : null}
        </div>
      ) : null}

      {url ? (
        <audio
          ref={audioRef}
          src={url}
          preload="metadata"
          onPlay={() => setPlaying(true)}
          onPause={() => setPlaying(false)}
          onEnded={() => setPlaying(false)}
          onTimeUpdate={(event) => setPositionMs(Math.round(event.currentTarget.currentTime * 1000))}
          className="hidden"
        />
      ) : null}
    </div>
  )
}

/**
 * 播放 / 暂停。
 *
 * 两个图标都留在 DOM 里交叉淡入，而不是换一个渲染一个——直接切换会硬跳一下。项目没有
 * motion 依赖，这就是那套数值的 CSS 版本。
 *
 * 播放三角是几何居中的，视觉上偏左，所以它整体右移 2px。
 */
function PlayToggleIcon(props: { readonly playing: boolean }) {
  const fade = "absolute inset-0 transition-[opacity,filter,scale] duration-300 ease-[cubic-bezier(0.2,0,0,1)]"
  // 用 `blur-[0px]` 而不是 `blur-0`：v4 的 blur 只有 xs–3xl 和 none，`blur-0` 不是有效
  // 类，会被静默丢掉，淡入时就没有一个明确的结束值可插值。
  const shown = "scale-100 opacity-100 blur-[0px]"
  const hidden = "scale-[0.25] opacity-0 blur-[4px]"

  return (
    <span className="relative block size-4">
      <Play className={cn(fade, "translate-x-0.5", props.playing ? hidden : shown)} />
      <Pause className={cn(fade, props.playing ? shown : hidden)} />
    </span>
  )
}
