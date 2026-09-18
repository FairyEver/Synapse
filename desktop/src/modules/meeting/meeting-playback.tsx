import { decodeMeetingPeaks, formatMeetingClock, meetingPlaybackProgress } from "@synapse/shared"
import { Pause, Play } from "lucide-react"
import { useEffect, useRef, useState } from "react"

import { Button } from "@/components/ui/button"
import { requireSynapseBridge } from "@/lib/electron-bridge"
import { drawPlaybackWaveform, playbackPositionFromClick } from "./waveform"

/**
 * 回放。
 *
 * 做减法：一条可点击定位的波形加一个播放按钮就够了。没有时间刻度尺、没有缩略图、
 * 没有快进快退、没有倍速——逐字稿才是这一页的主体，音频是用来「听一下当时怎么说
 * 的」，点波形就能跳。
 *
 * 这条波形是**整段铺满宽度**的，与录音页那条滚动窗口在行为上刻意不同。
 */

type MeetingPlaybackProps = {
  readonly meetingId: string
  readonly durationMs: number
  readonly recordingDeleted: boolean
  readonly seekToMs: number | null
  readonly onSeekHandled: () => void
}

export function MeetingPlayback(props: MeetingPlaybackProps) {
  const { meetingId, durationMs, recordingDeleted, seekToMs, onSeekHandled } = props
  const canvasRef = useRef<HTMLCanvasElement | null>(null)
  const audioRef = useRef<HTMLAudioElement | null>(null)
  const peaksRef = useRef<Uint8Array>(new Uint8Array(0))
  const [url, setUrl] = useState<string | null>(null)
  const [playing, setPlaying] = useState(false)
  const [positionMs, setPositionMs] = useState(0)
  const [ready, setReady] = useState(false)

  useEffect(() => {
    if (recordingDeleted) {
      setUrl(null)
      return
    }
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
  }, [meetingId, recordingDeleted])

  useEffect(() => {
    const canvas = canvasRef.current
    if (!canvas) return
    const redraw = () => drawPlaybackWaveform(canvas, peaksRef.current)
    redraw()
    window.addEventListener("resize", redraw)
    return () => window.removeEventListener("resize", redraw)
  }, [ready, url])

  // 逐字稿里点时间戳时跳到对应位置。
  useEffect(() => {
    if (seekToMs === null) return
    const audio = audioRef.current
    if (audio) {
      audio.currentTime = Math.max(0, seekToMs / 1000)
      setPositionMs(seekToMs)
    }
    onSeekHandled()
  }, [seekToMs, onSeekHandled])

  function toggle(): void {
    const audio = audioRef.current
    if (!audio) return
    if (audio.paused) {
      void audio.play().catch(() => undefined)
    } else {
      audio.pause()
    }
  }

  function seek(event: React.MouseEvent<HTMLCanvasElement>): void {
    const canvas = canvasRef.current
    const audio = audioRef.current
    if (!canvas || !audio) return
    const bounds = canvas.getBoundingClientRect()
    const target = playbackPositionFromClick(event.clientX - bounds.left, bounds.width, durationMs)
    audio.currentTime = Math.max(0, target / 1000)
    setPositionMs(target)
  }

  const progress = meetingPlaybackProgress(positionMs, durationMs)

  return (
    <div className="space-y-2">
      {recordingDeleted ? (
        <p className="rounded-lg border bg-muted px-3 py-2 text-xs text-muted-foreground">录音已删除 · 逐字稿和纪要保留</p>
      ) : (
        <>
          <div className="relative">
            <canvas
              ref={canvasRef}
              onClick={seek}
              className="h-16 w-full cursor-pointer"
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
            <Button variant="ghost" size="icon" onClick={toggle} disabled={!url} aria-label={playing ? "暂停" : "播放"}>
              {playing ? <Pause /> : <Play />}
            </Button>
            <span className="text-xs tabular-nums text-muted-foreground">
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
        </>
      )}
    </div>
  )
}
