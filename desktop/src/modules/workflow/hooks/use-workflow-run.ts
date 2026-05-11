import { useCallback, useEffect, useState } from "react"
import type { NodeRunResult, ValidationError } from "@/types/workflow"
import { createRendererLogger } from "@/app-shell/logging"

const logger = createRendererLogger("workflow.run")

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
        logger.info("initial run status not found, resetting to idle", { workflowId, initialRunId })
        setRunState("idle")
        return
      }
      logger.info("hydrated initial run status", { workflowId, initialRunId, status: status.status })
      setNodeResults(status.nodeResults)
      setRunState(status.status)
    })()
    return () => { cancelled = true }
  }, [initialRunId])

  const attachRun = useCallback((nextRunId: string) => {
    logger.info("attaching to run", { workflowId, runId: nextRunId })
    setRunId(nextRunId)
    setRunState("running")
    setNodeResults({})
  }, [workflowId])

  const start = useCallback(async (params: Record<string, unknown>): Promise<{ runId: string } | { errors: ValidationError[] } | null> => {
    logger.info("starting workflow run", { workflowId, paramKeys: Object.keys(params) })
    setRunState("running"); setNodeResults({})
    try {
      const result = await window.synapse?.workflow.run(workflowId, params)
      if (!result) { logger.warn("run returned empty result, resetting to idle", { workflowId }); setRunState("idle"); return null }
      if ("errors" in result) { logger.warn("run blocked by validation", { workflowId, errors: result.errors }); setRunState("idle"); return result }
      logger.info("run started successfully", { workflowId, runId: result.runId })
      setRunId(result.runId); return result
    } catch (err) {
      logger.error("run IPC call failed, resetting to idle", { workflowId, error: err instanceof Error ? err.message : String(err) })
      setRunState("idle")
      return null
    }
  }, [workflowId])

  const cancel = useCallback(async () => { if (runId) { logger.info("cancelling run", { workflowId, runId }); await window.synapse?.workflow.cancel(runId) } }, [workflowId, runId])

  return { runId, runState, nodeResults, setRunState, setNodeResults, start, cancel, attachRun }
}
