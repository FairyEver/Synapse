import { useCallback, useEffect, useMemo, useRef, useState } from "react"
import { toast } from "sonner"
import { AlertCircle, Loader2, RefreshCw } from "lucide-react"
import { AlertDialog, AlertDialogCancel, AlertDialogContent, AlertDialogDescription, AlertDialogFooter, AlertDialogHeader, AlertDialogTitle } from "@/components/ui/alert-dialog"
import type { WorkflowDefinition, ValidationError } from "@/types/workflow"
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert"
import { useAppConfig } from "@/app-shell/config"
import { createRendererLogger } from "@/app-shell/logging"
import { holdBeforeUnloadForCustomDialog } from "@/lib/before-unload"
// Side-effect: populate node type registry in the editor window's renderer process.
// Without this, NodePalette.listTypes() returns [] and users cannot add nodes.
// Use the renderer-only entry so we don't pull main-process executors into the
// Vite bundle (they import `electron`, `node:path`, etc.).
import "../../../../workflow-nodes/register.renderer"
import { Button } from "@/components/ui/button"
import { CanvasFloatingToolbar } from "./canvas-floating-toolbar"
import { WorkflowCanvas, type WorkflowCanvasHandle } from "./canvas"
import { NodePalette } from "./node-palette"
import { NodeConfigPanel } from "./node-config-panel"
import { ResizableHandle, ResizablePanel, ResizablePanelGroup } from "@/components/ui/resizable"
import { ProviderLookupProvider } from "../../../../workflow-nodes/provider-lookup-context"
import { errorDiagnostic } from "../lib/error-utils"
import { ErrorBoundary } from "@/components/error-boundary"
import { buildWorkflowValidationDisplayItems, type WorkflowValidationDisplayItem } from "./validation-display"
import { WorkflowErrorCard } from "./workflow-error-card"
import { syncSwitchBranchReferences } from "./switch-branch-sync"
import { useWorkflowEditorMutationState } from "../hooks/use-workflow-editor-mutation-state"
import { ScriptConfirmationDialog } from "./script-confirmation-dialog"
import { useScriptConfirmationRun } from "../hooks/use-script-confirmation-run"

const logger = createRendererLogger("workflow.editor")

