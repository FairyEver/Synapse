import { formatMeetingDuration, meetingStatusLabel, type MeetingStatus } from "@synapse/shared"
import { ChevronRight, Mic } from "lucide-react"

import { Badge } from "@/components/ui/badge"
import { Button } from "@/components/ui/button"
import { Empty, EmptyContent, EmptyDescription, EmptyHeader, EmptyMedia, EmptyTitle } from "@/components/ui/empty"
import { Skeleton } from "@/components/ui/skeleton"
import type { SynapseMeetingSummary } from "@/types/meeting"

/**
 * 会议列表。
 *
 * 一行一场会议，整行可点。次要信息里「录音已删除」只在删除之后才出现——录音还在时
 * 特意说一句「录音还在」是废话。
 */

const STATUS_BADGE_VARIANT: Record<MeetingStatus, "secondary" | "outline" | "destructive"> = {
  transcribing: "secondary",
  done: "outline",
  failed: "destructive",
}

function formatStartedAt(iso: string): string {
  const date = new Date(iso)
  if (Number.isNaN(date.getTime())) return ""
  const now = new Date()
  const sameDay = date.toDateString() === now.toDateString()
  const time = `${String(date.getHours()).padStart(2, "0")}:${String(date.getMinutes()).padStart(2, "0")}`
  if (sameDay) return `今天 ${time}`
  const yesterday = new Date(now)
  yesterday.setDate(now.getDate() - 1)
  if (date.toDateString() === yesterday.toDateString()) return `昨天 ${time}`
  if (date.getFullYear() === now.getFullYear()) return `${date.getMonth() + 1} 月 ${date.getDate()} 日 ${time}`
  return `${date.getFullYear()} 年 ${date.getMonth() + 1} 月 ${date.getDate()} 日 ${time}`
}

function secondaryText(meeting: SynapseMeetingSummary): string {
  const parts = [formatStartedAt(meeting.startedAt)]
  if (meeting.durationMs > 0) parts.push(formatMeetingDuration(meeting.durationMs))
  if (meeting.speakerCount > 0) parts.push(`${meeting.speakerCount} 位发言人`)
  if (meeting.recording.status === "deleted") parts.push("录音已删除")
  return parts.filter(Boolean).join(" · ")
}

type MeetingListViewProps = {
  readonly meetings: readonly SynapseMeetingSummary[]
  readonly loading: boolean
  readonly error: string | null
  readonly onStartRecording: () => void
  readonly onOpenMeeting: (meetingId: string) => void
}

export function MeetingListView(props: MeetingListViewProps) {
  if (props.loading && props.meetings.length === 0) {
    return (
      <div className="space-y-1">
        {[0, 1, 2].map((index) => (
          <div key={index} className="rounded-lg border bg-background px-3 py-2.5">
            <Skeleton className="h-4 w-40" />
            <Skeleton className="mt-2 h-3 w-56" />
          </div>
        ))}
      </div>
    )
  }

  if (props.error) {
    return (
      <Empty>
        <EmptyHeader>
          <EmptyTitle>读不到会议记录</EmptyTitle>
          <EmptyDescription>{props.error}</EmptyDescription>
        </EmptyHeader>
      </Empty>
    )
  }

  return (
    <div className="space-y-3">
      {props.meetings.length === 0 ? (
        <Empty>
          <EmptyHeader>
            <EmptyMedia variant="icon">
              <Mic />
            </EmptyMedia>
            <EmptyTitle>还没有会议记录</EmptyTitle>
          </EmptyHeader>
          <EmptyContent>
            <Button onClick={props.onStartRecording}>开始录音</Button>
          </EmptyContent>
        </Empty>
      ) : (
        <div className="space-y-1">
          {props.meetings.map((meeting) => (
            <button
              key={meeting.id}
              type="button"
              onClick={() => props.onOpenMeeting(meeting.id)}
              className="flex w-full items-center gap-3 rounded-lg border bg-background px-3 py-2.5 text-left transition-colors hover:bg-muted"
            >
              <span className="min-w-0 flex-1">
                <span className="block truncate text-sm">{meeting.title}</span>
                <span className="mt-0.5 block truncate text-xs text-muted-foreground">{secondaryText(meeting)}</span>
              </span>
              <Badge variant={STATUS_BADGE_VARIANT[meeting.status]}>{meetingStatusLabel(meeting.status)}</Badge>
              <ChevronRight className="size-4 shrink-0 text-muted-foreground" />
            </button>
          ))}
        </div>
      )}
    </div>
  )
}
