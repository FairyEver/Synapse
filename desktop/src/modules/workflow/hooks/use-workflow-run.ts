import { useCallback, useEffect, useState } from "react"
import type { NodeRunResult } from "@/types/workflow"

export type RunState = "idle" | "running" | "completed" | "failed" | "cancelled"

export function useWorkflowRun(workflowId: string, initialRunId?: string | null) {
  const [runId, setRunId] = useState<string | null>(() => initialRunId ?? null)
  const [runState, setRunState] = useState<RunState>(() => initialRunId ? "running" : "idle")
  const [nodeResults, setNodeResults] = useState<Record<string, NodeRunResult>>({})

  useEffect(() => {
    if (!initialRunId) return
    let cancelled = false
    void (async () => {
      const status = await window.synapse?.workflow.runStatus(initialRunId)
      if (cancelled) return
      if (!status) {
        setRunState("idle")
        return
      }
      setNodeResults(status.nodeResults)
      setRunState(status.status)
    })()
    return () => { cancelled = true }
  }, [initialRunId])

  const attachRun = useCallback((nextRunId: string) => {
    setRunId(nextRunId)
    setRunState("running")
    setNodeResults({})
  }, [])

  const start = useCallback(async (params: Record<string, unknown>) => {
    setRunState("running"); setNodeResults({})
    const result = await window.synapse?.workflow.run(workflowId, params)
    if (!result || "errors" in result) { setRunState("idle"); return null }
    setRunId(result.runId); return result.runId
  }, [workflowId])

  const cancel = useCallback(async () => { if (runId) await window.synapse?.workflow.cancel(runId) }, [runId])

  return { runId, runState, nodeResults, setRunState, setNodeResults, start, cancel, attachRun }
}
