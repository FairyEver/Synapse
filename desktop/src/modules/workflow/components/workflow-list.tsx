import { useState } from "react"
import { toast } from "sonner"
import { WorkflowCard } from "./workflow-card"
import { RunParamsDialog } from "./run-params-dialog"
import { RunHistoryDialog } from "./run-history-dialog"
import { useWorkflowList } from "../hooks/use-workflow-list"
import type { WorkflowDefinition } from "@/types/workflow"

export function WorkflowList() {
  const { items, loading, refresh } = useWorkflowList()
  const [runTarget, setRunTarget] = useState<WorkflowDefinition | null>(null)
  const [historyWorkflowId, setHistoryWorkflowId] = useState<string | null>(null)
  const [runningId, setRunningId] = useState<string | null>(null)

  const handleRun = async (id: string) => {
    if (runningId) return
    setRunningId(id)
    try {
      const def = await window.synapse?.workflow.get(id)
      if (!def) return
      if (def.params.length === 0) {
        const result = await window.synapse?.workflow.runDefinition(def, {})
        if (!result) return
        if ("errors" in result) {
          const errors = result.errors as { message?: string }[]
          toast.error(errors[0]?.message ?? "工作流校验失败")
          return
        }
        if ("conflict" in result) {
          toast.error("该工作流有正在执行的运行")
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
    try {
      const result = await window.synapse?.workflow.runDefinition(def, params)
      if (!result) return
      if ("errors" in result) {
        const errors = result.errors as { message?: string }[]
        toast.error(errors[0]?.message ?? "工作流校验失败")
        return
      }
      if ("conflict" in result) {
        toast.error("该工作流有正在执行的运行")
        return
      }
      void window.synapse?.workflow.openRunner(def.id, result.runId)
      void refresh()
    } catch (err) {
      toast.error(`运行失败：${err instanceof Error ? err.message : String(err)}`)
    }
  }

  if (loading) return <p className="text-sm text-muted-foreground p-4">加载中…</p>
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
    </>
  )
}
