import { useCallback, useEffect, useRef, useState } from "react"
import { requireSynapseBridge } from "@/lib/electron-bridge"
import type { SynapseGitCommitDetail, SynapseGitCommitSummary, SynapseGitRepository } from "@/types/git"

type UseGitHistoryOptions = {
  readonly enabled?: boolean
}

const HISTORY_PAGE_SIZE = 40

export function useGitHistory(repository: SynapseGitRepository, options: UseGitHistoryOptions = {}) {
  const enabled = options.enabled ?? true
  const [commits, setCommits] = useState<readonly SynapseGitCommitSummary[]>([])
  const [selectedCommit, setSelectedCommit] = useState<SynapseGitCommitDetail | null>(null)
  const [loading, setLoading] = useState(false)
  const [loadingMore, setLoadingMore] = useState(false)
  const [hasMore, setHasMore] = useState(false)
  const [detailLoading, setDetailLoading] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [hasLoaded, setHasLoaded] = useState(false)
  const listRequestIdRef = useRef(0)
  const detailRequestIdRef = useRef(0)

  const loadCommit = useCallback(async (hash: string) => {
    const requestId = ++detailRequestIdRef.current
    setDetailLoading(true)
    setError(null)
    try {
      const detail = await requireSynapseBridge().git.getCommit(repository.id, hash)
      if (detailRequestIdRef.current === requestId) setSelectedCommit(detail)
    } catch (err) {
      if (detailRequestIdRef.current === requestId) {
        setError(err instanceof Error ? err.message : "读取提交详情失败。")
      }
    } finally {
      if (detailRequestIdRef.current === requestId) setDetailLoading(false)
    }
  }, [repository.id])

  const refresh = useCallback(async () => {
    const requestId = ++listRequestIdRef.current
    detailRequestIdRef.current += 1
    setLoading(true)
    setLoadingMore(false)
    setDetailLoading(false)
    setError(null)
    try {
      const next = await requireSynapseBridge().git.listHistory({
        repositoryId: repository.id,
        limit: HISTORY_PAGE_SIZE + 1,
        offset: 0,
      })
      if (listRequestIdRef.current === requestId) {
        setCommits(next.slice(0, HISTORY_PAGE_SIZE))
        setHasMore(next.length > HISTORY_PAGE_SIZE)
        setSelectedCommit(null)
        setHasLoaded(true)
      }
    } catch (err) {
      if (listRequestIdRef.current === requestId) {
        setError(err instanceof Error ? err.message : "读取历史失败。")
        setHasLoaded(true)
      }
    } finally {
      if (listRequestIdRef.current === requestId) setLoading(false)
    }
  }, [repository.id])

  const loadMore = useCallback(async () => {
    if (loading || loadingMore || !hasMore) return
    const requestId = ++listRequestIdRef.current
    setLoadingMore(true)
    setError(null)
    try {
      const next = await requireSynapseBridge().git.listHistory({
        repositoryId: repository.id,
        limit: HISTORY_PAGE_SIZE + 1,
        offset: commits.length,
      })
      if (listRequestIdRef.current === requestId) {
        setCommits((current) => [...current, ...next.slice(0, HISTORY_PAGE_SIZE)])
        setHasMore(next.length > HISTORY_PAGE_SIZE)
      }
    } catch (err) {
      if (listRequestIdRef.current === requestId) {
        setError(err instanceof Error ? err.message : "读取更多历史失败。")
      }
    } finally {
      if (listRequestIdRef.current === requestId) setLoadingMore(false)
    }
  }, [commits.length, hasMore, loading, loadingMore, repository.id])

  useEffect(() => {
    listRequestIdRef.current += 1
    detailRequestIdRef.current += 1
    setCommits([])
    setSelectedCommit(null)
    setLoading(false)
    setLoadingMore(false)
    setHasMore(false)
    setDetailLoading(false)
    setError(null)
    setHasLoaded(false)
  }, [repository.id])

  useEffect(() => {
    if (!enabled || hasLoaded) return
    void refresh()
  }, [enabled, hasLoaded, refresh])

  return {
    commits,
    selectedCommit,
    loading,
    loadingMore,
    hasMore,
    detailLoading,
    error,
    hasLoaded,
    refresh,
    loadMore,
    loadCommit,
  }
}
