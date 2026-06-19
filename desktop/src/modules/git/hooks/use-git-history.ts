import { useCallback, useEffect, useState } from "react"
import { requireSynapseBridge } from "@/lib/electron-bridge"
import type { SynapseGitCommitDetail, SynapseGitCommitSummary, SynapseGitRepository } from "@/types/git"

type UseGitHistoryOptions = {
  readonly enabled?: boolean
}

export function useGitHistory(repository: SynapseGitRepository, options: UseGitHistoryOptions = {}) {
  const enabled = options.enabled ?? true
  const [commits, setCommits] = useState<readonly SynapseGitCommitSummary[]>([])
  const [selectedCommit, setSelectedCommit] = useState<SynapseGitCommitDetail | null>(null)
  const [loading, setLoading] = useState(false)
  const [detailLoading, setDetailLoading] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [hasLoaded, setHasLoaded] = useState(false)

  const loadCommit = useCallback(async (hash: string) => {
    setDetailLoading(true)
    setError(null)
    try {
      setSelectedCommit(await requireSynapseBridge().git.getCommit(repository.id, hash))
    } catch (err) {
      setError(err instanceof Error ? err.message : "读取提交详情失败。")
    } finally {
      setDetailLoading(false)
    }
  }, [repository.id])

  const refresh = useCallback(async () => {
    setLoading(true)
    setError(null)
    try {
      const next = await requireSynapseBridge().git.listHistory({
        repositoryId: repository.id,
        limit: 40,
        offset: 0,
      })
      setCommits(next)
      setSelectedCommit(null)
      setHasLoaded(true)
    } catch (err) {
      setError(err instanceof Error ? err.message : "读取历史失败。")
      setHasLoaded(true)
    } finally {
      setLoading(false)
    }
  }, [repository.id])

  useEffect(() => {
    if (!enabled || hasLoaded) return
    void refresh()
  }, [enabled, hasLoaded, refresh])

  return { commits, selectedCommit, loading, detailLoading, error, hasLoaded, refresh, loadCommit }
}
