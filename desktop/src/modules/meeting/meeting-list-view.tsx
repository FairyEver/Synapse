import { formatMeetingClock, meetingStatusLabel } from "@synapse/shared"
import { Mic, MoreHorizontal } from "lucide-react"

import { Button } from "@/components/ui/button"
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu"
import { Empty, EmptyContent, EmptyDescription, EmptyHeader, EmptyMedia, EmptyTitle } from "@/components/ui/empty"
import { ScrollArea } from "@/components/ui/scroll-area"
import { Skeleton } from "@/components/ui/skeleton"
import { cn } from "@/lib/utils"
import type { SynapseMeetingSummary } from "@/types/meeting"
import { formatStartedAt } from "./started-at"

/**
 * 左栏列表。
 *
 * 它就是一个列表：没有标题、没有搜索、没有筛选、没有按钮和提示条。整行可点，行内的
 * 「⋯」是次要操作，点了不能触发选中。
 */

/** 只有还没出结果的两种状态才必须写在行上；「已完成」是常态，写出来只是噪音。 */
function statusSuffix(meeting: SynapseMeetingSummary): string {
  return meeting.status === "done" ? "" : meetingStatusLabel(meeting.status)
}

type MeetingListViewProps = {
  readonly meetings: readonly SynapseMeetingSummary[]
  readonly loading: boolean
  readonly error: string | null
  readonly selectedId: string | null
  readonly onSelect: (meetingId: string) => void
  readonly onStartRecording: () => void
  readonly onRename: (meetingId: string) => void
  readonly onDelete: (meetingId: string) => void
}

export function MeetingListView(props: MeetingListViewProps) {
  if (props.loading && props.meetings.length === 0) {
    return (
      <div className="space-y-1 p-1.5">
        {[0, 1, 2].map((index) => (
          <div key={index} className="px-2.5 py-2">
            <Skeleton className="h-4 w-40" />
            <Skeleton className="mt-2 h-3 w-28" />
          </div>
        ))}
      </div>
    )
  }

  if (props.error) {
    return (
      <Empty>
        <EmptyHeader>
          <EmptyMedia variant="icon">
            <Mic />
          </EmptyMedia>
          <EmptyTitle>读不到录音</EmptyTitle>
          <EmptyDescription>{props.error}</EmptyDescription>
        </EmptyHeader>
      </Empty>
    )
  }

  if (props.meetings.length === 0) {
    return (
      <Empty>
        <EmptyHeader>
          <EmptyMedia variant="icon">
            <Mic />
          </EmptyMedia>
          <EmptyTitle>还没有录音</EmptyTitle>
        </EmptyHeader>
        <EmptyContent>
          <Button onClick={props.onStartRecording}>开始录音</Button>
        </EmptyContent>
      </Empty>
    )
  }

  return (
    <ScrollArea className="min-h-0 flex-1">
      <div className="space-y-0.5 p-1.5">
        {props.meetings.map((meeting) => (
          <MeetingRow
            key={meeting.id}
            meeting={meeting}
            selected={meeting.id === props.selectedId}
            onSelect={props.onSelect}
            onRename={props.onRename}
            onDelete={props.onDelete}
          />
        ))}
      </div>
    </ScrollArea>
  )
}

type MeetingRowProps = {
  readonly meeting: SynapseMeetingSummary
  readonly selected: boolean
  readonly onSelect: (meetingId: string) => void
  readonly onRename: (meetingId: string) => void
  readonly onDelete: (meetingId: string) => void
}

function MeetingRow(props: MeetingRowProps) {
  const { meeting } = props
  const status = statusSuffix(meeting)

  return (
    <div
      role="button"
      tabIndex={0}
      aria-selected={props.selected}
      data-track="meeting.entry.select"
      data-track-native="true"
      onClick={() => props.onSelect(meeting.id)}
      onKeyDown={(event) => {
        if (event.key !== "Enter" && event.key !== " ") return
        event.preventDefault()
        props.onSelect(meeting.id)
      }}
      className={cn(
        "group flex cursor-pointer items-center gap-2 rounded-lg px-2.5 py-2 outline-none",
        "transition-[background-color] duration-150 ease-out",
        "focus-visible:ring-2 focus-visible:ring-ring",
        props.selected ? "bg-selected" : "hover:bg-muted",
      )}
    >
      <div className="min-w-0 flex-1">
        <p className={cn("truncate text-sm", props.selected && "font-medium")}>{meeting.title}</p>
        <p className="mt-0.5 truncate text-xs text-muted-foreground">
          {formatStartedAt(meeting.startedAt)}
          {status ? (
            <>
              {" · "}
              <span className={meeting.status === "failed" ? "text-destructive" : undefined}>{status}</span>
            </>
          ) : null}
        </p>
      </div>

      <span className="shrink-0 text-xs tabular-nums text-muted-foreground">
        {meeting.durationMs > 0 ? formatMeetingClock(meeting.durationMs) : ""}
      </span>

      <MeetingRowMenu meeting={meeting} onRename={props.onRename} onDelete={props.onDelete} />
    </div>
  )
}

/**
 * 悬停或选中时才出现的次要操作。点它不能触发行的选中。
 *
 * 平时不只是透明，还要 `pointer-events-none`：看不见却点得动的话，点行右侧的空白处会
 * 莫名弹出菜单。
 */
function MeetingRowMenu(props: {
  readonly meeting: SynapseMeetingSummary
  readonly onRename: (meetingId: string) => void
  readonly onDelete: (meetingId: string) => void
}) {
  return (
    <DropdownMenu>
      <DropdownMenuTrigger asChild>
        <Button
          variant="ghost"
          size="icon"
          aria-label="更多操作"
          onClick={(event) => event.stopPropagation()}
          className={cn(
            "relative size-6 shrink-0 text-muted-foreground opacity-0",
            "transition-[opacity] duration-150 ease-out",
            // 视觉尺寸保持 24px，命中区用伪元素撑到 36px。隐藏时按钮是
            // pointer-events-none，伪元素跟着一起失效，不会挡到整行的点击。
            "after:absolute after:top-1/2 after:left-1/2 after:size-9 after:-translate-x-1/2 after:-translate-y-1/2 after:content-['']",
            "pointer-events-none group-hover:pointer-events-auto group-hover:opacity-100 group-aria-selected:pointer-events-auto group-aria-selected:opacity-100 data-[state=open]:pointer-events-auto data-[state=open]:opacity-100",
          )}
        >
          <MoreHorizontal />
        </Button>
      </DropdownMenuTrigger>
      <DropdownMenuContent align="end">
        <DropdownMenuItem onSelect={() => props.onRename(props.meeting.id)}>重命名</DropdownMenuItem>
        <DropdownMenuItem variant="destructive" onSelect={() => props.onDelete(props.meeting.id)}>
          删除
        </DropdownMenuItem>
      </DropdownMenuContent>
    </DropdownMenu>
  )
}
