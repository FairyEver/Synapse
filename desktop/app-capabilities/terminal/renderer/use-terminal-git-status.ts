import { useCallback, useEffect, useRef, useState } from "react"

import { createRendererLogger } from "../../../src/app-shell/logging"
import { requireBridgeDomain } from "../../../src/lib/electron-bridge"
import type { TerminalGitStatus } from "../shared/schema"

const logger = createRendererLogger("terminal.git-status")

export function useTerminalGitStatus(sessionId: string, visible: boolean) {
  const bridge = requireBridgeDomain("terminal")
  const [status, setStatus] = useState<TerminalGitStatus | null>(null)
  const [syncing, setSyncing] = useState(false)
  const requestIdRef = useRef(0)
  const syncingRef = useRef(false)

  const refresh = useCallback(async () => {
    if (!visible || syncingRef.current) return
    const requestId = ++requestIdRef.current
    try {
      const next = await bridge.git.status({ sessionId })
      if (requestId === requestIdRef.current) setStatus(next)
    } catch (error) {
      if (requestId !== requestIdRef.current) return
      setStatus(null)
      logger.warn("Terminal Git status read failed.", { sessionId, error })
    }
  }, [bridge, sessionId, visible])

  useEffect(() => {
    if (!visible) return undefined
    setStatus(null)
    void refresh()
    let timer: ReturnType<typeof setTimeout> | undefined
    const scheduleRefresh = () => {
      clearTimeout(timer)
      timer = setTimeout(() => { void refresh() }, 800)
    }
    const unsubscribeData = bridge.operation.onData((event) => {
      if (event.sessionId === sessionId) scheduleRefresh()
    })
    const unsubscribeCwd = bridge.operation.onWorkingDirectoryChanged?.((event) => {
      if (event.sessionId !== sessionId) return
      ++requestIdRef.current
      setStatus(null)
      scheduleRefresh()
    })
    const onFocus = () => { void refresh() }
    window.addEventListener("focus", onFocus)
    return () => {
      ++requestIdRef.current
      clearTimeout(timer)
      unsubscribeData()
      unsubscribeCwd?.()
      window.removeEventListener("focus", onFocus)
    }
  }, [bridge, refresh, sessionId, visible])

  const sync = useCallback(async (): Promise<{ ok: boolean; message?: string }> => {
    if (!status?.isRepository || syncingRef.current) return { ok: false }
    syncingRef.current = true
    setSyncing(true)
    ++requestIdRef.current
    try {
      const result = await bridge.git.sync({ sessionId, expectedCwd: status.cwd })
      if (result.ok) setStatus(result.status)
      else setStatus(null)
      return result
    } catch (error) {
      logger.warn("Terminal Git sync failed.", { sessionId, error })
      setStatus(null)
      return { ok: false, message: error instanceof Error ? error.message : "同步失败" }
    } finally {
      syncingRef.current = false
      setSyncing(false)
      void refresh()
    }
  }, [bridge, refresh, sessionId, status])

  return { status, syncing, sync }
}
