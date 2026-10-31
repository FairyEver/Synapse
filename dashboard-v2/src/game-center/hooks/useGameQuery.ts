import { useCallback, useEffect, useRef, useState } from "react"
import { toast } from "@heroui/react"
import { useAccount } from "@/game-center/runtime/account"
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
  const [result, setResult] = useState<{
    key: string
    identity: string
    data: T
  } | null>(null)
  const [failure, setFailure] = useState<{
    key: string
    identity: string
    message: string
  } | null>(null)
  const [loading, setLoading] = useState(false)
  const errorToast = useRef<string | null>(null)
  const refreshRef = useRef<() => Promise<void>>(async () => {})
  useEffect(() => {
    let stopped = false,
      busy = false
    let trailing: { promise: Promise<void>; resolve: () => void } | null = null
    setResult(null)
    setFailure(null)
    if (!identity || !online || !enabled) {
      setLoading(false)
      return
    }
    const readOnce = async () => {
      if (stopped) return
      busy = true
      setLoading(true)
      try {
        const data = await reader.current()
        if (!stopped) {
          setResult({ key, identity, data })
          setFailure(null)
        }
      } catch (error) {
        if (!stopped) {
          const message = error instanceof Error ? error.message : "游戏数据读取失败"
          setFailure({ key, identity, message })
          if (!errorToast.current || !toast.update(errorToast.current, message, { variant: "danger", timeout: 4000 })) errorToast.current = toast.danger(message)
        }
      } finally {
        busy = false
        if (!stopped) setLoading(false)
        const next = trailing
        trailing = null
        if (next) {
          if (stopped) next.resolve()
          else void readOnce().then(next.resolve)
        }
      }
    }
    const refresh = () => {
      if (stopped) return Promise.resolve()
      if (!busy) return readOnce()
      if (!trailing) {
        let resolve!: () => void
        const promise = new Promise<void>((done) => {
          resolve = done
        })
        trailing = { promise, resolve }
      }
      return trailing.promise
    }
    refreshRef.current = refresh
    void refresh()
    const timer = intervalMs
      ? setInterval(() => {
          if (!busy && document.visibilityState !== "hidden") void readOnce()
        }, intervalMs)
      : undefined
    return () => {
      stopped = true
      trailing?.resolve()
      trailing = null
      clearInterval(timer)
      refreshRef.current = async () => {}
    }
  }, [key, identity, online, intervalMs, enabled])
  const refresh = useCallback(() => refreshRef.current(), [])
  return {
    data: result?.identity === identity && result.key === key ? result.data : null,
    loading,
    error:
      enabled && identity && !online
        ? "当前离线，请检查连接后重试。"
        : failure?.identity === identity && failure.key === key
          ? failure.message
          : null,
    refresh,
    authenticated: !!identity,
    online,
  }
}
export function useGameMutation() {
  const { state } = useAccount()
  const identity = state.status === "authenticated" ? state.profile.user.id : null
  const identityRef = useRef(identity)
  identityRef.current = identity
  const [busy, setBusy] = useState(false)
  const mounted = useRef(false)
  const pending = useRef<symbol | null>(null)
  useEffect(() => {
    mounted.current = true
    pending.current = null
    setBusy(false)
    return () => {
      mounted.current = false
      pending.current = null
    }
  }, [identity])
  const run = useCallback(async <T>(work: () => Promise<T>): Promise<T | null> => {
    if (pending.current || !mounted.current || !identityRef.current) return null
    const ticket = Symbol(),
      startedIdentity = identityRef.current
    pending.current = ticket
    setBusy(true)
    const current = () =>
      mounted.current && identityRef.current === startedIdentity && pending.current === ticket
    try {
      const result = await work()
      return current() ? result : null
    } catch (error) {
      if (current()) toast.danger(error instanceof Error ? error.message : "游戏操作失败")
      return null
    } finally {
      if (pending.current === ticket) {
        pending.current = null
        if (mounted.current) setBusy(false)
      }
    }
  }, [])
  return { busy, run }
}
