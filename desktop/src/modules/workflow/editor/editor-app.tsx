import { useCallback, useEffect, useRef, useState } from "react"
import { AlertCircle, X } from "lucide-react"
import { AlertDialog, AlertDialogCancel, AlertDialogContent, AlertDialogDescription, AlertDialogFooter, AlertDialogHeader, AlertDialogTitle } from "@/components/ui/alert-dialog"
import type { WorkflowDefinition, NodeRunResult, ValidationError } from "@/types/workflow"
import { Alert, AlertDescription, AlertTitle, AlertAction } from "@/components/ui/alert"
import { createRendererLogger } from "@/app-shell/logging"
// Side-effect: populate node type registry in the editor window's renderer process.
// Without this, NodePalette.listTypes() returns [] and users cannot add nodes.
// Use the renderer-only entry so we don't pull main-process executors into the
// Vite bundle (they import `electron`, `node:path`, etc.).
import "../../../../workflow-nodes/register.renderer"
import { Button } from "@/components/ui/button"
import { useWorkflowRun } from "../hooks/use-workflow-run"
import { useWorkflowEvents } from "../hooks/use-workflow-events"
import { WorkflowToolbar } from "./toolbar"
import { WorkflowCanvas, type WorkflowCanvasHandle } from "./canvas"
import { ExecutionOverlay } from "./execution-overlay"
import { NodePalette } from "./node-palette"
import { NodeConfigPanel } from "./node-config-panel"
import { ResizableHandle, ResizablePanel, ResizablePanelGroup } from "@/components/ui/resizable"

const logger = createRendererLogger("workflow.editor")

