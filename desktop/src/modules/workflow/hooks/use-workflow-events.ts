import { useEffect, useRef } from "react"
import type { NodeRunResult, WorkflowEvent } from "@/types/workflow"
import { createRendererLogger } from "@/app-shell/logging"
import { errorDiagnostic, truncateWithEllipsis } from "../lib/error-utils"
import { sanitizeError } from "@/lib/error-sanitize"

const logger = createRendererLogger("workflow.events")

export interface WorkflowEventCallbacks {
  onNodeStarted?: (nodeId: string, partial?: Partial<NodeRunResult>) => void
  onNodeProgress?: (nodeId: string, phase: string, label: string) => void
  onNodeCompleted?: (nodeId: string, output: unknown, result?: NodeRunResult) => void
  onNodeFailed?: (nodeId: string, error: string, result?: NodeRunResult) => void
  onNodeSkipped?: (nodeId: string, result?: NodeRunResult) => void
  onNodeAgentConversation?: (
    nodeId: string,
    target: NonNullable<NodeRunResult["outputs"]>["agentConversation"],
  ) => void
  onCompleted?: (nodeResults: Record<string, NodeRunResult>) => void
  onFailed?: (error: string, nodeResults?: Record<string, NodeRunResult>) => void
  onCancelled?: (nodeResults?: Record<string, NodeRunResult>) => void
  onSnapshotSaveFailed?: (status: "completed" | "failed" | "cancelled") => void
}

export function useWorkflowEvents(
  runId: string | null,
  callbacks: WorkflowEventCallbacks,
  workflowId?: string,
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
      const status = await window.synapse?.workflow.runStatus(runId, workflowId)
      if (cancelled || !status) return
      const skippedByLive = [] as string[]
      for (const [nodeId, nr] of Object.entries(status.nodeResults)) {
        // Skip hydration for nodes already updated by the live event listener
        if (terminalNodes.has(nodeId)) { skippedByLive.push(nodeId); continue }
        if (nr.status === "running") cbRef.current.onNodeStarted?.(nodeId, nr)
        else if (nr.status === "success") cbRef.current.onNodeCompleted?.(nodeId, nr.output, nr)
        else if (nr.status === "failed") cbRef.current.onNodeFailed?.(nodeId, nr.error ?? "Unknown error", nr)
        else if (nr.status === "skipped") cbRef.current.onNodeSkipped?.(nodeId, nr)
      }
      if (skippedByLive.length > 0) {
        logger.info("hydration skipped nodes already updated by live events", { runId, skippedNodes: skippedByLive })
      }
      // Only apply workflow-level terminal state if the live listener hasn't already
      if (workflowTerminal) { logger.info("hydration skipped workflow terminal state (already received via live)", { runId }); return }
      if (status.status === "completed") {
        logger.info("hydration applying workflow:completed", { runId, nodeCount: Object.keys(status.nodeResults).length })
        cbRef.current.onCompleted?.(status.nodeResults)
      } else if (status.status === "failed") {
        logger.info("hydration applying workflow:failed with authoritative nodeResults", {
          runId,
          ...workflowErrorLogMeta(status.error),
          nodeCount: Object.keys(status.nodeResults).length,
        })
        cbRef.current.onFailed?.(status.error ?? "Unknown error", status.nodeResults)
      } else if (status.status === "cancelled") {
        logger.info("hydration applying workflow:cancelled with authoritative nodeResults", { runId, nodeCount: Object.keys(status.nodeResults).length })
        cbRef.current.onCancelled?.(status.nodeResults)
      }
    })().catch((error: unknown) => {
      if (cancelled) return
      logger.warn("workflow hydration status query failed", {
        runId,
        boundary: "renderer.workflow.hydration-status",
        ...errorDiagnostic(error),
      })
      const msg = error instanceof Error ? error.message : String(error)
      cbRef.current.onFailed?.(`运行状态恢复失败：${sanitizeError(msg)}`)
    })

    const unsub = window.synapse?.workflow.onEvent((event: WorkflowEvent) => {
      if (event.runId !== runId) return
      if (event.type === "node:started") {
        cbRef.current.onNodeStarted?.(event.nodeId, event.result ?? { startedAt: event.startedAt ?? Date.now() })
      } else if (event.type === "node:progress") {
        cbRef.current.onNodeProgress?.(event.nodeId, event.phase, event.label)
      } else if (event.type === "node:agent-conversation") {
        cbRef.current.onNodeAgentConversation?.(event.nodeId, event.target)
      } else if (event.type === "node:completed") {
        terminalNodes.add(event.nodeId)
        cbRef.current.onNodeCompleted?.(event.nodeId, event.output, event.result)
      } else if (event.type === "node:failed") {
        terminalNodes.add(event.nodeId)
        cbRef.current.onNodeFailed?.(event.nodeId, event.error, event.result)
      } else if (event.type === "node:skipped") {
        terminalNodes.add(event.nodeId)
        cbRef.current.onNodeSkipped?.(event.nodeId, event.result)
      } else if (event.type === "workflow:completed") {
        workflowTerminal = true
        logger.info("workflow:completed — applying authoritative nodeResults", { runId, nodeCount: Object.keys(event.result.nodeResults).length })
        cbRef.current.onCompleted?.(event.result.nodeResults)
      } else if (event.type === "workflow:failed") {
        workflowTerminal = true
        const hasResults = !!event.result?.nodeResults
        logger.info("workflow:failed — applying terminal state", {
          runId,
          ...workflowErrorLogMeta(event.error),
          hasAuthoritativeResults: hasResults,
          nodeCount: hasResults ? Object.keys(event.result!.nodeResults).length : 0,
        })
        cbRef.current.onFailed?.(event.error, event.result?.nodeResults)
      } else if (event.type === "workflow:cancelled") {
        workflowTerminal = true
        const hasResults = !!event.result?.nodeResults
        logger.info("workflow:cancelled — applying terminal state", { runId, hasAuthoritativeResults: hasResults, nodeCount: hasResults ? Object.keys(event.result!.nodeResults).length : 0 })
        cbRef.current.onCancelled?.(event.result?.nodeResults)
      } else if (event.type === "workflow:snapshot-save-failed") {
        logger.warn("workflow snapshot save failed event received", {
          runId,
          workflowId: event.workflowId,
          status: event.status,
        })
        cbRef.current.onSnapshotSaveFailed?.(event.status)
      }
    })

    return () => { cancelled = true; unsub?.() }
  }, [runId, workflowId])
}

function workflowErrorLogMeta(error: string | undefined): { readonly errorName: string; readonly errorLength: number; readonly errorMessage?: string } {
  return {
    errorName: "workflow",
    errorLength: error?.length ?? 0,
    ...(error ? { errorMessage: truncateWithEllipsis(sanitizeError(error), 200) } : {}),
  }
}
