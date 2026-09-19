import { formatMeetingDuration } from "@synapse/shared"
import { MoreHorizontal } from "lucide-react"
import { useEffect, useRef, useState } from "react"

import { AlertDialog, AlertDialogAction, AlertDialogCancel, AlertDialogContent, AlertDialogDescription, AlertDialogFooter, AlertDialogHeader, AlertDialogTitle } from "@/components/ui/alert-dialog"
import { Button } from "@/components/ui/button"
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu"
import { Input } from "@/components/ui/input"
import { Progress } from "@/components/ui/progress"
import { ScrollArea } from "@/components/ui/scroll-area"
import { Tabs, TabsList, TabsTrigger } from "@/components/ui/tabs"
import type { SynapseMeetingDetail } from "@/types/meeting"
import { MeetingPlayback } from "./meeting-playback"
import { formatStartedAt } from "./started-at"
import { joinTranscriptParagraphs } from "./transcript-paragraphs"

/**
 * 右栏详情。
 *
 * 头一行是标题、时间和时长，右边一个「⋯」。下面是「语音」和「文字」两个**平级**视图：
 * 语音是一个播放器，文字就是腾讯云转出来的那一段。没有纪要、没有发言人、没有时间戳、
 * 没有搜索——腾讯云返回什么就显示什么。
 */

/** 右栏的两个视图。切换是粘性的，切到另一条录音也还是原来那个视图。 */
export type MeetingDetailMode = "voice" | "text"

type MeetingDetailViewProps = {
  readonly meeting: SynapseMeetingDetail
  readonly mode: MeetingDetailMode
  readonly onModeChange: (mode: MeetingDetailMode) => void
  readonly titleEditing: boolean
  readonly onTitleEditingChange: (editing: boolean) => void
  readonly onRename: (title: string) => Promise<void>
  readonly onDelete: () => Promise<void>
  readonly onRetryTranscription: () => Promise<void>
}

export function MeetingDetailView(props: MeetingDetailViewProps) {
  const { meeting } = props
  const [confirmingDelete, setConfirmingDelete] = useState(false)
  const recordingDeleted = meeting.recording.status === "deleted"

  return (
    <div className="flex min-h-0 flex-1 flex-col">
      <div className="flex items-start gap-2.5 px-4 pt-4">
        <div className="min-w-0 flex-1">
          <MeetingTitle
            title={meeting.title}
            editing={props.titleEditing}
            onEditingChange={props.onTitleEditingChange}
            onRename={props.onRename}
          />
          <p className="mt-0.5 truncate text-xs text-muted-foreground">
            {formatStartedAt(meeting.startedAt)}
            {meeting.durationMs > 0 ? ` · ${formatMeetingDuration(meeting.durationMs)}` : ""}
          </p>
        </div>
        <DropdownMenu>
          <DropdownMenuTrigger asChild>
            <Button variant="ghost" size="icon" aria-label="更多操作">
              <MoreHorizontal />
            </Button>
          </DropdownMenuTrigger>
          <DropdownMenuContent align="end">
            <DropdownMenuItem onSelect={() => props.onTitleEditingChange(true)}>重命名</DropdownMenuItem>
            <DropdownMenuItem variant="destructive" onSelect={() => setConfirmingDelete(true)}>
              删除
            </DropdownMenuItem>
          </DropdownMenuContent>
        </DropdownMenu>
      </div>

      <div className="px-4 pt-3.5">
        <Tabs value={props.mode} onValueChange={(next) => props.onModeChange(next as MeetingDetailMode)}>
          <TabsList>
            <TabsTrigger value="voice">语音</TabsTrigger>
            <TabsTrigger value="text">文字</TabsTrigger>
          </TabsList>
        </Tabs>
      </div>

      <ScrollArea className="min-h-0 flex-1">
        <div className="px-4 pt-3.5 pb-7">
          {props.mode === "voice" ? (
            <VoiceView meeting={meeting} recordingDeleted={recordingDeleted} />
          ) : (
            <TextView meeting={meeting} onRetry={props.onRetryTranscription} />
          )}
        </div>
      </ScrollArea>

      <AlertDialog open={confirmingDelete} onOpenChange={setConfirmingDelete}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>删除这条录音？</AlertDialogTitle>
            <AlertDialogDescription>
              「{meeting.title}」的录音和文字会一起删除，无法恢复。
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>取消</AlertDialogCancel>
            <AlertDialogAction
              variant="destructive"
              onClick={() => {
                void props.onDelete()
              }}
            >
              删除
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </div>
  )
}