export function WorkflowEditorApp() {
  const searchParams = new URLSearchParams(window.location.search)
  const workflowId = searchParams.get("workflowId") ?? ""
  const [definition, setDefinition] = useState<WorkflowDefinition | null>(null)
  const [selectedNodeId, setSelectedNodeId] = useState<string | null>(null)
  const [runErrors, setRunErrors] = useState<ValidationError[]>([])
  const [saving, setSaving] = useState(false)
  const [running, setRunning] = useState(false)
  const [dirty, setDirty] = useState(false)
  const [showCloseDialog, setShowCloseDialog] = useState(false)
  const [conflictState, setConflictState] = useState<{ saved: WorkflowDefinition; params: Record<string, unknown> } | null>(null)
  const [loadError, setLoadError] = useState<string | null>(null)
  const setShowCloseDialogRef = useRef(setShowCloseDialog)
  setShowCloseDialogRef.current = setShowCloseDialog
  const canvasRef = useRef<WorkflowCanvasHandle>(null)
  const [leftCollapsed, setLeftCollapsed] = useState(false)
  const [rightCollapsed, setRightCollapsed] = useState(false)
  const [renameSignal, setRenameSignal] = useState(0)
  const { config: appConfig } = useAppConfig()
  const projects = appConfig.global.projects
  const defaultProjectName = definition?.defaultProjectId
    ? projects.find((p) => p.id === definition.defaultProjectId)?.name
    : undefined
  const definitionRef = useRef(definition)
  definitionRef.current = definition
  const isDirtyRef = useRef(false)
  const savingRef = useRef(false)
  const { runWithScriptConfirmation, scriptConfirmation } = useScriptConfirmationRun()

  useWorkflowEditorMutationState(workflowId, dirty, saving)
  const validationItems = useMemo(
    () => definition ? buildWorkflowValidationDisplayItems(definition, runErrors) : [],
    [definition, runErrors],
  )
  const selectedNodeValidationItems = useMemo(
    () => selectedNodeId ? validationItems.filter((item) => item.nodeId === selectedNodeId) : [],
    [selectedNodeId, validationItems],
  )

  const loadDefinition = useCallback(() => {
    if (!workflowId) return
    const workflowApi = window.synapse?.workflow
    if (!workflowApi) {
      setLoadError("无法连接到主进程，请稍后重试")
      logger.warn("editor definition load failed: IPC bridge unavailable", { workflowId })
      return
    }
    let cancelled = false
    setLoadError(null)
    void (async () => {
      try {
        const def = await workflowApi.definition.get(workflowId)
        if (cancelled) return
        // Re-check dirty state: the user may have started editing while
        // the IPC call was in flight. Overwriting would lose their work.
        if (def) {
          if (isDirtyRef.current) {
            logger.info("definition loaded but editor has unsaved changes, skipping overwrite", { workflowId })
            return
          }
          setDefinition(def)
          setLoadError(null)
        } else {
          setDefinition(null)
          setLoadError("工作流不存在或已被删除")
          logger.warn("editor definition load failed: workflow not found", { workflowId })
        }
      } catch (err) {
        if (cancelled) return
        setLoadError("无法加载工作流，请重试")
        logger.error("editor definition load threw", {
          workflowId,
          boundary: "renderer.workflow.editor.load",
          ...errorDiagnostic(err),
        })
      }
    })()
    return () => { cancelled = true }
  }, [workflowId])

  useEffect(() => {
    return loadDefinition()
  }, [loadDefinition])

  useEffect(() => {
    const unsub = window.synapse?.workflow.operation.onEditorRefocus(() => {
      if (isDirtyRef.current) {
        logger.info("editor-refocus received but has unsaved changes, skipping reload", { workflowId })
        return
      }
      logger.info("editor-refocus received, reloading definition", { workflowId })
      loadDefinition()
    })
    return unsub
  }, [workflowId, loadDefinition])

  useEffect(() => {
    const unsub = window.synapse?.workflow.editor.onDefinitionUpdated((payload) => {
      if (payload.workflowId !== workflowId) return
      if (payload.source !== "mcp" && payload.source !== "workflow-delete" && payload.source !== "share-import") return
      const workflowDeleted = payload.source === "workflow-delete"
      if (!workflowDeleted && isDirtyRef.current) {
        logger.warn("external definition update received but editor has unsaved changes, skipping reload", { workflowId })
        toast.warning("工作流已被外部更新，当前有未保存的更改", { duration: 3000 })
        return
      }
      loadDefinition()
      toast.info(workflowDeleted ? "工作流已被删除" : "工作流已被外部更新", { duration: 2000 })
    })
    return unsub
  }, [workflowId, loadDefinition])

  useEffect(() => {
    const handler = (e: BeforeUnloadEvent) => {
      if (!isDirtyRef.current) return
      holdBeforeUnloadForCustomDialog(e)
      setShowCloseDialogRef.current(true)
    }
    window.addEventListener("beforeunload", handler)
    return () => window.removeEventListener("beforeunload", handler)
  }, [])

  const handleDefinitionChange = useCallback((def: WorkflowDefinition) => {
    isDirtyRef.current = true
    setDirty(true)
    setRunErrors([])
    setDefinition(def)
    definitionRef.current = def
  }, [])

  const handleConfigChange = useCallback((nodeId: string, config: Record<string, unknown>) => {
    isDirtyRef.current = true
    setDirty(true)
    canvasRef.current?.updateNodeConfig(nodeId, config)
    setRunErrors([])
    setDefinition((def) => {
      if (!def) return def
      const node = def.nodes.find((n) => n.id === nodeId)
      let nextConfig = config
      let updatedEdges = def.edges

      // When a Switch node's branches change, remove edges referencing deleted branches
      // and sync edge labels for remaining branches
      if (node?.type === "switch") {
        const syncResult = syncSwitchBranchReferences({
          nodeId,
          previousConfig: node.config,
          nextConfig: config,
          edges: def.edges,
        })
        nextConfig = syncResult.config
        updatedEdges = syncResult.edges
        const branches = Array.isArray(nextConfig.branches) ? nextConfig.branches as Array<{ id: string; label: string }> : []
        const newBranchIds = new Set(branches.map((b) => b.id))
        if (syncResult.orphanedEdgeIds.length > 0) {
          canvasRef.current?.removeEdgesByIds(syncResult.orphanedEdgeIds)
        }
        canvasRef.current?.syncSwitchBranchEdges(nodeId, updatedEdges, branches)
        logger.debug("synced switch edge labels", { nodeId, branchCount: newBranchIds.size })
      }

      const updatedNodes = def.nodes.map((n) => n.id === nodeId ? { ...n, config: nextConfig } : n)
      const updated = { ...def, nodes: updatedNodes, edges: updatedEdges }
      definitionRef.current = updated
      return updated
    })
  }, [])

  const handleNameChange = useCallback((nodeId: string, name: string) => {
    isDirtyRef.current = true
    setDirty(true)
    setRunErrors([])
    canvasRef.current?.updateNodeName(nodeId, name)
    setDefinition((def) => {
      if (!def) return def
      const updated = { ...def, nodes: def.nodes.map((n) => n.id === nodeId ? { ...n, name } : n) }
      definitionRef.current = updated
      return updated
    })
  }, [])

  const handleNodeSelect = useCallback((nodeId: string | null) => {
    setSelectedNodeId(nodeId)
  }, [])

  const handleValidationItemSelect = useCallback((item: WorkflowValidationDisplayItem) => {
    if (!item.nodeId) return
    setSelectedNodeId(item.nodeId)
    canvasRef.current?.selectNode(item.nodeId)
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
    try {
      if (def) {
        const result = await handleSave(def)
        // If save failed (validation errors or IPC failure), abort the close —
        // keep the window open so the user can fix the issues and retry.
        if (!result || "errors" in result) {
          setShowCloseDialog(false)
          toast.error("保存失败，请重试")
          return
        }
      }
    } catch (err) {
      logger.error("close-save failed", {
        workflowId,
        boundary: "renderer.workflow.editor.close-save",
        ...errorDiagnostic(err),
      })
      setShowCloseDialog(false)
      toast.error("保存失败，请重试")
      return
    }
    isDirtyRef.current = false
    setShowCloseDialog(false)
    window.close()
  }

  const handleSave = useCallback(async (def: WorkflowDefinition, silent?: boolean) => {
    // Short-circuit when nothing changed — avoid a pointless IPC round-trip
    // and give clear feedback that no save is needed (no spinner, no toast).
    if (!isDirtyRef.current) return { versionHash: def.version }
    savingRef.current = true
    setSaving(true)
    try {
      let result: Awaited<ReturnType<NonNullable<typeof window.synapse>["workflow"]["definition"]["update"]>> | undefined
      try {
        result = await window.synapse?.workflow.definition.update(def)
      } catch (err) {
        logger.error("save IPC call threw", {
          workflowId: def.id,
          boundary: "renderer.workflow.editor.save",
          ...errorDiagnostic(err),
        })
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
      setDirty(false)
      if (!silent) toast.success("已保存")
      if ("versionHash" in result) {
        const updated = { ...def, version: result.versionHash }
        // Sync ref immediately so that async code reading definitionRef.current
        // (e.g. handleRun after awaiting handleSave) sees the latest version.
        definitionRef.current = updated
        setDefinition(updated)
      }
      return result
    } finally {
      savingRef.current = false
      setSaving(false)
    }
  }, [])

  useEffect(() => {
    const handler = (e: KeyboardEvent) => {
      if ((e.metaKey || e.ctrlKey) && e.key === "s") {
        e.preventDefault()
        if (savingRef.current) return
        // Flush any pending editor state (PromptEditor commits on blur, but
        // the user might press Cmd+S while still focused in the textarea).
        if (document.activeElement instanceof HTMLElement) {
          document.activeElement.blur()
        }
        if (!isDirtyRef.current) return
        const def = definitionRef.current
        if (def) void handleSave(def)
      }
    }
    window.addEventListener("keydown", handler)
    return () => window.removeEventListener("keydown", handler)
  }, [handleSave])

  const handleRun = async (params: Record<string, unknown>) => {
    const def = definitionRef.current
    if (!def) return null
    setRunning(true)
    try {
      const saveResult = await handleSave(def, true)
      if (!saveResult || "errors" in saveResult) {
        const errors = saveResult && "errors" in saveResult ? saveResult.errors : []
        toast.error(errors[0]?.message ?? "保存失败，运行已取消")
        return null
      }
      const saved = definitionRef.current
      if (!saved) return null
      const runDefinition = window.synapse?.workflow.operation.runDefinition
      const result = runDefinition
        ? await runWithScriptConfirmation((confirmationToken) =>
            runDefinition(saved, params, false, confirmationToken))
        : undefined
      if (!result) {
        if (!runDefinition) {
          setRunErrors([{ type: "invalid_config", message: "运行失败：IPC 通道不可用" }])
        }
        return null
      }
      if ("errors" in result) {
        setRunErrors(result.errors)
        return null
      }
      const authoritativeDefinition = "definition" in result && result.definition
        ? result.definition
        : saved
      if ("definition" in result && result.definition) {
        definitionRef.current = result.definition
        setDefinition(result.definition)
      }
      if ("conflict" in result) {
        setConflictState({ saved: authoritativeDefinition, params })
        return null
      }
      window.synapse?.workflow.operation.openRunner(authoritativeDefinition.id, result.runId).catch((err) => {
        logger.warn("Workflow runner open failed after run.", {
          boundary: "renderer.workflow.editor.run",
          workflowId: authoritativeDefinition.id,
          runId: result.runId,
          ...errorDiagnostic(err),
        })
        toast.error("打开运行窗口失败，请重试")
      })
      return result.runId
    } catch (err) {
      logger.error("handleRun failed", {
        workflowId: def.id,
        boundary: "renderer.workflow.editor.run",
        ...errorDiagnostic(err),
      })
      setRunErrors([{ type: "invalid_config", message: "运行失败：无法连接到主进程" }])
      return null
    } finally {
      setRunning(false)
    }
  }

  const handleForceRun = async () => {
    if (!conflictState) return
    const { saved, params } = conflictState
    setConflictState(null)
    setRunning(true)
    try {
      const runDefinition = window.synapse?.workflow.operation.runDefinition
      const forceResult = runDefinition
        ? await runWithScriptConfirmation((confirmationToken) =>
            runDefinition(saved, params, true, confirmationToken))
        : undefined
      if (!forceResult) {
        if (!runDefinition) toast.error("运行失败：无法连接到主进程")
        return
      }
      if ("errors" in forceResult) {
        const errors = forceResult.errors as Array<{ message?: string }>
        toast.error(errors[0]?.message ?? "运行失败：校验未通过")
        return
      }
      if ("conflict" in forceResult) {
        toast.error("仍有运行中的实例，请先取消")
        return
      }
      const authoritativeDefinition = "definition" in forceResult && forceResult.definition
        ? forceResult.definition
        : saved
      if ("definition" in forceResult && forceResult.definition) {
        definitionRef.current = forceResult.definition
        setDefinition(forceResult.definition)
      }
      window.synapse?.workflow.operation.openRunner(authoritativeDefinition.id, forceResult.runId).catch((err) => {
        logger.warn("Workflow runner open failed after force run.", {
          boundary: "renderer.workflow.editor.force-run",
          workflowId: authoritativeDefinition.id,
          runId: forceResult.runId,
          ...errorDiagnostic(err),
        })
        toast.error("打开运行窗口失败，请重试")
      })
    } catch (err) {
      logger.error("force run failed", {
        workflowId: saved.id,
        boundary: "renderer.workflow.editor.force-run",
        ...errorDiagnostic(err),
      })
      toast.error("运行失败：无法连接到主进程")
    } finally {
      setRunning(false)
    }
  }

  if (!definition) {
    if (loadError) {
      return (
        <div className="flex items-center justify-center h-screen">
          <div className="text-center space-y-3 max-w-sm">
            <Alert variant="destructive">
              <AlertCircle className="h-4 w-4" />
              <AlertTitle className="text-xs font-medium">加载失败</AlertTitle>
              <AlertDescription className="text-xs">{loadError}</AlertDescription>
            </Alert>
            <Button size="sm" variant="outline" onClick={() => { void loadDefinition() }}>
              <RefreshCw className="h-3.5 w-3.5 mr-1" />重试
            </Button>
          </div>
        </div>
      )
    }
    return <div className="flex items-center justify-center h-screen text-sm text-muted-foreground gap-2"><Loader2 className="h-4 w-4 animate-spin" />加载中…</div>
  }

  return (
    <ProviderLookupProvider>
    <ErrorBoundary fallbackTitle="工作流编辑器出现问题">
    <div className="flex flex-col h-screen">
      <ResizablePanelGroup orientation="horizontal" className="flex-1 min-h-0">
        <ResizablePanel
          id="node-palette"
          defaultSize={176}
          minSize={176}
          maxSize={220}
          collapsedSize={16}
          collapsible
          groupResizeBehavior="preserve-pixel-size"
          onResize={(size) => {
            setLeftCollapsed(size.inPixels <= 16)
          }}
        >
          <NodePalette collapsed={leftCollapsed} />
        </ResizablePanel>
        <ResizableHandle withHandle />
        <ResizablePanel>
          <div className="relative h-full">
            <WorkflowCanvas ref={canvasRef} definition={definition} onChange={handleDefinitionChange} onNodeSelect={handleNodeSelect} onRequestRename={handleRequestRename} />
            <CanvasFloatingToolbar definition={definition} saving={saving} running={running} dirty={dirty} onSave={handleSave} onRun={handleRun} />
            <WorkflowErrorCard items={validationItems} onSelectItem={handleValidationItemSelect} />
          </div>
        </ResizablePanel>
        <ResizableHandle withHandle />
        <ResizablePanel
          id="node-config"
          defaultSize={400}
          minSize={300}
          maxSize={600}
          collapsedSize={16}
          collapsible
          groupResizeBehavior="preserve-pixel-size"
          onResize={(size) => {
            setRightCollapsed(size.inPixels <= 16)
          }}
        >
          <NodeConfigPanel
            collapsed={rightCollapsed}
            nodeId={selectedNodeId}
            definition={definition}
            onConfigChange={handleConfigChange}
            onNameChange={handleNameChange}
            onDeleteNode={(id) => { canvasRef.current?.deleteNodes([id]); setSelectedNodeId(null) }}
            onCopyNode={(id) => canvasRef.current?.copyNodes([id])}
            renameSignal={renameSignal}
            projects={projects}
            defaultProjectName={defaultProjectName}
            onDefinitionChange={handleDefinitionChange}
            validationItems={selectedNodeValidationItems}
          />
        </ResizablePanel>
      </ResizablePanelGroup>
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
    <AlertDialog open={!!conflictState} onOpenChange={(o) => { if (!o) setConflictState(null) }}>
      <AlertDialogContent>
        <AlertDialogHeader>
          <AlertDialogTitle>运行冲突</AlertDialogTitle>
          <AlertDialogDescription>有正在执行的运行，是否取消并启动新运行？</AlertDialogDescription>
        </AlertDialogHeader>
        <AlertDialogFooter>
          <AlertDialogCancel>取消</AlertDialogCancel>
          <Button onClick={handleForceRun}>取消旧运行并启动</Button>
        </AlertDialogFooter>
      </AlertDialogContent>
    </AlertDialog>
    <ScriptConfirmationDialog
      open={scriptConfirmation.open}
      scripts={scriptConfirmation.scripts}
      confirming={scriptConfirmation.confirming}
      onCancel={scriptConfirmation.cancel}
      onConfirm={() => { void scriptConfirmation.confirm() }}
    />
    </ErrorBoundary>
    </ProviderLookupProvider>
  )
}
