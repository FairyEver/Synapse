import { Button } from "@/components/ui/button"
import { WorkflowList } from "./components/workflow-list"
import { Plus } from "lucide-react"

export function WorkflowModule() {
  const handleCreate = async () => {
    const id = crypto.randomUUID()
    const now = Date.now()
    await window.synapse?.workflow.save({ id, name: "新工作流", version: "", createdAt: now, updatedAt: now, params: [], nodes: [], edges: [] })
    await window.synapse?.workflow.openEditor(id)
  }
  return (
    <div className="flex flex-col h-full">
      <div className="flex items-center justify-between border-b px-4 py-3">
        <h2 className="text-sm font-semibold">工作流</h2>
        <Button size="sm" variant="outline" onClick={handleCreate}><Plus className="h-4 w-4 mr-1.5" />新建</Button>
      </div>
      <div className="flex-1 overflow-auto"><WorkflowList /></div>
    </div>
  )
}
