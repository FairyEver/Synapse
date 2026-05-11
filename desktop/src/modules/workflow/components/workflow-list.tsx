import { useState } from "react"
import { WorkflowCard } from "./workflow-card"
import { RunParamsDialog } from "./run-params-dialog"
import { useWorkflowList } from "../hooks/use-workflow-list"
import type { WorkflowDefinition } from "@/types/workflow"

export function WorkflowList() {
  const { items, loading, refresh } = useWorkflowList()
  const [runTarget, setRunTarget] = useState<WorkflowDefinition | null>(null)

  const handleRun = async (id: string) => {
    const def = await window.synapse?.workflow.get(id)
    if (!def) return
    if (def.params.length === 0) {
      const result = await window.synapse?.workflow.run(def.id, {})
      void window.synapse?.workflow.openEditor(def.id, result?.runId)
    } else {
      setRunTarget(def)
    }
  }

  const handleDelete = async (id: string) => {
    await window.synapse?.workflow.delete(id)
    void refresh()
  }

  const handleConfirmRun = async (params: Record<string, unknown>) => {
    if (!runTarget) return
    const id = runTarget.id
    setRunTarget(null)
    const result = await window.synapse?.workflow.run(id, params)
    void window.synapse?.workflow.openEditor(id, result?.runId)
    void refresh()
  }

  if (loading) return <p className="text-sm text-muted-foreground p-4">加载中…</p>
  if (items.length === 0) return <p className="text-sm text-muted-foreground p-4">还没有工作流。</p>

  return (
    <>
      <div className="grid grid-cols-2 sm:grid-cols-3 gap-3 p-4">
        {items.map((meta) => (
          <WorkflowCard key={meta.id} meta={meta}
            onOpen={() => void window.synapse?.workflow.openEditor(meta.id)}
            onRun={() => void handleRun(meta.id)}
            onDelete={() => void handleDelete(meta.id)} />
        ))}
      </div>
      <RunParamsDialog open={!!runTarget} params={runTarget?.params ?? []} onConfirm={handleConfirmRun} onCancel={() => setRunTarget(null)} />
    </>
  )
}
