import { useCallback, useEffect, useRef, useState } from "react"
import { toast } from "sonner"
import { useAccount } from "@/app-shell/account"
export function useGameQuery<T>(
  read: () => Promise<T>,
  key: string,
  intervalMs = 0,
  enabled = true,
) {
  const { state } = useAccount(),
    identity = state.status === "authenticated" ? state.profile.user.id : null
  const online = state.status === "authenticated" && state.connectivity !== "offline"
  const reader = useRef(read)
  reader.current = read
  const [result, setResult] = useState<{ key: string; identity: string; data: T } | null>(null)
  const [loading, setLoading] = useState(false)
  const refreshRef = useRef<() => Promise<void>>(async () => {})
  useEffect(() => {
    let stopped = false,
      busy = false
    setResult(null)
    if (!identity || !online || !enabled) {
      setLoading(false)
      return
    }
    const refresh = async () => {
      if (stopped || busy) return
      busy = true
      setLoading(true)
      try {
        const data = await reader.current()
        if (!stopped) setResult({ key, identity, data })
      } catch (error) {
        if (!stopped)
          toast.error(error instanceof Error ? error.message : "游戏数据读取失败", {
            id: `game:${key}`,
          })
      } finally {
        busy = false
        if (!stopped) setLoading(false)
      }
    }
    refreshRef.current = refresh
    void refresh()
    const timer = intervalMs
      ? setInterval(() => {
          if (document.visibilityState !== "hidden") void refresh()
        }, intervalMs)
      : undefined
    return () => {
      stopped = true
      clearInterval(timer)
      refreshRef.current = async () => {}
    }
  }, [key, identity, online, intervalMs, enabled])
  const refresh = useCallback(() => refreshRef.current(), [])
  return {
    data: result?.identity === identity && result.key === key ? result.data : null,
    loading,
    refresh,
    authenticated: !!identity,
    online,
  }
}
export function useGameMutation() {
  const [busy, setBusy] = useState(false),
    locked = useRef(false)
  const run = useCallback(async <T>(work: () => Promise<T>): Promise<T | null> => {
    if (locked.current) return null
    locked.current = true
    setBusy(true)
    try {
      return await work()
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "游戏操作失败")
      return null
    } finally {
      locked.current = false
      setBusy(false)
    }
  }, [])
  return { busy, run }
}
