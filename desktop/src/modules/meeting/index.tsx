import { useCallback, useEffect, useState } from "react"

import { ModulePage } from "@/components/module-page"
import { SystemAppTopBarActionButton } from "@/modules/apps/components/system-app-top-bar"
import { useAppNotifications } from "@/app-shell/notifications"
import { requireSynapseBridge } from "@/lib/electron-bridge"
import { MeetingDetailView } from "./meeting-detail-view"
import { MeetingListView } from "./meeting-list-view"
import { MeetingRecordingView, type MeetingRecordingFinalize } from "./meeting-recording-view"
import {
  useMeetingActions,
  useMeetingDetail,
  useMeetingList,
  useTranscriptionCompletionSubscription,
  useTranscriptionPolling,
} from "./hooks/use-meetings"

/**
 * 会议记录。
 *
 * 三个视图共用一个模块：列表、录音、详情。没有路由——它们是一次会话里的三个阶段，
 * 不是三个可以各自打开的页面。
 *
 * 录音和转写都在后台，所以这里只关心两件事：**什么时候该刷新**、**点完成之后立刻
 * 回到列表**。用户点完「完成」不该看到任何等待界面。
 */

type MeetingView =
  | { readonly kind: "list" }
  | { readonly kind: "recording"; readonly recordingId: string; readonly title: string }
  | { readonly kind: "detail"; readonly meetingId: string }

export function MeetingModule() {
  const notifications = useAppNotifications()
  const [view, setView] = useState<MeetingView>({ kind: "list" })
  const [listRefreshKey, setListRefreshKey] = useState(0)
  const [detailRefreshKey, setDetailRefreshKey] = useState(0)

  const meetings = useMeetingList(listRefreshKey)
  const detail = useMeetingDetail(view.kind === "detail" ? view.meetingId : null, detailRefreshKey)
  const actions = useMeetingActions()

  // 列表里有任何一场在转写就轮询：转完了徽标要自己变成「已完成」，不用用户手动刷新。
  const hasTranscribing = meetings.data.some((meeting) => meeting.status === "transcribing")
  useTranscriptionPolling(view.kind === "list" && hasTranscribing, () => setListRefreshKey((key) => key + 1))
  useTranscriptionPolling(
    view.kind === "detail" && detail.data?.status === "transcribing",
    () => setDetailRefreshKey((key) => key + 1),
  )

  const refreshList = useCallback(() => setListRefreshKey((key) => key + 1), [])

  useTranscriptionCompletionSubscription((event) => {
    setListRefreshKey((key) => key + 1)
    setDetailRefreshKey((key) => key + 1)
    if (event.status === "done") notifications.success(`${event.title} 转写已完成`)
    else notifications.error(`${event.title} 转写失败`)
  })

  async function startRecording(): Promise<void> {
    try {
      const started = await requireSynapseBridge().meeting.recording.start({})
      setView({ kind: "recording", recordingId: started.recordingId, title: started.title })
    } catch (error) {
      notifications.error(error instanceof Error ? error.message : "开始录音失败。")
    }
  }

  async function finalizeRecording(input: MeetingRecordingFinalize): Promise<void> {
    if (view.kind !== "recording") return
    await requireSynapseBridge().meeting.recording.complete({ recordingId: view.recordingId, ...input })
    notifications.success("录音已保存")
    setView({ kind: "list" })
    refreshList()
  }

  async function cancelRecording(): Promise<void> {
    if (view.kind !== "recording") return
    await requireSynapseBridge().meeting.recording.cancel({ recordingId: view.recordingId })
    notifications.success("录音已取消")
    setView({ kind: "list" })
    refreshList()
  }

  if (view.kind === "recording") {
    return (
      <ModulePage title="新录音">
        <MeetingRecordingView
          recordingId={view.recordingId}
          title={view.title}
          onFinalize={finalizeRecording}
          onCancel={cancelRecording}
        />
      </ModulePage>
    )
  }

  if (view.kind === "detail") {
    return (
      <ModulePage
        title={detail.data?.title ?? "会议记录"}
        actions={(
          <SystemAppTopBarActionButton onClick={() => setView({ kind: "list" })}>
            返回
          </SystemAppTopBarActionButton>
        )}
      >
        {detail.data ? (
          <MeetingDetailView
            meeting={detail.data}
            onRetryTranscription={async () => {
              await actions.retryTranscription(view.meetingId)
              setDetailRefreshKey((key) => key + 1)
            }}
          />
        ) : null}
      </ModulePage>
    )
  }

  return (
    <ModulePage
      title="会议记录"
      actions={(
        <SystemAppTopBarActionButton onClick={() => void startRecording()}>
          开始录音
        </SystemAppTopBarActionButton>
      )}
    >
      <MeetingListView
        meetings={meetings.data}
        loading={meetings.loading}
        error={meetings.error}
        onStartRecording={() => void startRecording()}
        onOpenMeeting={(meetingId) => setView({ kind: "detail", meetingId })}
      />
    </ModulePage>
  )
}
