import { useCallback, useEffect, useState } from "react"
import type { WorkflowMeta } from "@/types/workflow"

export function useWorkflowList() {
  const [items, setItems] = useState<WorkflowMeta[]>([])
  const [loading, setLoading] = useState(false)
  const refresh = useCallback(async () => {
    setLoading(true)
    try { setItems(await window.synapse?.workflow.list() ?? []) } finally { setLoading(false) }
  }, [])
  useEffect(() => { void refresh() }, [refresh])
  return { items, loading, refresh }
}
