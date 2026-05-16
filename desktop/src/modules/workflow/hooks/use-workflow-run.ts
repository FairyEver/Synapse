import { useCallback, useEffect, useState } from "react"
import type { NodeRunResult, ValidationError } from "@/types/workflow"
import { createRendererLogger } from "@/app-shell/logging"
import { errorDiagnostic } from "../lib/error-utils"

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
      try {
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
      } catch (err) {
        if (cancelled) return
        logger.error("initial run status IPC call failed, resetting to idle", {
          workflowId,
          initialRunId,
          boundary: "renderer.workflow.run.initial-status",
          ...errorDiagnostic(err),
        })
        setRunState("idle")
      }
    })()
    return () => { cancelled = true }
  }, [initialRunId, workflowId])

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
      logger.error("run IPC call failed, resetting to idle", {
        workflowId,
        boundary: "renderer.workflow.run.start",
        ...errorDiagnostic(err),
      })
      setRunState("idle")
      return null
    }
  }, [workflowId])

  const cancel = useCallback(async () => {
    if (!runId) return
    logger.info("cancelling run", { workflowId, runId })
    try {
      await window.synapse?.workflow.cancel(runId)
    } catch (err) {
      logger.error("cancel IPC call failed", {
        workflowId,
        runId,
        boundary: "renderer.workflow.run.cancel",
        ...errorDiagnostic(err),
      })
    }
  }, [workflowId, runId])

  return { runId, runState, nodeResults, setRunState, setNodeResults, start, cancel, attachRun }
}
