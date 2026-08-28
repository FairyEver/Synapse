import { useCallback, useEffect, useState } from "react"

import { createRendererLogger } from "@/app-shell/logging"
import { getSynapseBridge } from "@/lib/electron-bridge"
import type { SynapseLiveState } from "@/types/live"

const logger = createRendererLogger("live-connection")

function useLiveConnection(initialState: SynapseLiveState, showInitialLoading: boolean) {
  const [state, setState] = useState(initialState)
  const [isLoading, setIsLoading] = useState(showInitialLoading)
  const [isRetrying, setIsRetrying] = useState(false)

  useEffect(() => {
    const bridge = getSynapseBridge()?.live
    if (!bridge) {
      setIsLoading(false)
      return undefined
    }

    let mounted = true
    void bridge.getState()
      .then((nextState) => {
        if (mounted) setState(nextState)
      })
      .catch((error: unknown) => {
        logger.warn("Failed to read Live connection state.", { error })
        if (mounted) {
          setState((current) => ({
            ...current,
            status: "disconnected",
            connectedAt: null,
            lastSeenAt: null,
            lastError: "状态读取失败",
          }))
        }
      })
      .finally(() => {
        if (mounted) setIsLoading(false)
      })

    const unsubscribe = bridge.onStateChanged((event) => {
      setState(event.state)
      setIsLoading(false)
    })

    return () => {
      mounted = false
      unsubscribe()
    }
  }, [])

  const retry = useCallback(async (): Promise<void> => {
    const bridge = getSynapseBridge()?.live
    if (!bridge || isRetrying) return

    setIsRetrying(true)
    try {
      setState(await bridge.retry())
    } catch (error) {
      logger.warn("Failed to retry Live connection.", { error })
      setState((current) => ({ ...current, lastError: "重连失败" }))
    } finally {
      setIsRetrying(false)
    }
  }, [isRetrying])

  return { isLoading, isRetrying, retry, state }
}

export { useLiveConnection }
