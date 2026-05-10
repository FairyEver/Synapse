import { useEffect } from "react"
import type { NodeRunResult, WorkflowEvent } from "@/types/workflow"

export function useWorkflowEvents(
  runId: string | null,
  callbacks: {
    onNodeStarted?: (nodeId: string) => void
    onNodeCompleted?: (nodeId: string, output: unknown, result?: NodeRunResult) => void
    onNodeFailed?: (nodeId: string, error: string, result?: NodeRunResult) => void
    onNodeSkipped?: (nodeId: string) => void
    onCompleted?: (nodeResults: Record<string, NodeRunResult>) => void
    onFailed?: (error: string) => void
    onCancelled?: () => void
  },
) {
  useEffect(() => {
    if (!runId) return
    return window.synapse?.workflow.onEvent((event: WorkflowEvent) => {
      if (event.type === "node:started") callbacks.onNodeStarted?.(event.nodeId)
      else if (event.type === "node:completed") callbacks.onNodeCompleted?.(event.nodeId, event.output, event.result)
      else if (event.type === "node:failed") callbacks.onNodeFailed?.(event.nodeId, event.error, event.result)
      else if (event.type === "node:skipped") callbacks.onNodeSkipped?.(event.nodeId)
      else if (event.type === "workflow:completed") callbacks.onCompleted?.(event.result.nodeResults)
      else if (event.type === "workflow:failed") callbacks.onFailed?.(event.error)
      else if (event.type === "workflow:cancelled") callbacks.onCancelled?.()
    })
  }, [runId])
}
