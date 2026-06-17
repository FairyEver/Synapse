import { useCallback, useEffect, useState } from "react"
import { requireSynapseBridge } from "@/lib/electron-bridge"
import type { SynapseGitCommitDetail, SynapseGitCommitSummary, SynapseGitRepository } from "@/types/git"

export function useGitHistory(repository: SynapseGitRepository) {
  const [commits, setCommits] = useState<readonly SynapseGitCommitSummary[]>([])
  const [selectedCommit, setSelectedCommit] = useState<SynapseGitCommitDetail | null>(null)
  const [loading, setLoading] = useState(true)
  const [detailLoading, setDetailLoading] = useState(false)
  const [error, setError] = useState<string | null>(null)

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
      const first = next[0]
      if (first) {
        await loadCommit(first.hash)
      } else {
        setSelectedCommit(null)
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : "读取历史失败。")
    } finally {
      setLoading(false)
    }
  }, [loadCommit, repository.id])

  useEffect(() => {
    void refresh()
  }, [refresh])

  return { commits, selectedCommit, loading, detailLoading, error, refresh, loadCommit }
}
