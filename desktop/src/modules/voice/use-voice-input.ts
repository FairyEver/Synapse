import { useCallback, useEffect, useRef, useState } from "react"

import { createRendererLogger } from "@/app-shell/logging"
import { requireSynapseBridge } from "@/lib/electron-bridge"
import { EMPTY_TRANSCRIPT, type AsrTranscript } from "./asr-transcript"
import { MicrophonePermissionError } from "./microphone-capture"
import { VoiceSession, type VoiceFailure } from "./voice-session"

const logger = createRendererLogger("voice")

export type VoicePhase = "idle" | "recording"

export type VoiceInputState = {
  readonly phase: VoicePhase
  readonly transcript: AsrTranscript
  readonly elapsedMs: number
  readonly failure: VoiceFailure | null
}

const IDLE_STATE: VoiceInputState = {
  phase: "idle",
  transcript: EMPTY_TRANSCRIPT,
  elapsedMs: 0,
  failure: null,
}

export type VoiceInputController = {
  readonly state: VoiceInputState
  /** 凭据配好了才显示麦克风入口；没配好时隐藏，不报错弹窗。 */
  readonly available: boolean
  readonly start: () => void
  readonly cancel: () => void
  /** 结束录音并返回要落到输入框的文本；没识别到内容时返回空串。 */
  readonly confirm: () => Promise<string>
  /** 断网 / 没听到声音后用一条新签名重来。 */
  readonly retry: () => void
}

export function useVoiceInput(): VoiceInputController {
  const [state, setState] = useState<VoiceInputState>(IDLE_STATE)
  const [available, setAvailable] = useState(false)
  const sessionRef = useRef<VoiceSession | null>(null)
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
      sessionRef.current?.cancel()
      sessionRef.current = null
    }
  }, [])

  const start = useCallback(() => {
    if (sessionRef.current) return
    setState({ phase: "recording", transcript: EMPTY_TRANSCRIPT, elapsedMs: 0, failure: null })
    void VoiceSession.begin({
      onTranscript: (transcript) => {
        // 出字了就把静音提示撤掉。
        setState((current) => ({ ...current, transcript, failure: current.failure === "silence" ? null : current.failure }))
      },
      onElapsed: (elapsedMs) => { setState((current) => ({ ...current, elapsedMs })) },
      onFailure: (failure) => { setState((current) => ({ ...current, failure })) },
    }).then((session) => {
      if (disposedRef.current) { session.cancel(); return }
      sessionRef.current = session
    }).catch((error: unknown) => {
      sessionRef.current = null
      logger.warn("Voice session failed to start.", {
        errorName: error instanceof Error ? error.name : typeof error,
      })
      setState({
        ...IDLE_STATE,
        // 权限被拒时**不进入录音态**，直接提示去设置。
        failure: error instanceof MicrophonePermissionError ? "permission" : "unavailable",
      })
    })
  }, [])

  const cancel = useCallback(() => {
    sessionRef.current?.cancel()
    sessionRef.current = null
    setState(IDLE_STATE)
  }, [])

  const confirm = useCallback(async (): Promise<string> => {
    const session = sessionRef.current
    sessionRef.current = null
    if (!session) {
      setState(IDLE_STATE)
      return ""
    }
    const text = await session.finish()
    setState(IDLE_STATE)
    return text
  }, [])

  const retry = useCallback(() => {
    sessionRef.current?.cancel()
    sessionRef.current = null
    start()
  }, [start])

  return { state, available, start, cancel, confirm, retry }
}
