import { useCallback, useEffect, useRef, useState } from "react"
import { AlertCircle, X } from "lucide-react"
import { AlertDialog, AlertDialogCancel, AlertDialogContent, AlertDialogDescription, AlertDialogFooter, AlertDialogHeader, AlertDialogTitle } from "@/components/ui/alert-dialog"
import type { WorkflowDefinition, ValidationError } from "@/types/workflow"
import { Alert, AlertDescription, AlertTitle, AlertAction } from "@/components/ui/alert"
import { createRendererLogger } from "@/app-shell/logging"
// Side-effect: populate node type registry in the editor window's renderer process.
// Without this, NodePalette.listTypes() returns [] and users cannot add nodes.
// Use the renderer-only entry so we don't pull main-process executors into the
// Vite bundle (they import `electron`, `node:path`, etc.).
import "../../../../workflow-nodes/register.renderer"
import { Button } from "@/components/ui/button"
import { WorkflowToolbar } from "./toolbar"
import { WorkflowCanvas, type WorkflowCanvasHandle } from "./canvas"
import { NodePalette } from "./node-palette"
import { NodeConfigPanel } from "./node-config-panel"
import { ResizableHandle, ResizablePanel, ResizablePanelGroup } from "@/components/ui/resizable"

const logger = createRendererLogger("workflow.editor")

export function WorkflowEditorApp() {
  const searchParams = new URLSearchParams(window.location.search)
  const workflowId = searchParams.get("workflowId") ?? ""
  const [definition, setDefinition] = useState<WorkflowDefinition | null>(null)
  const [selectedNodeId, setSelectedNodeId] = useState<string | null>(null)
  const [runErrors, setRunErrors] = useState<ValidationError[]>([])
  const [showCloseDialog, setShowCloseDialog] = useState(false)
  const setShowCloseDialogRef = useRef(setShowCloseDialog)
  setShowCloseDialogRef.current = setShowCloseDialog
  const canvasRef = useRef<WorkflowCanvasHandle>(null)
  const [renameSignal, setRenameSignal] = useState(0)
  const definitionRef = useRef(definition)
  definitionRef.current = definition
  const isDirtyRef = useRef(false)

  useEffect(() => {
    if (!workflowId) return
    const workflowApi = window.synapse?.workflow
    if (!workflowApi) return
    let cancelled = false
    void (async () => {
      const def = await workflowApi.get(workflowId)
      if (cancelled) return
      if (def) setDefinition(def)
    })()
    return () => { cancelled = true }
  }, [workflowId])

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
    setSelectedNodeId(nodeId)
  }, [])

  const handleRequestRename = useCallback((nodeId: string) => {
    setSelectedNodeId(nodeId)
    setRenameSignal((s) => s + 1)
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
    const def = definitionRef.current
    if (!def) return null
    try {
      const saveResult = await handleSave(def)
      if (!saveResult || "errors" in saveResult) return null
      const saved = definitionRef.current
      if (!saved) return null
      const result = await window.synapse?.workflow.runDefinition(saved, params)
      if (!result) {
        setRunErrors([{ type: "invalid_config", message: "运行失败：IPC 通道不可用" }])
        return null
      }
      if ("errors" in result) {
        setRunErrors(result.errors)
        return null
      }
      if ("conflict" in result) {
        const confirmed = window.confirm("有正在执行的运行，是否取消并启动新运行？")
        if (!confirmed) return null
        const forceResult = await window.synapse?.workflow.runDefinition(saved, params, true)
        if (!forceResult || "errors" in forceResult || "conflict" in forceResult) return null
        void window.synapse?.workflow.openRunner(saved.id, forceResult.runId)
        return forceResult.runId
      }
      void window.synapse?.workflow.openRunner(saved.id, result.runId)
      return result.runId
    } catch (err) {
      logger.error("handleRun failed", { error: err instanceof Error ? err.message : String(err) })
      setRunErrors([{ type: "invalid_config", message: `运行失败：${err instanceof Error ? err.message : String(err)}` }])
      return null
    }
  }

  if (!definition) return <div className="flex items-center justify-center h-screen text-sm text-muted-foreground">加载中…</div>

  return (
    <>
    <div className="flex flex-col h-screen">
      <WorkflowToolbar definition={definition} onSave={handleSave} onRun={handleRun} onChange={handleDefinitionChange} />
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
            <WorkflowCanvas ref={canvasRef} definition={definition} onChange={handleDefinitionChange} onNodeSelect={handleNodeSelect} onRequestRename={handleRequestRename} />
          </ResizablePanel>
          <ResizableHandle withHandle />
          <ResizablePanel
            defaultSize={300}
            minSize={300}
            maxSize={600}
            groupResizeBehavior="preserve-pixel-size"
          >
            <NodeConfigPanel nodeId={selectedNodeId} definition={definition} onConfigChange={handleConfigChange} onNameChange={handleNameChange} renameSignal={renameSignal} />
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