/** 标题点了就地改：回车提交，Esc 取消。 */
function MeetingTitle(props: {
  readonly title: string
  readonly editing: boolean
  readonly onEditingChange: (editing: boolean) => void
  readonly onRename: (title: string) => Promise<void>
}) {
  const [draft, setDraft] = useState(props.title)
  const inputRef = useRef<HTMLInputElement | null>(null)

  useEffect(() => {
    if (!props.editing) {
      setDraft(props.title)
      return
    }
    inputRef.current?.focus()
    inputRef.current?.select()
  }, [props.editing, props.title])

  if (!props.editing) {
    return (
      <button
        type="button"
        onClick={() => props.onEditingChange(true)}
        className="block max-w-full truncate rounded-md text-left text-base font-medium focus-visible:ring-2 focus-visible:ring-ring focus-visible:outline-none"
      >
        {props.title}
      </button>
    )
  }

  function commit(save: boolean): void {
    const next = draft.trim()
    props.onEditingChange(false)
    if (save && next && next !== props.title) void props.onRename(next)
  }

  return (
    <Input
      ref={inputRef}
      value={draft}
      onChange={(event) => setDraft(event.target.value)}
      onKeyDown={(event) => {
        if (event.key === "Enter") commit(true)
        if (event.key === "Escape") commit(false)
      }}
      onBlur={() => commit(true)}
      className="text-base font-medium"
    />
  )
}

/** 语音：一整段铺满宽度的波形 + 播放键 + ±15 秒 + 当前时间 / 总时长。 */
function VoiceView(props: { readonly meeting: SynapseMeetingDetail; readonly recordingDeleted: boolean }) {
  if (props.recordingDeleted) {
    return (
      <div className="rounded-lg border px-3 py-8 text-center">
        <p className="text-sm font-medium">录音已删除</p>
        <p className="mt-1 text-xs text-muted-foreground">文字仍保留，切到「文字」查看。</p>
      </div>
    )
  }
  return <MeetingPlayback meetingId={props.meeting.id} durationMs={props.meeting.durationMs} />
}

/** 文字：腾讯云返回什么就显示什么，按自然段排开。 */
function TextView(props: { readonly meeting: SynapseMeetingDetail; readonly onRetry: () => Promise<void> }) {
  const { meeting } = props

  if (meeting.status === "failed") {
    return (
      <div className="rounded-lg border border-destructive/40 px-3 py-8 text-center">
        <p className="text-sm font-medium">转写失败</p>
        <p className="mt-1 text-xs text-destructive">{meeting.failureReason ?? "未知原因。"}</p>
        <Button variant="outline" size="sm" className="mt-3" onClick={() => void props.onRetry()}>
          重试
        </Button>
      </div>
    )
  }

  const paragraphs = joinTranscriptParagraphs(meeting.segments)

  return (
    <div className="space-y-3">
      {meeting.status === "transcribing" ? (
        <div className="space-y-2">
          {/* 腾讯云不给百分比，所以这里只能是一条「在跑」的条，不编一个假的数值。 */}
          <Progress value={null} className="animate-pulse" />
          <p className="text-xs text-muted-foreground">转写还在进行，完成后文字会自动补全。</p>
        </div>
      ) : null}

      {paragraphs.length === 0 ? (
        <div className="rounded-lg border px-3 py-8 text-center">
          <p className="text-sm font-medium">还没有文字</p>
          <p className="mt-1 text-xs text-muted-foreground">这段录音里没有识别到语音。</p>
        </div>
      ) : (
        <div className="max-w-[700px] space-y-2.5">
          {paragraphs.map((paragraph, index) => (
            <p key={index} className="text-sm leading-relaxed">
              {paragraph}
            </p>
          ))}
        </div>
      )}
    </div>
  )
}
