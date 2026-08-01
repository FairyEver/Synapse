import { useCallback, useEffect, useRef, useState } from "react"
import { requireSynapseBridge } from "@/lib/electron-bridge"
import type { SynapseGitDiffResult, SynapseGitFileChange, SynapseGitRepository, SynapseGitRepositorySnapshot } from "@/types/git"

export function gitCommitPathsForSelection(
  changes: readonly SynapseGitFileChange[],
  selectedPaths: readonly string[],
): string[] {
  const selected = new Set(selectedPaths)
  const commitPaths: string[] = []
  for (const change of changes) {
    if (!selected.has(change.path)) continue
    if (change.originalPath && change.originalPath !== change.path) {
      commitPaths.push(change.originalPath)
    }
    commitPaths.push(change.path)
  }
  return Array.from(new Set(commitPaths))
}

export function useGitWorktreeStatus(repository: SynapseGitRepository) {
  const [snapshot, setSnapshot] = useState<SynapseGitRepositorySnapshot | null>(null)
  const [selectedFile, setSelectedFile] = useState<SynapseGitFileChange | null>(null)
  const [diff, setDiff] = useState<SynapseGitDiffResult | null>(null)
  const [selectedPaths, setSelectedPaths] = useState<readonly string[]>([])
  const [loading, setLoading] = useState(true)
  const [diffLoading, setDiffLoading] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const diffRequestIdRef = useRef(0)

  const loadDiff = useCallback(async (file: SynapseGitFileChange | null) => {
    const requestId = diffRequestIdRef.current + 1
    diffRequestIdRef.current = requestId
    setSelectedFile(file)
    setDiff(null)
    if (!file) {
      setDiffLoading(false)
      return
    }
    setDiffLoading(true)
    try {
      const nextDiff = await requireSynapseBridge().git.getDiff({
        repositoryId: repository.id,
        path: file.path,
        originalPath: file.originalPath,
        status: file.status,
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

  const refresh = useCallback(async () => {
    setLoading(true)
    setError(null)
    try {
      const next = await requireSynapseBridge().git.getSnapshot(repository.id)
      setSnapshot(next)
      setSelectedPaths(next.changes.map((change) => change.path))
      await loadDiff(next.changes[0] ?? null)
      return next
    } catch (err) {
      setError(err instanceof Error ? err.message : "读取仓库状态失败。")
      return null
    } finally {
      setLoading(false)
    }
  }, [loadDiff, repository.id])

  useEffect(() => {
    void refresh()
  }, [refresh])

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
