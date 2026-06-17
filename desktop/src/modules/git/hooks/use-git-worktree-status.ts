import { useCallback, useEffect, useState } from "react"
import { requireSynapseBridge } from "@/lib/electron-bridge"
import type { SynapseGitDiffResult, SynapseGitFileChange, SynapseGitRepository, SynapseGitRepositorySnapshot } from "@/types/git"

export function useGitWorktreeStatus(repository: SynapseGitRepository) {
  const [snapshot, setSnapshot] = useState<SynapseGitRepositorySnapshot | null>(null)
  const [selectedFile, setSelectedFile] = useState<SynapseGitFileChange | null>(null)
  const [diff, setDiff] = useState<SynapseGitDiffResult | null>(null)
  const [selectedPaths, setSelectedPaths] = useState<readonly string[]>([])
  const [loading, setLoading] = useState(true)
  const [diffLoading, setDiffLoading] = useState(false)
  const [error, setError] = useState<string | null>(null)

  const loadDiff = useCallback(async (file: SynapseGitFileChange | null) => {
    setSelectedFile(file)
    setDiff(null)
    if (!file) return
    setDiffLoading(true)
    try {
      setDiff(await requireSynapseBridge().git.getDiff({
        repositoryId: repository.id,
        path: file.path,
        originalPath: file.originalPath,
        staged: file.staged,
      }))
    } catch (err) {
      setError(err instanceof Error ? err.message : "读取文件差异失败。")
    } finally {
      setDiffLoading(false)
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
    } catch (err) {
      setError(err instanceof Error ? err.message : "读取仓库状态失败。")
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
  }
}
