import { decodeMeetingPeaks, formatMeetingClock, meetingPlaybackProgress } from "@synapse/shared"
import { Pause, Play, RotateCcw, RotateCw } from "lucide-react"
import { useEffect, useRef, useState } from "react"

import { Button } from "@/components/ui/button"
import { requireSynapseBridge } from "@/lib/electron-bridge"
import { drawPlaybackWaveform, playbackPositionFromClick } from "./waveform"

/**
 * 回放。
 *
 * 一条可点击定位的波形加一个播放键，就够用了；再加一对 ±15 秒——录音动辄四十分钟以
 * 上，回退重听是刚需。仍然**没有**时间刻度尺、缩略图、倍速，也没有播放时跟随高亮的
 * 「当前这句」。
 *
 * 这条波形是**整段铺满宽度**的，与录音页那条滚动窗口在行为上刻意不同。
 */

/** 一次快退/快进多少。 */
const SKIP_MS = 15_000

type MeetingPlaybackProps = {
  readonly meetingId: string
  readonly durationMs: number
}

export function MeetingPlayback(props: MeetingPlaybackProps) {
  const { meetingId, durationMs } = props
  const canvasRef = useRef<HTMLCanvasElement | null>(null)
  const audioRef = useRef<HTMLAudioElement | null>(null)
  const peaksRef = useRef<Uint8Array>(new Uint8Array(0))
  const [url, setUrl] = useState<string | null>(null)
  const [playing, setPlaying] = useState(false)
  const [positionMs, setPositionMs] = useState(0)
  const [ready, setReady] = useState(false)

  useEffect(() => {
    let disposed = false
    void Promise.all([
      requireSynapseBridge().meeting.entry.playbackUrl({ meetingId }),
      requireSynapseBridge().meeting.entry.peaks({ meetingId }),
    ])
      .then(([audio, peaks]) => {
        if (disposed) return
        setUrl(audio.url)
        peaksRef.current = decodeMeetingPeaks(peaks.peaks)
        setReady(true)
      })
      .catch(() => {
        if (disposed) return
        setUrl(null)
        setReady(true)
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

  const progress = meetingPlaybackProgress(positionMs, durationMs)

  useEffect(() => {
    const canvas = canvasRef.current
    if (!canvas) return
    const redraw = () => drawPlaybackWaveform(canvas, peaksRef.current, { progress })
    redraw()
    window.addEventListener("resize", redraw)
    return () => window.removeEventListener("resize", redraw)
  }, [ready, url, progress])

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

  function seekFromClick(event: React.MouseEvent<HTMLCanvasElement>): void {
    const canvas = canvasRef.current
    if (!canvas) return
    const bounds = canvas.getBoundingClientRect()
    seek(playbackPositionFromClick(event.clientX - bounds.left, bounds.width, durationMs))
  }

  return (
    <div className="space-y-2.5">
      <div className="relative overflow-hidden rounded-lg border bg-card">
        <canvas
          ref={canvasRef}
          onClick={seekFromClick}
          data-track="meeting.playback.seek"
          data-track-native="true"
          className="h-32 w-full cursor-pointer"
          aria-label="录音波形，可点击定位"
        />
        {peaksRef.current.length > 0 ? (
          <span
            className="pointer-events-none absolute inset-y-0 w-px bg-foreground"
            style={{ left: `${progress * 100}%` }}
            aria-hidden
          />
        ) : null}
      </div>

      <div className="flex items-center gap-2">
        <Button
          variant="ghost"
          size="sm"
          onClick={() => seek(positionMs - SKIP_MS)}
          disabled={!url}
          aria-label="后退 15 秒"
          title="后退 15 秒"
        >
          <RotateCcw />15
        </Button>
        <Button variant="ghost" size="icon" onClick={toggle} disabled={!url} aria-label={playing ? "暂停" : "播放"}>
          {playing ? <Pause /> : <Play />}
        </Button>
        <Button
          variant="ghost"
          size="sm"
          onClick={() => seek(positionMs + SKIP_MS)}
          disabled={!url}
          aria-label="前进 15 秒"
          title="前进 15 秒"
        >
          15<RotateCw />
        </Button>
        <span className="ml-1 text-xs tabular-nums text-muted-foreground">
          {formatMeetingClock(positionMs)} / {formatMeetingClock(durationMs)}
        </span>
      </div>

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
