import { useCallback, useEffect, useRef, useState } from "react"

import { createRendererLogger } from "@/app-shell/logging"
import { requireSynapseBridge } from "@/lib/electron-bridge"
import { EMPTY_TRANSCRIPT, type AsrTranscript } from "./asr-transcript"
import { MicrophonePermissionError } from "./microphone-capture"
import { VoiceSession, type VoiceFailure } from "./voice-session"

const logger = createRendererLogger("voice")

export type VoicePhase = "idle" | "recording" | "finishing"

export type VoiceInputState = {
  readonly phase: VoicePhase
  readonly transcript: AsrTranscript
  readonly failure: VoiceFailure | null
}

const IDLE_STATE: VoiceInputState = {
  phase: "idle",
  transcript: EMPTY_TRANSCRIPT,
  failure: null,
}

export type VoiceInputController = {
  readonly state: VoiceInputState
  /** 凭据配好了才显示麦克风入口；没配好时隐藏，不报错弹窗。 */
  readonly available: boolean
  readonly start: () => void
  readonly cancel: () => void
  /** 收尾与文字提交共用互斥状态；取消或离开会话时 signal 失效。 */
  readonly confirm: (consume: (text: string, signal: AbortSignal) => void | Promise<void>) => Promise<void>
  /** 断网 / 没听到声音后用一条新签名重来。 */
  readonly retry: () => void
}

export function useVoiceInput(): VoiceInputController {
  const [state, setState] = useState<VoiceInputState>(IDLE_STATE)
  const [available, setAvailable] = useState(false)
  const sessionRef = useRef<VoiceSession | null>(null)
  const startingRef = useRef<Promise<VoiceSession | null> | null>(null)
  const abortRef = useRef<AbortController | null>(null)
  const finishingRef = useRef(false)
  const disposedRef = useRef(false)

  useEffect(() => {
    disposedRef.current = false
    let cancelled = false
    // 可用性由服务端决定（平台有没有配腾讯云密钥），不是这台机器的设置。
    // 桥里没有 voice 域（旧 preload、降级环境）时按"不可用"处理：入口不出现，
    // 而不是把整个输入区一起带崩。
    void Promise.resolve()
      .then(() => requireSynapseBridge().voice.status.get())
      .then((status) => { if (!cancelled) setAvailable(status.available) })
      .catch(() => { if (!cancelled) setAvailable(false) })
    return () => {
      cancelled = true
      disposedRef.current = true
      abortRef.current?.abort()
      sessionRef.current?.cancel()
      sessionRef.current = null
    }
  }, [])

  const start = useCallback(() => {
    if (sessionRef.current || startingRef.current || finishingRef.current) return
    const controller = new AbortController()
    abortRef.current = controller
    const { signal } = controller
    setState({ phase: "recording", transcript: EMPTY_TRANSCRIPT, failure: null })
    const starting = VoiceSession.begin({
      onTranscript: (transcript) => {
        if (signal.aborted) return
        // 出字了就把静音提示撤掉。
        setState((current) => ({ ...current, transcript, failure: current.failure === "silence" ? null : current.failure }))
      },
      onFailure: (failure) => {
        if (!signal.aborted) setState((current) => ({ ...current, failure }))
      },
    }).then((session) => {
      if (disposedRef.current || signal.aborted) { session.cancel(); return null }
      sessionRef.current = session
      return session
    }).catch((error: unknown) => {
      if (signal.aborted) return null
      sessionRef.current = null
      logger.warn("Voice session failed to start.", {
        errorName: error instanceof Error ? error.name : typeof error,
      })
      setState({
        ...IDLE_STATE,
        // 权限被拒时**不进入录音态**，直接提示去设置。
        failure: error instanceof MicrophonePermissionError ? "permission" : "unavailable",
      })
      return null
    }).finally(() => {
      if (startingRef.current === starting) startingRef.current = null
    })
    startingRef.current = starting
  }, [])

  const cancel = useCallback(() => {
    abortRef.current?.abort()
    startingRef.current = null
    finishingRef.current = false
    sessionRef.current?.cancel()
    sessionRef.current = null
    setState(IDLE_STATE)
  }, [])

  const confirm = useCallback(async (consume: (text: string, signal: AbortSignal) => void | Promise<void>): Promise<void> => {
    const signal = abortRef.current?.signal
    if (!signal || signal.aborted || finishingRef.current) return
    finishingRef.current = true
    setState((current) => ({ ...current, phase: "finishing" }))
    let session: VoiceSession | null = null
    try {
      session = sessionRef.current ?? await startingRef.current
      if (!session || signal.aborted) return
      const text = await session.finish()
      if (!signal.aborted) await consume(text, signal)
    } finally {
      session?.cancel()
      if (!signal.aborted) {
        sessionRef.current = null
        finishingRef.current = false
        abortRef.current?.abort()
        setState((current) => current.phase === "idle" && current.failure ? current : IDLE_STATE)
      }
    }
  }, [])

  const retry = useCallback(() => {
    cancel()
    start()
  }, [cancel, start])

  return { state, available, start, cancel, confirm, retry }
}
