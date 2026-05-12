import { useCallback, useEffect, useRef, useState } from "react"
import type { WorkflowDefinition, NodeRunResult, WorkflowRunStatus } from "@/types/workflow"
import { createRendererLogger } from "@/app-shell/logging"
import "../../../../workflow-nodes/register.renderer"
import { useWorkflowEvents } from "../hooks/use-workflow-events"
import { RunnerToolbar } from "./runner-toolbar"
import { DagView } from "./dag-view"
import { TimelineView } from "./timeline-view"
import { NodeResultPanel } from "./node-result-panel"
import { ResizableHandle, ResizablePanel, ResizablePanelGroup } from "@/components/ui/resizable"

const logger = createRendererLogger("workflow.runner")

type ViewMode = "dag" | "timeline"

export function WorkflowRunnerApp() {
  const searchParams = new URLSearchParams(window.location.search)
  const workflowId = searchParams.get("workflowId") ?? ""
  const initialRunId = searchParams.get("runId") ?? ""

  const [runId, setRunId] = useState(initialRunId)
  const [definition, setDefinition] = useState<WorkflowDefinition | null>(null)
  const [runState, setRunState] = useState<WorkflowRunStatus["status"]>("running")
  const [nodeResults, setNodeResults] = useState<Record<string, NodeRunResult>>({})
  const [runParams, setRunParams] = useState<Record<string, unknown>>({})
  const [runError, setRunError] = useState<string | null>(null)
  const [viewMode, setViewMode] = useState<ViewMode>("dag")
  const [selectedNodeId, setSelectedNodeId] = useState<string | null>(null)
  const [rerunning, setRerunning] = useState(false)
  const [cancelling, setCancelling] = useState(false)

  const runIdRef = useRef(runId)
  runIdRef.current = runId

  // Hydrate metadata (definition, params) from run status.
  // Node results and run state are exclusively managed by useWorkflowEvents
  // to avoid a race where this IPC response overwrites more-recent live events.
  useEffect(() => {
    if (!runId) return
    let cancelled = false
    void (async () => {
      const status = await window.synapse?.workflow.runStatus(runId)
      if (cancelled || !status) return
      logger.info("hydrated run metadata", { runId, hasDefinition: !!status.definition, hasParams: !!status.params })
      if (status.definition) setDefinition(status.definition)
      if (status.params) setRunParams(status.params)
    })()
    return () => { cancelled = true }
  }, [runId])

  useEffect(() => {
    if (definition) return
    if (!workflowId) return
    let cancelled = false
    void (async () => {
      const def = await window.synapse?.workflow.get(workflowId)
      if (cancelled) return
      if (def) setDefinition(def)
    })()
    return () => { cancelled = true }
  }, [workflowId, definition])

  useEffect(() => {
    if (!workflowId) return
    const unsubEvent = window.synapse?.workflow.onEvent((event) => {
      if (event.type === "workflow:started" && event.workflowId === workflowId) {
        if (runIdRef.current !== event.runId) {
          logger.info("workflow:started in runner — switching to new run", { newRunId: event.runId })
          setRunId(event.runId)
          setRunState("running")
          setNodeResults({})
          setRunError(null)
          setSelectedNodeId(null)
          // Clear definition and params so the runner shows loading state until
          // the hydration effect fetches the new run's metadata. Without this,
          // a stale definition (from a previous workflow version) would render
          // an incorrect DAG topology until the async fetch completes.
          setDefinition(null)
          setRunParams({})
        }
      }
    })
    const unsubSwitch = window.synapse?.workflow.onRunnerSwitchRun((payload) => {
      if (payload?.runId && payload.runId !== runIdRef.current) {
        logger.info("runner-switch-run received", { newRunId: payload.runId })
        setRunId(payload.runId)
        setRunState("running")
        setNodeResults({})
        setRunError(null)
        setSelectedNodeId(null)
        // Same rationale: clear stale definition/params from previous run
        setDefinition(null)
        setRunParams({})
      }
    })
    return () => { unsubEvent?.(); unsubSwitch?.() }
  }, [workflowId])

  useWorkflowEvents(runId, {
    onNodeStarted: (nodeId, partial) => setNodeResults((r) => ({
      ...r,
      [nodeId]: { ...(r[nodeId] ?? { nodeId, input: { variables: {} } }), ...partial, status: "running" as const },
    })),
    onNodeCompleted: (nodeId, output, result) => setNodeResults((r) => ({
      ...r,
      [nodeId]: result ?? { ...(r[nodeId] ?? { nodeId, input: { variables: {} } }), status: "success" as const, output: String(output) },
    })),
    onNodeFailed: (nodeId, error, result) => setNodeResults((r) => ({
      ...r,
      [nodeId]: result ?? { ...(r[nodeId] ?? { nodeId, input: { variables: {} } }), status: "failed" as const, error },
    })),
    onNodeSkipped: (nodeId, result) => setNodeResults((r) => ({
      ...r,
      [nodeId]: result ?? { nodeId, input: { variables: {} }, status: "skipped" as const },
    })),
    onCompleted: (results) => { setRunState("completed"); setRunError(null); setNodeResults(results) },
    onFailed: (error, results) => {
      setRunState("failed"); setRunError(error)
      if (results) setNodeResults(results)
    },
    onCancelled: (results) => {
      setRunState("cancelled"); setRunError(null)
      if (results) setNodeResults(results)
    },
  })

  const handleCancel = useCallback(async () => {
    if (!runId) return
    setCancelling(true)
    try {
      await window.synapse?.workflow.cancel(runId)
    } finally {
      setCancelling(false)
    }
  }, [runId])

  const handleRerun = useCallback(async () => {
    if (!runId) return
    setRerunning(true)
    logger.info("rerun requested", { runId, paramKeys: Object.keys(runParams) })
    try {
      const result = await window.synapse?.workflow.rerun(runId, runParams)
      if (!result) {
        logger.warn("rerun returned empty result — IPC bridge unavailable", { runId })
        setRunError("重新运行失败：IPC 通道不可用")
        return
      }
      if ("errors" in result) {
        const errors = result.errors as Array<{ message?: string }>
        const msg = errors[0]?.message ?? "重新运行失败：校验未通过"
        logger.warn("rerun failed", { errors: result.errors })
        setRunError(msg)
        return
      }
      // Clear definition and params so the runner shows loading state until
      // hydration fetches the new run's metadata (same pattern as workflow:started).
      setDefinition(null)
      setRunParams({})
      setRunId(result.runId)
      setRunState("running")
      setNodeResults({})
      setRunError(null)
      setSelectedNodeId(null)
    } finally {
      setRerunning(false)
    }
  }, [runId, runParams])

  const handleOpenEditor = useCallback(() => {
    void window.synapse?.workflow.openEditor(workflowId)
  }, [workflowId])

  const selectedResult = selectedNodeId
    ? nodeResults[selectedNodeId] ?? { nodeId: selectedNodeId, status: "pending" as const, input: { variables: {} } }
    : null

  if (!definition) {
    return <div className="flex items-center justify-center h-screen text-sm text-muted-foreground">加载中…</div>
  }

  return (
    <div className="flex flex-col h-screen">
      <RunnerToolbar
        definition={definition}
        runState={runState}
        runError={runError}
        viewMode={viewMode}
        rerunning={rerunning}
        cancelling={cancelling}
        onViewModeChange={setViewMode}
        onCancel={handleCancel}
        onRerun={handleRerun}
        onOpenEditor={handleOpenEditor}
      />
      <ResizablePanelGroup orientation="horizontal" className="flex-1 min-h-0">
        <ResizablePanel>
          {viewMode === "dag" ? (
            <DagView
              definition={definition}
              nodeResults={nodeResults}
              runState={runState}
              onNodeSelect={setSelectedNodeId}
            />
          ) : (
            <TimelineView
              definition={definition}
              nodeResults={nodeResults}
              onNodeSelect={setSelectedNodeId}
            />
          )}
        </ResizablePanel>
        {selectedResult && (
          <>
            <ResizableHandle withHandle />
            <ResizablePanel
              defaultSize={350}
              minSize={250}
              maxSize={600}
              groupResizeBehavior="preserve-pixel-size"
            >
              <NodeResultPanel
                result={selectedResult}
                nodeName={definition.nodes.find((n) => n.id === selectedNodeId)?.name ?? selectedNodeId ?? ""}
                definition={definition}
                onClose={() => setSelectedNodeId(null)}
              />
            </ResizablePanel>
          </>
        )}
      </ResizablePanelGroup>
    </div>
  )
}
