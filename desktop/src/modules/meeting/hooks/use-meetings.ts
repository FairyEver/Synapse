import { useCallback, useEffect, useRef, useState } from "react"

import { requireSynapseBridge } from "@/lib/electron-bridge"
import type { SynapseMeetingDetail, SynapseMeetingSummary, SynapseMeetingTranscriptionCompletedEvent } from "@/types/meeting"

/**
 * 会议记录的数据入口。
 *
 * 渲染进程不直接连服务端，一律经 preload bridge。所有异步读取都带一个请求序号，
 * 迟到的响应直接丢掉——列表在转写期间会反复刷新，没有这道闸就会出现「新数据被旧
 * 响应覆盖」。
 */

export type MeetingLoadState<T> = {
  readonly data: T
  readonly loading: boolean
  readonly error: string | null
}

export function useMeetingList(refreshKey: number): MeetingLoadState<readonly SynapseMeetingSummary[]> {
  const [state, setState] = useState<MeetingLoadState<readonly SynapseMeetingSummary[]>>({
    data: [],
    loading: true,
    error: null,
  })
  const requestId = useRef(0)

  useEffect(() => {
    const current = ++requestId.current
    setState((previous) => ({ ...previous, loading: true }))
    void requireSynapseBridge()
      .meeting.entry.list()
      .then((items) => {
        if (requestId.current !== current) return
        setState({ data: items, loading: false, error: null })
      })
      .catch((error: unknown) => {
        if (requestId.current !== current) return
        setState({ data: [], loading: false, error: error instanceof Error ? error.message : "读取会议列表失败。" })
      })
  }, [refreshKey])

  return state
}

export function useMeetingDetail(
  meetingId: string | null,
  refreshKey: number,
): MeetingLoadState<SynapseMeetingDetail | null> {
  const [state, setState] = useState<MeetingLoadState<SynapseMeetingDetail | null>>({
    data: null,
    loading: meetingId !== null,
    error: null,
  })
  const requestId = useRef(0)

  useEffect(() => {
    if (!meetingId) {
      setState({ data: null, loading: false, error: null })
      return
    }
    const current = ++requestId.current
    setState((previous) => ({ ...previous, loading: true }))
    void requireSynapseBridge()
      .meeting.entry.get({ meetingId })
      .then((detail) => {
        if (requestId.current !== current) return
        setState({ data: detail, loading: false, error: null })
      })
      .catch((error: unknown) => {
        if (requestId.current !== current) return
        setState({ data: null, loading: false, error: error instanceof Error ? error.message : "读取会议失败。" })
      })
  }, [meetingId, refreshKey])

  return state
}

/**
 * 转写进行中时按固定间隔刷新。
 *
 * 只在这一条上轮询，不在整个模块上装定时器：列表页和详情页都可能开着，各自只刷自己
 * 需要的那个接口。
 */
export function useTranscriptionPolling(active: boolean, onTick: () => void, intervalMs = 5000): void {
  const callback = useRef(onTick)
  callback.current = onTick

  useEffect(() => {
    if (!active) return
    const timer = window.setInterval(() => callback.current(), intervalMs)
    return () => window.clearInterval(timer)
  }, [active, intervalMs])
}

export function useMeetingActions() {
  const rename = useCallback(async (meetingId: string, title: string) => {
    await requireSynapseBridge().meeting.entry.rename({ meetingId, title })
  }, [])

  const nameSpeaker = useCallback(async (meetingId: string, speakerId: number, name: string | null) => {
    await requireSynapseBridge().meeting.entry.speakerName({ meetingId, speakerId, name })
  }, [])

  const removeRecording = useCallback(async (meetingId: string) => {
    await requireSynapseBridge().meeting.recording.remove({ meetingId })
  }, [])

  const retryTranscription = useCallback(async (meetingId: string) => {
    await requireSynapseBridge().meeting.entry.retryTranscription({ meetingId })
  }, [])

  return { rename, nameSpeaker, removeRecording, retryTranscription }
}

/**
 * 转写收尾时立刻刷新，而不是等下一次轮询。
 *
 * 轮询本来就兜得住（几秒之内也会变），这条实时消息是为了让用户在转完的当下就看到，
 * 而不是盯着「转写中」再等一个周期。
 */
export function useTranscriptionCompletionSubscription(onCompleted: (event: SynapseMeetingTranscriptionCompletedEvent) => void): void {
  const callback = useRef(onCompleted)
  callback.current = onCompleted

  useEffect(() => {
    const unsubscribe = requireSynapseBridge().meeting.entry.onTranscriptionCompleted((event) => {
      callback.current(event)
    })
    return unsubscribe
  }, [])
}
