import { useState, useEffect, useRef } from "react"
import { toast } from "sonner"
import { AlertCircle, FileJson, Loader2, Plus, RefreshCw } from "lucide-react"
import { WorkflowCard, type WorkflowCardRunState } from "./workflow-card"
import { RunParamsDialog } from "./run-params-dialog"
import { RunHistoryDialog } from "./run-history-dialog"
import { useWorkflowList } from "../hooks/use-workflow-list"
import { createRendererLogger } from "@/app-shell/logging"
import { Button } from "@/components/ui/button"
import { Alert, AlertDescription } from "@/components/ui/alert"
import { AlertDialog, AlertDialogCancel, AlertDialogContent, AlertDialogDescription, AlertDialogFooter, AlertDialogHeader, AlertDialogTitle } from "@/components/ui/alert-dialog"
import { track } from "@/lib/ui-tracking"
import type { WorkflowDefinition } from "@/types/workflow"
import { errorDiagnostic } from "../lib/error-utils"

const logger = createRendererLogger("workflow.list")

export function WorkflowList({ onCreate }: { onCreate: () => void }) {
  const { items, loading, error, refresh } = useWorkflowList()
  const [runTarget, setRunTarget] = useState<WorkflowDefinition | null>(null)
  const [historyWorkflowId, setHistoryWorkflowId] = useState<string | null>(null)
  const [runningId, setRunningId] = useState<string | null>(null)
  // Track a conflict so we can offer "cancel old & start new" instead of just an error toast.
  const [conflictState, setConflictState] = useState<{ def: WorkflowDefinition; params: Record<string, unknown> } | null>(null)
  // Remember last-used param values so the dialog can pre-fill them on re-run
  const [lastRunValues, setLastRunValues] = useState<Record<string, string>>({})

  // Track the latest run status per workflow so WorkflowCard can show a live badge.
  const [runStates, setRunStates] = useState<Record<string, WorkflowCardRunState>>({})
  const runIdToWfId = useRef<Record<string, string>>({})

  useEffect(() => {
    const unsub = window.synapse?.workflow.onEvent((event) => {
      if (event.type === "workflow:started") {
        runIdToWfId.current[event.runId] = event.workflowId
        setRunStates((s) => ({ ...s, [event.workflowId]: "running" }))
      } else if (event.type === "workflow:completed") {
        const wfId = runIdToWfId.current[event.runId]
        if (wfId) setRunStates((s) => ({ ...s, [wfId]: "completed" }))
      } else if (event.type === "workflow:failed") {
        const wfId = runIdToWfId.current[event.runId]
        if (wfId) setRunStates((s) => ({ ...s, [wfId]: "failed" }))
      } else if (event.type === "workflow:cancelled") {
        const wfId = runIdToWfId.current[event.runId]
        if (wfId) setRunStates((s) => ({ ...s, [wfId]: "cancelled" }))
      }
    })
    return () => { unsub?.() }
  }, [])

  const handleRun = async (id: string) => {
    if (runningId) return
    setRunningId(id)
    try {
      const def = await window.synapse?.workflow.get(id)
      if (!def) {
        toast.error("工作流不存在，请刷新列表")
        void refresh()
        return
      }
      if (def.params.length === 0) {
        trackWorkflowRunSubmit(def, {}, false)
        const result = await window.synapse?.workflow.runDefinition(def, {})
        if (!result) {
          toast.error("运行失败：无法连接到主进程")
          return
        }
        if ("errors" in result) {
          const errors = result.errors as { message?: string }[]
          toast.error(errors[0]?.message ?? "工作流校验失败")
          return
        }
        if ("conflict" in result) {
          setConflictState({ def, params: {} })
          return
        }
        void window.synapse?.workflow.openRunner(def.id, result.runId)
      } else {
        setRunTarget(def)
      }
    } catch (err) {
      showRunFailure({ id }, {}, false, err)
    } finally {
      setRunningId(null)
    }
  }

  const handleDelete = async (id: string) => {
    try {
      await window.synapse?.workflow.delete(id)
    } catch (err) {
      logger.warn("Workflow delete failed.", {
        boundary: "renderer.workflow.list.delete",
        workflowId: id,
        ...errorDiagnostic(err),
      })
      toast.error("删除失败，请重试")
      return
    }
    toast.success("工作流已删除")
    void refresh()
  }

  const handleConfirmRun = async (params: Record<string, unknown>) => {
    if (!runTarget) return
    const def = runTarget
    setRunTarget(null)
    setRunningId(def.id)
    try {
      trackWorkflowRunSubmit(def, params, false)
      const result = await window.synapse?.workflow.runDefinition(def, params)
      if (!result) {
        toast.error("运行失败：无法连接到主进程")
        return
      }
      if ("errors" in result) {
        const errors = result.errors as { message?: string }[]
        toast.error(errors[0]?.message ?? "工作流校验失败")
        return
      }
      if ("conflict" in result) {
        setConflictState({ def, params })
        return
      }
      void window.synapse?.workflow.openRunner(def.id, result.runId)
      void refresh()
    } catch (err) {
      showRunFailure(def, params, false, err)
    } finally {
      setRunningId(null)
    }
  }

  const handleForceRun = async () => {
    if (!conflictState) return
    const { def, params } = conflictState
    setConflictState(null)
    try {
      trackWorkflowRunSubmit(def, params, true)
      const forceResult = await window.synapse?.workflow.runDefinition(def, params, true)
      if (!forceResult) {
        toast.error("运行失败：无法连接到主进程")
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
      void window.synapse?.workflow.openRunner(def.id, forceResult.runId)
      void refresh()
    } catch (err) {
      showRunFailure(def, params, true, err)
    }
  }

  if (loading) return (
    <div className="flex h-full flex-col">
      <div className="flex flex-1 items-center justify-center">
        <div className="flex flex-col items-center gap-3 text-center">
          <Loader2 className="size-10 animate-spin text-muted-foreground/50" />
          <p className="text-sm text-muted-foreground">加载中…</p>
        </div>
      </div>
    </div>
  )
  if (error) return (
    <div className="p-4 space-y-3">
      <Alert variant="destructive">
        <AlertCircle className="h-4 w-4" />
        <AlertDescription className="text-xs">{error}</AlertDescription>
      </Alert>
      <Button size="sm" variant="outline" onClick={refresh}>
        <RefreshCw className="h-3.5 w-3.5 mr-1" />重试
      </Button>
    </div>
  )
  if (items.length === 0) return (
    <div className="flex h-full flex-col">
      <div className="flex flex-1 items-center justify-center">
        <div className="flex flex-col items-center gap-3 text-center">
          <FileJson className="size-10 text-muted-foreground/50" />
          <p className="text-sm text-muted-foreground">还没有工作流</p>
          <p className="text-xs text-muted-foreground">创建工作流来自动化你的任务</p>
          <Button size="sm" variant="outline" onClick={onCreate}>
            <Plus className="h-3.5 w-3.5 mr-1" />创建第一个工作流
          </Button>
        </div>
      </div>
    </div>
  )

  return (
    <>
      <div className="grid grid-cols-2 sm:grid-cols-3 gap-3 p-4">
        {items.map((meta) => (
          <WorkflowCard key={meta.id} meta={meta}
            runState={runStates[meta.id]}
            running={runningId !== null}
            onOpen={() => void window.synapse?.workflow.openEditor(meta.id)}
            onRun={() => void handleRun(meta.id)}
            onHistory={() => setHistoryWorkflowId(meta.id)}
            onDelete={() => void handleDelete(meta.id)} />
        ))}
      </div>
      <RunParamsDialog open={!!runTarget} params={runTarget?.params ?? []} lastValues={lastRunValues} onConfirm={(params, rawValues) => { setLastRunValues(rawValues); void handleConfirmRun(params) }} onCancel={() => setRunTarget(null)} />
      <RunHistoryDialog open={!!historyWorkflowId} workflowId={historyWorkflowId ?? ""} onClose={() => setHistoryWorkflowId(null)} />
      <AlertDialog open={!!conflictState} onOpenChange={(o) => { if (!o) setConflictState(null) }}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>运行冲突</AlertDialogTitle>
            <AlertDialogDescription>该工作流有正在执行的运行，是否取消并启动新运行？</AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>取消</AlertDialogCancel>
            <Button onClick={() => void handleForceRun()}>取消旧运行并启动</Button>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </>
  )
}

function trackWorkflowRunSubmit(
  def: WorkflowDefinition,
  params: Record<string, unknown>,
  force: boolean,
): void {
  const paramCount = Object.keys(params).length
  track({
    component: "workflow",
    name: "workflow-list-run-submit",
    action: "submit",
    metadata: {
      boundary: "renderer.workflow.list.run-submit",
      workflowId: def.id,
      source: "workflow-list",
      force,
      paramCount,
      hasParams: paramCount > 0,
    },
  })
}

function showRunFailure(
  def: Pick<WorkflowDefinition, "id">,
  params: Record<string, unknown>,
  force: boolean,
  error: unknown,
): void {
  logger.warn("Workflow list run failed.", {
    boundary: "renderer.workflow.list.run",
    workflowId: def.id,
    force,
    paramCount: Object.keys(params).length,
    ...errorDiagnostic(error),
  })
  toast.error("运行失败，请重试")
}
