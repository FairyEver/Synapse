import { useState } from "react"
import { Button } from "@/components/ui/button"
import { WorkflowList } from "./components/workflow-list"
import { Plus } from "lucide-react"
import "../../../workflow-nodes/register.main"

export function WorkflowModule() {
  const [listKey, setListKey] = useState(0)

  const handleCreate = async () => {
    const result = await window.synapse?.workflow.create()
    if (!result || "errors" in result) return
    await window.synapse?.workflow.openEditor(result.id)
    setListKey((k) => k + 1)
  }
  return (
    <div className="flex flex-col h-full">
      <div className="flex items-center justify-between border-b px-4 py-3">
        <h2 className="text-sm font-semibold">工作流</h2>
        <Button size="sm" variant="outline" onClick={handleCreate}><Plus className="h-4 w-4 mr-1.5" />新建</Button>
      </div>
      <div className="flex-1 overflow-auto"><WorkflowList key={listKey} /></div>
    </div>
  )
}
