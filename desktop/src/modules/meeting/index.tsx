import { useCallback, useEffect, useState } from "react"

import { ModulePage } from "@/components/module-page"
import { SystemAppTopBarActionButton } from "@/modules/apps/components/system-app-top-bar"
import { SystemAppWindowShell } from "@/modules/apps/components/system-app-window-shell"
import { useAppNotifications } from "@/app-shell/notifications"
import { requireSynapseBridge } from "@/lib/electron-bridge"
import { MeetingDetailView, type MeetingDetailMode } from "./meeting-detail-view"
import { MeetingListView } from "./meeting-list-view"
import { MeetingRecordingView, type MeetingRecordingFinalize } from "./meeting-recording-view"
import {
  useMeetingActions,
  useMeetingDetail,
  useMeetingList,
  useTranscriptionCompletionSubscription,
  useMeetingPolling,
} from "./hooks/use-meetings"

/**
 * 录音。
 *
 * 左边列表、右边详情同时在场，点左栏右栏就地换——**没有「返回」这个动作**，因为它
 * 没有可返回的地方。右栏只有「语音」和「文字」两个平级视图，切视图不重置选中的那条。
 *
 * 录音页仍然接管整个内容区：录音时不给选列表。
 *
 * 录音和转写都在后台，所以这里只关心两件事：**什么时候该刷新**、**点完成之后立刻
 * 回到列表**。用户点完「完成」不该看到任何等待界面。
 */

type MeetingView =
  | { readonly kind: "list" }
  | { readonly kind: "recording"; readonly recordingId: string; readonly title: string }

export function MeetingModule({ openRequest, onOpenRequestConsumed }: { openRequest?: string | null; onOpenRequestConsumed?: () => void } = {}) {
  const notifications = useAppNotifications()
  const [view, setView] = useState<MeetingView>({ kind: "list" })
  const [selectedId, setSelectedId] = useState<string | null>(null)
  const [detailMode, setDetailMode] = useState<MeetingDetailMode>("voice")
  /** 正在就地改标题的是哪一条。行内「⋯」的重命名会先把这条选中再进编辑态。 */
  const [titleEditingId, setTitleEditingId] = useState<string | null>(null)
  const [listRefreshKey, setListRefreshKey] = useState(0)
  const [detailRefreshKey, setDetailRefreshKey] = useState(0)

  const meetings = useMeetingList(listRefreshKey)
  const detail = useMeetingDetail(view.kind === "list" ? selectedId : null, detailRefreshKey)
  const actions = useMeetingActions()

  // 打开模块默认选中第一条，不留一个「什么都没选」的空右栏；选中的那条被删掉之后落到
  // 剩下的第一条，一条都不剩就回到空态。
  useEffect(() => {
    if (meetings.loading) return
    if (meetings.data.length === 0) {
      setSelectedId(null)
      return
    }
    if (selectedId && meetings.data.some((meeting) => meeting.id === selectedId)) return
    setSelectedId(meetings.data[0]?.id ?? null)
  }, [meetings.data, meetings.loading, selectedId])

  useEffect(() => {
    if (!openRequest) return
    setView({ kind: "list" })
    setSelectedId(openRequest)
    setDetailMode("text")
    setListRefreshKey((key) => key + 1)
    onOpenRequestConsumed?.()
  }, [openRequest, onOpenRequestConsumed])

  // 转写失败的记录默认落到文字视图：它缺的就是文字，停在语音会让用户看不到失败原因和
  // 「重试」。这里只跟「看的是哪条、什么状态」走，用户手动切回语音不会被拽回去。
  const detailId = detail.data?.id
  const detailStatus = detail.data?.status
  useEffect(() => {
    if (detailStatus === "failed") setDetailMode("text")
  }, [detailId, detailStatus])

  // 列表一直轮询，不只在转写中：**另一台设备随时可能新建一条**（手机录的音要在电脑上
  // 自己出现），服务端只有「转写完成」那一条实时消息，覆盖不到。转写那条也一样要跟，
  // 完成后徽标自己变。
  useMeetingPolling(view.kind === "list", () => setListRefreshKey((key) => key + 1))
  useMeetingPolling(
    view.kind === "list" && detail.data?.status === "transcribing",
    () => setDetailRefreshKey((key) => key + 1),
  )

  const refreshList = useCallback(() => setListRefreshKey((key) => key + 1), [])

  useTranscriptionCompletionSubscription(() => {
    setListRefreshKey((key) => key + 1)
    setDetailRefreshKey((key) => key + 1)
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

  async function renameMeeting(meetingId: string, title: string): Promise<void> {
    await actions.rename(meetingId, title)
    refreshList()
    setDetailRefreshKey((key) => key + 1)
  }

  /** 删除就是一个动作：录音和文字一起删掉，行从列表消失。 */
  async function removeMeeting(meetingId: string): Promise<void> {
    try {
      await actions.removeMeeting(meetingId)
      notifications.success("已删除")
    } catch (error) {
      notifications.error(error instanceof Error ? error.message : "删除失败。")
    } finally {
      refreshList()
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

  const selected = detail.data

  return (
    <SystemAppWindowShell
      left={<h2 className="shrink-0 text-sm font-semibold">录音</h2>}
      actions={(
        <SystemAppTopBarActionButton onClick={() => void startRecording()}>
          开始录音
        </SystemAppTopBarActionButton>
      )}
    >
      <div className="flex h-full min-h-0 bg-surface">
        <aside className="flex min-h-0 w-[286px] shrink-0 flex-col border-r bg-sidebar">
          <MeetingListView
            meetings={meetings.data}
            loading={meetings.loading}
            error={meetings.error}
            selectedId={selectedId}
            onSelect={(meetingId) => {
              setSelectedId(meetingId)
              setTitleEditingId(null)
            }}
            onStartRecording={() => void startRecording()}
            onRename={(meetingId) => {
              setSelectedId(meetingId)
              setTitleEditingId(meetingId)
            }}
            onDelete={removeMeeting}
          />
        </aside>
        <main className="flex min-h-0 min-w-0 flex-1 flex-col">
          {selected ? (
            <MeetingDetailView
              meeting={selected}
              mode={detailMode}
              onModeChange={setDetailMode}
              titleEditing={titleEditingId === selected.id}
              onTitleEditingChange={(editing) => setTitleEditingId(editing ? selected.id : null)}
              onRename={async (title) => {
                if (selectedId) await renameMeeting(selectedId, title)
              }}
              onDelete={async () => {
                if (selectedId) await removeMeeting(selectedId)
              }}
              onRetryTranscription={async () => {
                if (!selectedId) return
                await actions.retryTranscription(selectedId)
                setDetailRefreshKey((key) => key + 1)
              }}
            />
          ) : detail.loading || meetings.loading ? null : (
            <MeetingDetailEmpty />
          )}
        </main>
      </div>
    </SystemAppWindowShell>
  )
}

function MeetingDetailEmpty() {
  return (
    <div className="flex min-h-0 flex-1 items-center justify-center p-6">
      <div className="text-center">
        <p className="text-sm font-medium">没有可显示的录音</p>
        <p className="mt-1 text-xs text-muted-foreground">在左边选一条，或者开始一段新录音。</p>
      </div>
    </div>
  )
}
