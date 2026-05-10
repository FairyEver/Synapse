import { useCallback, useState } from "react"
import type { NodeRunResult } from "@/types/workflow"

export type RunState = "idle" | "running" | "completed" | "failed" | "cancelled"

export function useWorkflowRun(workflowId: string) {
  const [runId, setRunId] = useState<string | null>(null)
  const [runState, setRunState] = useState<RunState>("idle")
  const [nodeResults, setNodeResults] = useState<Record<string, NodeRunResult>>({})

  const start = useCallback(async (params: Record<string, unknown>) => {
    setRunState("running"); setNodeResults({})
    const result = await window.synapse?.workflow.run(workflowId, params)
    if (!result) return null
    setRunId(result.runId); return result.runId
  }, [workflowId])

  const cancel = useCallback(async () => { if (runId) await window.synapse?.workflow.cancel(runId) }, [runId])

  return { runId, runState, nodeResults, setRunState, setNodeResults, start, cancel }
}
