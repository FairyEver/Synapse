import { useEffect, useRef } from "react"
import type { NodeRunResult, WorkflowEvent } from "@/types/workflow"

export interface WorkflowEventCallbacks {
  onNodeStarted?: (nodeId: string) => void
  onNodeCompleted?: (nodeId: string, output: unknown, result?: NodeRunResult) => void
  onNodeFailed?: (nodeId: string, error: string, result?: NodeRunResult) => void
  onNodeSkipped?: (nodeId: string) => void
  onCompleted?: (nodeResults: Record<string, NodeRunResult>) => void
  onFailed?: (error: string) => void
  onCancelled?: () => void
}

export function useWorkflowEvents(
  runId: string | null,
  callbacks: WorkflowEventCallbacks,
) {
  // Keep a stable ref to callbacks so the subscription always uses the latest
  const cbRef = useRef(callbacks)
  cbRef.current = callbacks

  useEffect(() => {
    if (!runId) return
    // Hydrate current state to cover events emitted before subscription.
    // This closes the race window between engine.run() start and subscription setup.
    let cancelled = false
    void (async () => {
      const status = await window.synapse?.workflow.runStatus(runId)
      if (cancelled || !status) return
      for (const [nodeId, nr] of Object.entries(status.nodeResults)) {
        if (nr.status === "running") cbRef.current.onNodeStarted?.(nodeId)
        else if (nr.status === "success") cbRef.current.onNodeCompleted?.(nodeId, nr.output, nr)
        else if (nr.status === "failed") cbRef.current.onNodeFailed?.(nodeId, nr.error ?? "Unknown error", nr)
        else if (nr.status === "skipped") cbRef.current.onNodeSkipped?.(nodeId)
      }
      if (status.status === "completed") cbRef.current.onCompleted?.(status.nodeResults)
      else if (status.status === "failed") cbRef.current.onFailed?.(status.error ?? "Unknown error")
      else if (status.status === "cancelled") cbRef.current.onCancelled?.()
    })()

    const unsub = window.synapse?.workflow.onEvent((event: WorkflowEvent) => {
      if (event.runId !== runId) return
      if (event.type === "node:started") cbRef.current.onNodeStarted?.(event.nodeId)
      else if (event.type === "node:completed") cbRef.current.onNodeCompleted?.(event.nodeId, event.output, event.result)
      else if (event.type === "node:failed") cbRef.current.onNodeFailed?.(event.nodeId, event.error, event.result)
      else if (event.type === "node:skipped") cbRef.current.onNodeSkipped?.(event.nodeId)
      else if (event.type === "workflow:completed") cbRef.current.onCompleted?.(event.result.nodeResults)
      else if (event.type === "workflow:failed") cbRef.current.onFailed?.(event.error)
      else if (event.type === "workflow:cancelled") cbRef.current.onCancelled?.()
    })

    return () => { cancelled = true; unsub?.() }
  }, [runId])
}
