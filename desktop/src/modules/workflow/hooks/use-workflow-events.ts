import { useEffect, useRef } from "react"
import type { NodeRunResult, WorkflowEvent } from "@/types/workflow"
import { createRendererLogger } from "@/app-shell/logging"

const logger = createRendererLogger("workflow.events")

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
    // Track nodes that have already reached a terminal state via the live event
    // listener. Hydration must NOT regress these nodes to an earlier status.
    const terminalNodes = new Set<string>()
    let workflowTerminal = false
    let cancelled = false

    // Hydrate current state to cover events emitted before subscription.
    // This closes the race window between engine.run() start and subscription setup.
    void (async () => {
      const status = await window.synapse?.workflow.runStatus(runId)
      if (cancelled || !status) return
      const skippedByLive = [] as string[]
      for (const [nodeId, nr] of Object.entries(status.nodeResults)) {
        // Skip hydration for nodes already updated by the live event listener
        if (terminalNodes.has(nodeId)) { skippedByLive.push(nodeId); continue }
        if (nr.status === "running") cbRef.current.onNodeStarted?.(nodeId)
        else if (nr.status === "success") cbRef.current.onNodeCompleted?.(nodeId, nr.output, nr)
        else if (nr.status === "failed") cbRef.current.onNodeFailed?.(nodeId, nr.error ?? "Unknown error", nr)
        else if (nr.status === "skipped") cbRef.current.onNodeSkipped?.(nodeId)
      }
      if (skippedByLive.length > 0) {
        logger.info("hydration skipped nodes already updated by live events", { runId, skippedNodes: skippedByLive })
      }
      // Only apply workflow-level terminal state if the live listener hasn't already
      if (workflowTerminal) { logger.info("hydration skipped workflow terminal state (already received via live)", { runId }); return }
      if (status.status === "completed") cbRef.current.onCompleted?.(status.nodeResults)
      else if (status.status === "failed") cbRef.current.onFailed?.(status.error ?? "Unknown error")
      else if (status.status === "cancelled") cbRef.current.onCancelled?.()
    })()

    const unsub = window.synapse?.workflow.onEvent((event: WorkflowEvent) => {
      if (event.runId !== runId) return
      if (event.type === "node:started") {
        cbRef.current.onNodeStarted?.(event.nodeId)
      } else if (event.type === "node:completed") {
        terminalNodes.add(event.nodeId)
        cbRef.current.onNodeCompleted?.(event.nodeId, event.output, event.result)
      } else if (event.type === "node:failed") {
        terminalNodes.add(event.nodeId)
        cbRef.current.onNodeFailed?.(event.nodeId, event.error, event.result)
      } else if (event.type === "node:skipped") {
        terminalNodes.add(event.nodeId)
        cbRef.current.onNodeSkipped?.(event.nodeId)
      } else if (event.type === "workflow:completed") {
        workflowTerminal = true
        cbRef.current.onCompleted?.(event.result.nodeResults)
      } else if (event.type === "workflow:failed") {
        workflowTerminal = true
        cbRef.current.onFailed?.(event.error)
      } else if (event.type === "workflow:cancelled") {
        workflowTerminal = true
        cbRef.current.onCancelled?.()
      }
    })

    return () => { cancelled = true; unsub?.() }
  }, [runId])
}
