import {
  formatMeetingClock,
  formatMeetingDuration,
  meetingStatusLabel,
  type MeetingSpeakerDto,
} from "@synapse/shared"
import { Search } from "lucide-react"
import { useMemo, useState } from "react"

import { Badge } from "@/components/ui/badge"
import { Button } from "@/components/ui/button"
import { Empty, EmptyDescription, EmptyHeader, EmptyTitle } from "@/components/ui/empty"
import { Input } from "@/components/ui/input"
import type { SynapseMeetingDetail } from "@/types/meeting"
import { MeetingPlayback } from "./meeting-playback"

/**
 * 会议详情。
 *
 * 顶部是回放，主体是逐字稿。转写失败时把原因写出来并给一个「重试」——重试不需要
 * 重新上传，音频一直在。
 */

/** 发言人用主题里的分类色区分，深浅模式各有一套，不引入自定义颜色。 */
const SPEAKER_BAR_CLASSES = [
  "bg-chart-1",
  "bg-chart-2",
  "bg-chart-3",
  "bg-chart-4",
  "bg-chart-5",
] as const

function speakerBarClass(speakerId: number): string {
  return SPEAKER_BAR_CLASSES[speakerId % SPEAKER_BAR_CLASSES.length]
}

function speakerLabel(speakers: readonly MeetingSpeakerDto[], speakerId: number): string {
  const named = speakers.find((speaker) => speaker.speakerId === speakerId)?.name
  return named && named.trim() ? named : `发言人 ${speakerId + 1}`
}

type MeetingDetailViewProps = {
  readonly meeting: SynapseMeetingDetail
  readonly onRetryTranscription: () => Promise<void>
}

export function MeetingDetailView(props: MeetingDetailViewProps) {
  const { meeting } = props
  const [query, setQuery] = useState("")
  const [seekToMs, setSeekToMs] = useState<number | null>(null)

  const filteredSegments = useMemo(() => {
    const keyword = query.trim().toLowerCase()
    if (!keyword) return meeting.segments
    return meeting.segments.filter((segment) => segment.text.toLowerCase().includes(keyword))
  }, [meeting.segments, query])

  const recordingDeleted = meeting.recording.status === "deleted"
  const transcriptEmpty = meeting.segments.length === 0

  return (
    <div className="space-y-3">
      <div className="space-y-3 rounded-lg border bg-background px-3 py-2.5">
        <div className="flex items-start justify-between gap-3">
          <div className="min-w-0">
            <p className="truncate text-sm">{meeting.title}</p>
            <p className="mt-0.5 truncate text-xs text-muted-foreground">
              {formatMeetingDuration(meeting.durationMs)}
              {meeting.speakerCount > 0 ? ` · ${meeting.speakerCount} 位发言人` : ""}
            </p>
          </div>
          <div className="flex shrink-0 items-center gap-2">
            <Badge variant={meeting.status === "failed" ? "destructive" : meeting.status === "done" ? "outline" : "secondary"}>
              {meetingStatusLabel(meeting.status)}
            </Badge>
          </div>
        </div>

        <MeetingPlayback
          meetingId={meeting.id}
          durationMs={meeting.durationMs}
          recordingDeleted={recordingDeleted}
          seekToMs={seekToMs}
          onSeekHandled={() => setSeekToMs(null)}
        />
      </div>

      {meeting.status === "failed" ? (
        <div className="flex items-center justify-between gap-3 rounded-lg border border-destructive/40 bg-background px-3 py-2.5">
          <p className="min-w-0 truncate text-xs text-destructive">{meeting.failureReason ?? "转写失败"}</p>
          <Button variant="outline" size="sm" onClick={() => void props.onRetryTranscription()}>
            重试
          </Button>
        </div>
      ) : null}

      <div className="space-y-3">
        <div className="flex items-center gap-2">
          <div className="relative flex-1">
            <Search className="pointer-events-none absolute top-1/2 left-2 size-3.5 -translate-y-1/2 text-muted-foreground" />
            <Input
              value={query}
              onChange={(event) => setQuery(event.target.value)}
              placeholder="搜索逐字稿"
              className="pl-7"
            />
          </div>
        </div>

        {transcriptEmpty ? (
          <Empty>
            <EmptyHeader>
              <EmptyTitle>这段录音里没有识别到语音</EmptyTitle>
              <EmptyDescription>
                {meeting.status === "transcribing" ? "转写还在进行，完成后逐字稿会出现在这里。" : ""}
              </EmptyDescription>
            </EmptyHeader>
          </Empty>
        ) : (
          <div className="space-y-2">
            {filteredSegments.map((segment) => (
              <div key={segment.id} className="flex gap-2.5">
                <span className={`mt-1 w-0.5 shrink-0 self-stretch rounded-full ${speakerBarClass(segment.speakerId)}`} aria-hidden />
                <div className="min-w-0 flex-1">
                  <div className="flex items-baseline gap-2">
                    <span className="text-xs font-medium">{speakerLabel(meeting.speakers, segment.speakerId)}</span>
                    <button
                      type="button"
                      onClick={() => setSeekToMs(segment.startMs)}
                      className="text-xs tabular-nums text-muted-foreground hover:text-foreground"
                    >
                      {formatMeetingClock(segment.startMs)}
                    </button>
                  </div>
                  <p className="mt-0.5 text-sm">{segment.text}</p>
                </div>
              </div>
            ))}
          </div>
        )}
      </div>
    </div>
  )
}
