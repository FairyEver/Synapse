import { useCallback, useEffect, useState } from "react"
import type { WorkflowMeta } from "@/types/workflow"

export function useWorkflowList() {
  const [items, setItems] = useState<WorkflowMeta[]>([])
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const refresh = useCallback(async () => {
    setLoading(true)
    setError(null)
    try {
      const data = await window.synapse?.workflow.list()
      if (!data) {
        // IPC bridge unavailable — treat as error, not empty
        setError("无法连接到主进程，请稍后重试")
        return
      }
      setItems(data)
    } catch (err) {
      setError(err instanceof Error ? err.message : "加载失败，请重试")
    } finally {
      setLoading(false)
    }
  }, [])
  useEffect(() => { void refresh() }, [refresh])
  return { items, loading, error, refresh }
}
