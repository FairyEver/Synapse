import { useCallback, useEffect, useState } from "react"
import type { WorkflowMeta, WorkflowMigrationDiagnostic } from "@/types/workflow"
import { createRendererLogger } from "@/app-shell/logging"
import { errorDiagnostic } from "../lib/error-utils"

const logger = createRendererLogger("workflow.list")

export function useWorkflowList() {
  const [items, setItems] = useState<WorkflowMeta[]>([])
  const [migrationDiagnostics, setMigrationDiagnostics] = useState<WorkflowMigrationDiagnostic[]>([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const refresh = useCallback(async () => {
    setError(null)
    try {
      const data = await window.synapse?.workflow.list()
      if (!data) {
        // IPC bridge unavailable — treat as error, not empty
        setError("无法连接到主进程，请稍后重试")
        return
      }
      setItems(data.items)
      setMigrationDiagnostics(data.migrationDiagnostics)
    } catch (err) {
      logger.warn("Workflow list refresh failed.", {
        boundary: "renderer.workflow.list",
        ...errorDiagnostic(err),
      })
      setError("加载失败，请重试")
    } finally {
      setLoading(false)
    }
  }, [])
  useEffect(() => { void refresh() }, [refresh])
  useEffect(() => {
    const unsub = window.synapse?.workflow.onDefinitionUpdated?.(() => {
      void refresh()
    })
    return () => { unsub?.() }
  }, [refresh])
  return { items, migrationDiagnostics, loading, error, refresh }
}
