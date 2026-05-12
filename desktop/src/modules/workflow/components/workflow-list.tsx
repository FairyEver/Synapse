import { useState } from "react"
import { toast } from "sonner"
import { AlertCircle, RefreshCw } from "lucide-react"
import { WorkflowCard } from "./workflow-card"
import { RunParamsDialog } from "./run-params-dialog"
import { RunHistoryDialog } from "./run-history-dialog"
import { useWorkflowList } from "../hooks/use-workflow-list"
import { Button } from "@/components/ui/button"
import { Alert, AlertDescription } from "@/components/ui/alert"
import { AlertDialog, AlertDialogCancel, AlertDialogContent, AlertDialogDescription, AlertDialogFooter, AlertDialogHeader, AlertDialogTitle } from "@/components/ui/alert-dialog"
import type { WorkflowDefinition } from "@/types/workflow"

export function WorkflowList() {
  const { items, loading, error, refresh } = useWorkflowList()
  const [runTarget, setRunTarget] = useState<WorkflowDefinition | null>(null)
  const [historyWorkflowId, setHistoryWorkflowId] = useState<string | null>(null)
  const [runningId, setRunningId] = useState<string | null>(null)
  // Track a conflict so we can offer "cancel old & start new" instead of just an error toast.
  const [conflictState, setConflictState] = useState<{ def: WorkflowDefinition; params: Record<string, unknown> } | null>(null)

  const handleRun = async (id: string) => {
    if (runningId) return
    setRunningId(id)
    try {
      const def = await window.synapse?.workflow.get(id)
      if (!def) {
        toast.error("工作流不存在，请刷新列表")
        return
      }
      if (def.params.length === 0) {
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
      toast.error(`运行失败：${err instanceof Error ? err.message : String(err)}`)
    } finally {
      setRunningId(null)
    }
  }

  const handleDelete = async (id: string) => {
    await window.synapse?.workflow.delete(id)
    void refresh()
  }

  const handleConfirmRun = async (params: Record<string, unknown>) => {
    if (!runTarget) return
    const def = runTarget
    setRunTarget(null)
    setRunningId(def.id)
    try {
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
      toast.error(`运行失败：${err instanceof Error ? err.message : String(err)}`)
    } finally {
      setRunningId(null)
    }
  }

  const handleForceRun = async () => {
    if (!conflictState) return
    const { def, params } = conflictState
    setConflictState(null)
    try {
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
    } catch {
      toast.error("运行失败：操作异常")
    }
  }

  if (loading) return <p className="text-sm text-muted-foreground p-4">加载中…</p>
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
  if (items.length === 0) return <p className="text-sm text-muted-foreground p-4">还没有工作流。</p>

  return (
    <>
      <div className="grid grid-cols-2 sm:grid-cols-3 gap-3 p-4">
        {items.map((meta) => (
          <WorkflowCard key={meta.id} meta={meta}
            running={runningId === meta.id}
            onOpen={() => void window.synapse?.workflow.openEditor(meta.id)}
            onRun={() => void handleRun(meta.id)}
            onHistory={() => setHistoryWorkflowId(meta.id)}
            onDelete={() => void handleDelete(meta.id)} />
        ))}
      </div>
      <RunParamsDialog open={!!runTarget} params={runTarget?.params ?? []} onConfirm={(params) => { void handleConfirmRun(params) }} onCancel={() => setRunTarget(null)} />
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
