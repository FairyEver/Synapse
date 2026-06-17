import { useCallback, useEffect, useState } from "react"
import { requireSynapseBridge } from "@/lib/electron-bridge"
import type { SynapseGitRepositorySummary } from "@/types/git"

function getGitBridge() {
  return requireSynapseBridge().git
}

export function useGitRepositories() {
  const [summaries, setSummaries] = useState<readonly SynapseGitRepositorySummary[]>([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)

  const refresh = useCallback(async () => {
    setLoading(true)
    setError(null)
    try {
      setSummaries(await getGitBridge().listRepositorySummaries())
    } catch (err) {
      setError(err instanceof Error ? err.message : "读取仓库失败。")
    } finally {
      setLoading(false)
    }
  }, [])

  useEffect(() => {
    void refresh()
  }, [refresh])

  return { summaries, loading, error, refresh }
}