export function WorkflowEditorApp() {
  const searchParams = new URLSearchParams(window.location.search)
  const workflowId = searchParams.get("workflowId") ?? ""
  const initialRunId = searchParams.get("runId")
  const [definition, setDefinition] = useState<WorkflowDefinition | null>(null)
  const [selectedNodeId, setSelectedNodeId] = useState<string | null>(null)
  const [viewingNodeId, setViewingNodeId] = useState<string | null>(null)
  const [runErrors, setRunErrors] = useState<ValidationError[]>([])
  const [showCloseDialog, setShowCloseDialog] = useState(false)
  const setShowCloseDialogRef = useRef(setShowCloseDialog)
  setShowCloseDialogRef.current = setShowCloseDialog
  const canvasRef = useRef<WorkflowCanvasHandle>(null)
  const renameSignalRef = useRef<number>(0)
  const definitionRef = useRef(definition)
  definitionRef.current = definition
  const isDirtyRef = useRef(false)
  const { runId, runState, nodeResults, setRunState, setNodeResults, start, cancel, attachRun } = useWorkflowRun(workflowId, initialRunId)
  const [runError, setRunError] = useState<string | null>(null)
  // Track current runId in a ref so the workflow:started listener can avoid
  // re-attaching (and wiping nodeResults) for a run already managed locally.
  const runIdRef = useRef(runId)
  runIdRef.current = runId

  useEffect(() => {
    if (!workflowId) return
    const workflowApi = window.synapse?.workflow
    if (!workflowApi) return
    let cancelled = false
    void (async () => {
      const [def, snapshots] = await Promise.all([
        workflowApi.get(workflowId),
        workflowApi.runHistory(workflowId),
      ])
      if (cancelled) return
      if (def) setDefinition(def)
      // Only apply snapshot results when there is NO active run.
      // When initialRunId is set, useWorkflowEvents handles hydration from the
      // live run status — applying a stale snapshot here would overwrite it due
      // to the async race (runHistory reads from disk, runStatus from memory).
      const latest = snapshots[0]
      if (latest && !initialRunId) {
        logger.info("applying latest snapshot nodeResults (no active run)", { workflowId, snapshotRunId: latest.runId })
        setNodeResults(latest.nodeResults)
      } else if (latest && initialRunId) {
        logger.info("skipping snapshot nodeResults — active run will hydrate via events", { workflowId, initialRunId, snapshotRunId: latest.runId })
      }
    })()
    return () => { cancelled = true }
  }, [workflowId, setNodeResults])

  useEffect(() => {
    const handler = (e: BeforeUnloadEvent) => {
      if (!isDirtyRef.current) return
      e.preventDefault()
      e.returnValue = ""
      setShowCloseDialogRef.current(true)
    }
    window.addEventListener("beforeunload", handler)
    return () => window.removeEventListener("beforeunload", handler)
  }, [])

  useEffect(() => {
    if (!workflowId) return
    return window.synapse?.workflow.onEvent((event) => {
      if (event.type === "workflow:started" && event.workflowId === workflowId) {
        // Skip if this run was already attached locally (e.g. initiated from this editor).
        // Re-attaching would wipe nodeResults that useWorkflowEvents already hydrated.
        if (runIdRef.current === event.runId) {
          logger.info("workflow:started event skipped — run already attached", { runId: event.runId })
          return
        }
        logger.info("workflow:started event — attaching external run", { runId: event.runId })
        attachRun(event.runId)
      }
    })
  }, [workflowId, attachRun])

  useWorkflowEvents(runId, {
    onNodeStarted: (nodeId) => setNodeResults((r) => ({ ...r, [nodeId]: { ...(r[nodeId] ?? { nodeId, input: { variables: {} } }), status: "running" as const } })),
    onNodeCompleted: (nodeId, output, result) => setNodeResults((r) => ({ ...r, [nodeId]: result ?? { ...(r[nodeId] ?? { nodeId, input: { variables: {} } }), status: "success" as const, output: String(output) } })),
    onNodeFailed: (nodeId, error, result) => setNodeResults((r) => ({ ...r, [nodeId]: result ?? { ...(r[nodeId] ?? { nodeId, input: { variables: {} } }), status: "failed" as const, error } })),
    onNodeSkipped: (nodeId, result) => setNodeResults((r) => ({ ...r, [nodeId]: result ?? { nodeId, input: { variables: {} }, status: "skipped" as const } })),
    onCompleted: (results) => { setRunState("completed"); setRunError(null); setNodeResults(results) },
    onFailed: (error, results) => {
      setRunState("failed"); setRunError(error)
      if (results) { logger.info("workflow failed — replacing nodeResults with authoritative data", { nodeCount: Object.keys(results).length }); setNodeResults(results) }
    },
    onCancelled: (results) => {
      setRunState("cancelled"); setRunError(null)
      if (results) { logger.info("workflow cancelled — replacing nodeResults with authoritative data", { nodeCount: Object.keys(results).length }); setNodeResults(results) }
    },
  })

  const handleDefinitionChange = useCallback((def: WorkflowDefinition) => {
    isDirtyRef.current = true
    setRunErrors([])
    setDefinition(def)
  }, [])

  const handleConfigChange = useCallback((nodeId: string, config: Record<string, unknown>) => {
    isDirtyRef.current = true
    canvasRef.current?.updateNodeConfig(nodeId, config)
    setRunErrors([])
    setDefinition((def) => {
      if (!def) return def
      const node = def.nodes.find((n) => n.id === nodeId)
      const updatedNodes = def.nodes.map((n) => n.id === nodeId ? { ...n, config } : n)

      // When a Switch node's branches change, remove edges referencing deleted branches
      let updatedEdges = def.edges
      if (node?.type === "switch") {
        const newBranchIds = new Set(
          (Array.isArray(config.branches) ? config.branches as Array<{ id: string }> : []).map((b) => b.id),
        )
        const orphanedEdgeIds = def.edges
          .filter((e) => e.from === nodeId && e.branch && !newBranchIds.has(e.branch))
          .map((e) => e.id)
        if (orphanedEdgeIds.length > 0) {
          updatedEdges = def.edges.filter((e) => !orphanedEdgeIds.includes(e.id))
          canvasRef.current?.removeEdgesByIds(orphanedEdgeIds)
        }
      }

      return { ...def, nodes: updatedNodes, edges: updatedEdges }
    })
  }, [])

  const handleNameChange = useCallback((nodeId: string, name: string) => {
    isDirtyRef.current = true
    setRunErrors([])
    setDefinition((def) => {
      if (!def) return def
      const node = def.nodes.find((n) => n.id === nodeId)
      if (!node) return def
      canvasRef.current?.updateNodeConfig(nodeId, { ...node.config, name })
      return { ...def, nodes: def.nodes.map((n) => n.id === nodeId ? { ...n, name } : n) }
    })
  }, [])

  const handleNodeSelect = useCallback((nodeId: string | null) => {
    if (nodeId && runState !== "idle") {
      const result = nodeResults[nodeId]
      if (result?.status === "success" || result?.status === "failed") {
        setViewingNodeId(nodeId)
        return
      }
    }
    setSelectedNodeId(nodeId)
    setViewingNodeId(null)
  }, [runState, nodeResults])

  const handleRequestRename = useCallback((nodeId: string) => {
    setSelectedNodeId(nodeId)
    setViewingNodeId(null)
    renameSignalRef.current += 1
  }, [])

  const handleCloseDiscard = () => {
    isDirtyRef.current = false
    setShowCloseDialog(false)
    window.close()
  }

  const handleCloseSave = async () => {
    const def = definitionRef.current
    if (def) await handleSave(def)
    isDirtyRef.current = false
    setShowCloseDialog(false)
    window.close()
  }

  const handleSave = async (def: WorkflowDefinition) => {
    let result: Awaited<ReturnType<NonNullable<typeof window.synapse>["workflow"]["save"]>> | undefined
    try {
      result = await window.synapse?.workflow.save(def)
    } catch (err) {
      logger.error("save IPC call threw", { workflowId: def.id, error: err instanceof Error ? err.message : String(err) })
      setRunErrors([{ type: "invalid_config", message: "保存失败：无法连接到主进程" }])
      return { errors: [{ type: "invalid_config" as const, message: "保存失败：无法连接到主进程" }] }
    }
    if (!result) {
      logger.error("save returned undefined — IPC bridge unavailable", { workflowId: def.id })
      setRunErrors([{ type: "invalid_config", message: "保存失败：IPC 通道不可用" }])
      return { errors: [{ type: "invalid_config" as const, message: "保存失败：IPC 通道不可用" }] }
    }
    if ("errors" in result) {
      logger.warn("save blocked by validation", { workflowId: def.id, errorCount: result.errors.length })
      setRunErrors(result.errors)
      return result
    }
    setRunErrors([])
    isDirtyRef.current = false
    if ("versionHash" in result) setDefinition({ ...def, version: result.versionHash })
    return result
  }

  const handleRun = async (params: Record<string, unknown>) => {
    const currentDefinition = definitionRef.current
    if (!currentDefinition) return null
    const saveResult = await handleSave(currentDefinition)
    if (!saveResult || "errors" in saveResult) return null
    setRunError(null)
    const startResult = await start(params)
    if (startResult && "errors" in startResult) {
      setRunErrors(startResult.errors)
      return null
    }
    return startResult ? startResult.runId : null
  }

  if (!definition) return <div className="flex items-center justify-center h-screen text-sm text-muted-foreground">加载中…</div>

  return (
    <>
    <div className="flex flex-col h-screen">
      <WorkflowToolbar definition={definition} runState={runState} onSave={handleSave} onRun={handleRun} onCancel={cancel} onReset={() => { setRunState("idle"); setViewingNodeId(null) }} onChange={handleDefinitionChange} />
      {runErrors.length > 0 && (
        <Alert variant="destructive" className="rounded-none border-x-0 border-t-0">
          <AlertCircle className="h-4 w-4" />
          <AlertTitle className="text-xs font-medium">校验失败</AlertTitle>
          <AlertDescription className="text-xs">
            <ul className="mt-0.5 space-y-0.5 list-none">
              {runErrors.map((e, i) => <li key={i}>{e.message}</li>)}
            </ul>
          </AlertDescription>
          <AlertAction>
            <Button size="icon" variant="ghost" className="h-6 w-6 text-destructive hover:text-destructive hover:bg-destructive/10" onClick={() => setRunErrors([])}>
              <X className="h-3.5 w-3.5" />
            </Button>
          </AlertAction>
        </Alert>
      )}
      <div className="flex-1 flex min-h-0">
        <NodePalette />
        <ResizablePanelGroup orientation="horizontal" className="flex-1 min-h-0">
          <ResizablePanel>
            <div className="h-full relative">
              <WorkflowCanvas ref={canvasRef} definition={definition} nodeResults={nodeResults} onChange={handleDefinitionChange} onNodeSelect={handleNodeSelect} onRequestRename={handleRequestRename} />
              <ExecutionOverlay nodeResults={nodeResults} runState={runState} runError={runError} definition={definition} viewingNodeId={viewingNodeId} onViewClose={() => setViewingNodeId(null)} />
            </div>
          </ResizablePanel>
          <ResizableHandle withHandle />
          <ResizablePanel
            defaultSize={300}
            minSize={300}
            maxSize={600}
            groupResizeBehavior="preserve-pixel-size"
          >
            <NodeConfigPanel nodeId={runState === "idle" ? selectedNodeId : null} definition={definition} onConfigChange={handleConfigChange} onNameChange={handleNameChange} renameSignal={renameSignalRef.current} />
          </ResizablePanel>
        </ResizablePanelGroup>
      </div>
    </div>
    <AlertDialog open={showCloseDialog} onOpenChange={setShowCloseDialog}>
      <AlertDialogContent>
        <AlertDialogHeader>
          <AlertDialogTitle>未保存的更改</AlertDialogTitle>
          <AlertDialogDescription>工作流已修改，是否保存？</AlertDialogDescription>
        </AlertDialogHeader>
        <AlertDialogFooter>
          <AlertDialogCancel>取消</AlertDialogCancel>
          <Button variant="ghost" onClick={handleCloseDiscard}>放弃</Button>
          <Button onClick={handleCloseSave}>保存</Button>
        </AlertDialogFooter>
      </AlertDialogContent>
    </AlertDialog>
    </>
  )
}
