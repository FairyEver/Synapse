import { useCallback, useEffect, useRef, useState } from "react"
import { requireSynapseBridge } from "@/lib/electron-bridge"
import type { SynapseGitRepositorySummary } from "@/types/git"

function getGitBridge() {
  return requireSynapseBridge().git
}

export function useGitRepositories() {
  const [summaries, setSummaries] = useState<readonly SynapseGitRepositorySummary[]>([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const requestIdRef = useRef(0)
  const refreshInFlightRef = useRef(false)

  const refresh = useCallback(async (options: { readonly background?: boolean } = {}) => {
    if (refreshInFlightRef.current) return
    refreshInFlightRef.current = true
    const requestId = ++requestIdRef.current
    if (!options.background) setLoading(true)
    try {
      const next = await getGitBridge().listRepositorySummaries()
      if (requestIdRef.current === requestId) {
        setSummaries(next)
        setError(null)
      }
    } catch (err) {
      if (requestIdRef.current === requestId) {
        setError(err instanceof Error ? err.message : "读取仓库失败。")
      }
    } finally {
      if (requestIdRef.current === requestId && !options.background) setLoading(false)
      refreshInFlightRef.current = false
    }
  }, [])

  useEffect(() => {
    void refresh()
  }, [refresh])

  useEffect(() => {
    const refreshWhenVisible = () => {
      if (document.visibilityState === "visible") void refresh({ background: true })
    }
    window.addEventListener("focus", refreshWhenVisible)
    document.addEventListener("visibilitychange", refreshWhenVisible)
    return () => {
      window.removeEventListener("focus", refreshWhenVisible)
      document.removeEventListener("visibilitychange", refreshWhenVisible)
    }
  }, [refresh])

  return { summaries, loading, error, refresh }
}
