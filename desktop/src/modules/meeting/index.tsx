import { useCallback, useEffect, useState } from "react"

import { ModulePage } from "@/components/module-page"
import { SystemAppTopBarActionButton } from "@/modules/apps/components/system-app-top-bar"
import { useAppNotifications } from "@/app-shell/notifications"
import { requireSynapseBridge } from "@/lib/electron-bridge"
import type { SynapseMeetingPendingRecording } from "@/types/meeting"
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
  const [minutesBusy, setMinutesBusy] = useState(false)

  const meetings = useMeetingList(listRefreshKey)
  const detail = useMeetingDetail(view.kind === "detail" ? view.meetingId : null, detailRefreshKey)
  const actions = useMeetingActions()

  const [pending, setPending] = useState<SynapseMeetingPendingRecording>(null)

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

  // 「发现一段未完成的录音」只在列表页查一次：那段录音可能来自上一次进程被杀。
  const loadPending = useCallback(async () => {
    try {
      setPending(await requireSynapseBridge().meeting.recording.pending())
    } catch {
      setPending(null)
    }
  }, [])

  useEffect(() => {
    void loadPending()
  }, [loadPending])

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

  async function discardPending(): Promise<void> {
    if (!pending) return
    try {
      await requireSynapseBridge().meeting.recording.cancel({ recordingId: pending.recordingId })
    } finally {
      setPending(null)
      refreshList()
    }
  }

  /**
   * 续上一段没完成的录音。
   *
   * 上次进程消失时最后一片可能还留在本机，先把它补上去再收尾；时间与波形这两样只在
   * 内存里，跟着进程一起没了，所以只能用已传字节数估算时长。
   */
  async function resumePending(): Promise<void> {
    if (!pending) return
    try {
      const parts = await requireSynapseBridge().meeting.recording.spooledParts({ recordingId: pending.recordingId })
      for (const part of parts) {
        await requireSynapseBridge().meeting.recording.uploadPart({
          recordingId: pending.recordingId,
          partNumber: part.partNumber,
          bytes: part.bytes,
        })
      }
      // 64 kbps 单声道：字节数换算成时长的近似值，只用来显示。
      const durationMs = Math.round((pending.receivedBytes / (64_000 / 8)) * 1000)
      await requireSynapseBridge().meeting.recording.complete({
        recordingId: pending.recordingId,
        durationMs,
        peaks: "",
        speakerCount: 0,
      })
      notifications.success("录音已保存")
    } catch (error) {
      notifications.error(error instanceof Error ? error.message : "保存录音失败。")
    } finally {
      setPending(null)
      refreshList()
    }
  }

  async function generateMinutes(): Promise<void> {
    if (view.kind !== "detail") return
    setMinutesBusy(true)
    try {
      await requireSynapseBridge().meeting.entry.generateMinutes({ meetingId: view.meetingId })
      setDetailRefreshKey((key) => key + 1)
    } catch (error) {
      notifications.error(error instanceof Error ? error.message : "生成纪要失败。")
    } finally {
      setMinutesBusy(false)
    }
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
            minutesBusy={minutesBusy}
            onDeleteRecording={async () => {
              await actions.removeRecording(view.meetingId)
              setDetailRefreshKey((key) => key + 1)
            }}
            onRetryTranscription={async () => {
              await actions.retryTranscription(view.meetingId)
              setDetailRefreshKey((key) => key + 1)
            }}
            onNameSpeaker={async (speakerId, name) => {
              await actions.nameSpeaker(view.meetingId, speakerId, name)
              setDetailRefreshKey((key) => key + 1)
            }}
            onSaveMinutes={async (minutes) => {
              await requireSynapseBridge().meeting.entry.saveMinutes({ meetingId: view.meetingId, minutes })
              setDetailRefreshKey((key) => key + 1)
            }}
            onGenerateMinutes={generateMinutes}
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
        pendingNotice={pending ? { title: pending.title } : null}
        onStartRecording={() => void startRecording()}
        onOpenMeeting={(meetingId) => setView({ kind: "detail", meetingId })}
        onResumePending={() => void resumePending()}
        onDiscardPending={() => void discardPending()}
      />
    </ModulePage>
  )
}
