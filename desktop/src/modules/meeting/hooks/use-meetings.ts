import { useCallback, useEffect, useRef, useState } from "react"

import { requireSynapseBridge } from "@/lib/electron-bridge"
import type {
  SynapseMeetingAudioReadyEvent,
  SynapseMeetingDetail,
  SynapseMeetingSummary,
  SynapseMeetingTranscriptionCompletedEvent,
} from "@/types/meeting"

/**
 * 录音的数据入口。
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
        setState({ data: [], loading: false, error: error instanceof Error ? error.message : "读取录音列表失败。" })
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
  const loadedId = useRef<string | null>(null)

  useEffect(() => {
    if (!meetingId) {
      loadedId.current = null
      setState({ data: null, loading: false, error: null })
      return
    }
    // 换了另一条录音时先把上一条的内容清掉：留着会让右栏短暂显示别人的标题和文字。
    // 同一条录音的定时刷新不能清，否则转写期间右栏每 5 秒闪一次空。
    const switched = loadedId.current !== meetingId
    loadedId.current = meetingId
    const current = ++requestId.current
    setState((previous) => (switched ? { data: null, loading: true, error: null } : { ...previous, loading: true }))
    void requireSynapseBridge()
      .meeting.entry.get({ meetingId })
      .then((detail) => {
        if (requestId.current !== current) return
        setState({ data: detail, loading: false, error: null })
      })
      .catch((error: unknown) => {
        if (requestId.current !== current) return
        setState({ data: null, loading: false, error: error instanceof Error ? error.message : "读取录音失败。" })
      })
  }, [meetingId, refreshKey])

  return state
}

/**
 * 定时刷新。
 *
 * 只在这一条上轮询，不在整个模块上装定时器：列表页和详情页都可能开着，各自只刷自己
 * 需要的那个接口。
 *
 * 窗口不在人眼前时不空转，一被激活立刻刷一次——和仓库里其它自动刷新（Git 仓库、模型
 * 服务商）同一套写法。录音列表要它是因为**另一台设备随时可能新建一条**（手机录的音
 * 要自己出现在电脑上），而服务端没有面向这个列表的推送。
 */
export function useMeetingPolling(active: boolean, onTick: () => void, intervalMs = 5000): void {
  const callback = useRef(onTick)
  callback.current = onTick

  useEffect(() => {
    if (!active) return
    const refreshWhenVisible = () => {
      if (document.visibilityState === "visible") callback.current()
    }
    window.addEventListener("focus", refreshWhenVisible)
    document.addEventListener("visibilitychange", refreshWhenVisible)
    const timer = window.setInterval(refreshWhenVisible, intervalMs)
    return () => {
      window.removeEventListener("focus", refreshWhenVisible)
      document.removeEventListener("visibilitychange", refreshWhenVisible)
      window.clearInterval(timer)
    }
  }, [active, intervalMs])
}

export function useMeetingActions() {
  const rename = useCallback(async (meetingId: string, title: string) => {
    await requireSynapseBridge().meeting.entry.rename({ meetingId, title })
  }, [])

  const removeMeeting = useCallback(async (meetingId: string) => {
    await requireSynapseBridge().meeting.entry.remove({ meetingId })
  }, [])

  const retryTranscription = useCallback(async (meetingId: string) => {
    await requireSynapseBridge().meeting.entry.retryTranscription({ meetingId })
  }, [])

  return { rename, removeMeeting, retryTranscription }
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

/**
 * 音频落到本机时换地址。
 *
 * 下载在主进程后台跑，跑完推一条；播放器据此从载入态切到本机文件。**用户不动手也能好**
 * ——那个「重试」只是催一下，这条才是自动恢复本身。只认当前这条录音的事件。
 */
export function useMeetingAudioReadySubscription(
  meetingId: string,
  onReady: (event: SynapseMeetingAudioReadyEvent) => void,
): void {
  const callback = useRef(onReady)
  callback.current = onReady

  useEffect(() => {
    const unsubscribe = requireSynapseBridge().meeting.audio.onReady((event) => {
      if (event.meetingId !== meetingId) return
      callback.current(event)
    })
    return unsubscribe
  }, [meetingId])
}
