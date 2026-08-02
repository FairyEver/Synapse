import { useCallback, useEffect, useRef, useState } from "react"
import { requireSynapseBridge } from "@/lib/electron-bridge"
import type { SynapseGitDiffResult, SynapseGitFileChange, SynapseGitRepository, SynapseGitRepositorySnapshot } from "@/types/git"

const WORKTREE_REFRESH_INTERVAL_MS = 5_000

type GitWorktreeRefreshOptions = {
  readonly background?: boolean
}

export function useGitWorktreeStatus(
  repository: SynapseGitRepository,
  options: { readonly autoRefreshEnabled?: boolean } = {},
) {
  const autoRefreshEnabled = options.autoRefreshEnabled ?? true
  const [snapshot, setSnapshot] = useState<SynapseGitRepositorySnapshot | null>(null)
  const [selectedFile, setSelectedFile] = useState<SynapseGitFileChange | null>(null)
  const [diff, setDiff] = useState<SynapseGitDiffResult | null>(null)
  const [selectedPaths, setSelectedPaths] = useState<readonly string[]>([])
  const [loading, setLoading] = useState(true)
  const [diffLoading, setDiffLoading] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const diffRequestIdRef = useRef(0)
  const snapshotRequestIdRef = useRef(0)
  const hasLoadedRef = useRef(false)
  const selectedFileRef = useRef<SynapseGitFileChange | null>(null)
  const refreshInFlightRef = useRef(false)

  useEffect(() => {
    selectedFileRef.current = selectedFile
  }, [selectedFile])

  const loadDiff = useCallback(async (
    file: SynapseGitFileChange | null,
    loadOptions: { readonly background?: boolean } = {},
  ) => {
    const requestId = diffRequestIdRef.current + 1
    diffRequestIdRef.current = requestId
    setSelectedFile(file)
    if (!loadOptions.background) setDiff(null)
    if (!file) {
      setDiffLoading(false)
      return
    }
    if (!loadOptions.background) setDiffLoading(true)
    try {
      const nextDiff = await requireSynapseBridge().git.getDiff({
        repositoryId: repository.id,
        path: file.path,
      })
      if (diffRequestIdRef.current === requestId) {
        setDiff(nextDiff)
      }
    } catch (err) {
      if (diffRequestIdRef.current === requestId) {
        setError(err instanceof Error ? err.message : "读取文件差异失败。")
      }
    } finally {
      if (diffRequestIdRef.current === requestId) {
        setDiffLoading(false)
      }
    }
  }, [repository.id])

  const refresh = useCallback(async (refreshOptions: GitWorktreeRefreshOptions = {}) => {
    if (refreshInFlightRef.current) return null
    refreshInFlightRef.current = true
    const requestId = ++snapshotRequestIdRef.current
    if (!refreshOptions.background) setLoading(true)
    try {
      const next = await requireSynapseBridge().git.getSnapshot(repository.id)
      if (snapshotRequestIdRef.current !== requestId) return null
      const wasLoaded = hasLoadedRef.current
      const currentSelectedFile = selectedFileRef.current
      setSnapshot(next)
      setError(null)
      setSelectedPaths((current) => (
        wasLoaded
          ? current.filter((selectedPath) => next.changes.some((change) => change.path === selectedPath))
          : next.changes.map((change) => change.path)
      ))
      const nextSelectedFile = currentSelectedFile
        ? next.changes.find((change) => change.path === currentSelectedFile.path) ?? next.changes[0] ?? null
        : next.changes[0] ?? null
      hasLoadedRef.current = true
      const canPreserveDiff = Boolean(
        refreshOptions.background
        && currentSelectedFile
        && nextSelectedFile
        && currentSelectedFile.path === nextSelectedFile.path
        && currentSelectedFile.originalPath === nextSelectedFile.originalPath
        && currentSelectedFile.status === nextSelectedFile.status,
      )
      await loadDiff(nextSelectedFile, { background: canPreserveDiff })
      return next
    } catch (err) {
      if (snapshotRequestIdRef.current === requestId) {
        setError(err instanceof Error ? err.message : "读取仓库状态失败。")
      }
      return null
    } finally {
      if (snapshotRequestIdRef.current === requestId) {
        if (!refreshOptions.background) setLoading(false)
        refreshInFlightRef.current = false
      }
    }
  }, [loadDiff, repository.id])

  useEffect(() => {
    snapshotRequestIdRef.current += 1
    diffRequestIdRef.current += 1
    refreshInFlightRef.current = false
    hasLoadedRef.current = false
    selectedFileRef.current = null
    setSnapshot(null)
    setSelectedFile(null)
    setDiff(null)
    setSelectedPaths([])
    setLoading(true)
    setDiffLoading(false)
    setError(null)
    void refresh()
  }, [refresh, repository.id])

  useEffect(() => {
    if (!autoRefreshEnabled) return
    const refreshWhenVisible = () => {
      if (document.visibilityState === "visible") void refresh({ background: true })
    }
    window.addEventListener("focus", refreshWhenVisible)
    document.addEventListener("visibilitychange", refreshWhenVisible)
    const interval = window.setInterval(refreshWhenVisible, WORKTREE_REFRESH_INTERVAL_MS)
    return () => {
      window.removeEventListener("focus", refreshWhenVisible)
      document.removeEventListener("visibilitychange", refreshWhenVisible)
      window.clearInterval(interval)
    }
  }, [autoRefreshEnabled, refresh])

  const togglePath = useCallback((path: string) => {
    setSelectedPaths((current) => (
      current.includes(path)
        ? current.filter((item) => item !== path)
        : [...current, path]
    ))
  }, [])

  const selectAll = useCallback(() => {
    setSelectedPaths(snapshot?.changes.map((change) => change.path) ?? [])
  }, [snapshot])

  const clearSelection = useCallback(() => {
    setSelectedPaths([])
  }, [])

  return {
    snapshot,
    selectedFile,
    diff,
    selectedPaths,
    loading,
    diffLoading,
    error,
    refresh,
    loadDiff,
    togglePath,
    selectAll,
    clearSelection,
  }
}
