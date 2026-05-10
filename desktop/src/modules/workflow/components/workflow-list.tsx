import { useState } from "react"
import { WorkflowCard } from "./workflow-card"
import { RunParamsDialog } from "./run-params-dialog"
import { useWorkflowList } from "../hooks/use-workflow-list"
import type { WorkflowDefinition } from "@/types/workflow"

export function WorkflowList() {
  const { items, loading, refresh } = useWorkflowList()
  const [runTarget, setRunTarget] = useState<WorkflowDefinition | null>(null)

  const handleRun = async (id: string) => { const def = await window.synapse?.workflow.get(id); if (def) setRunTarget(def) }

  const handleConfirmRun = async (params: Record<string, unknown>) => {
    if (!runTarget) return
    setRunTarget(null)
    await window.synapse?.workflow.run(runTarget.id, params)
    void refresh()
  }

  if (loading) return <p className="text-sm text-muted-foreground p-4">加载中…</p>
  if (items.length === 0) return <p className="text-sm text-muted-foreground p-4">还没有工作流。</p>

  return (
    <>
      <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-3 p-4">
        {items.map((meta) => (
          <WorkflowCard key={meta.id} meta={meta}
            onOpen={() => void window.synapse?.workflow.openEditor(meta.id)}
            onRun={() => void handleRun(meta.id)} />
        ))}
      </div>
      <RunParamsDialog open={!!runTarget} params={runTarget?.params ?? []} onConfirm={handleConfirmRun} onCancel={() => setRunTarget(null)} />
    </>
  )
}
