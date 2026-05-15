import { useCallback, useEffect, useState } from "react"
import type { WorkflowMeta } from "@/types/workflow"
import { createRendererLogger } from "@/app-shell/logging"

const logger = createRendererLogger("workflow.list")

export function useWorkflowList() {
  const [items, setItems] = useState<WorkflowMeta[]>([])
  const [loading, setLoading] = useState(true)
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
      logger.warn("Workflow list refresh failed.", {
        boundary: "renderer.workflow.list",
        ...errorLogMeta(err),
      })
      setError("加载失败，请重试")
    } finally {
      setLoading(false)
    }
  }, [])
  useEffect(() => { void refresh() }, [refresh])
  return { items, loading, error, refresh }
}

function errorLogMeta(error: unknown): { readonly errorName: string; readonly errorLength: number } {
  const text = error instanceof Error
    ? error.message
    : typeof error === "string"
      ? error
      : String(error)
  return {
    errorName: error instanceof Error ? error.name : typeof error,
    errorLength: text.length,
  }
}
