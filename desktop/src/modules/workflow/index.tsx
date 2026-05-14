import { useState } from "react"
import { toast } from "sonner"
import { createRendererLogger } from "@/app-shell/logging"
import { Button } from "@/components/ui/button"
import { WorkflowList } from "./components/workflow-list"
import { Loader2, Plus } from "lucide-react"
// Renderer-side registration: manifests only. Executors live in `*.main.ts`
// files that import main-process modules (electron, node:fs, ...) and must not
// be pulled into the Vite renderer bundle.
import "../../../workflow-nodes/register.renderer"

const logger = createRendererLogger("workflow")

export function WorkflowModule() {
  const [listKey, setListKey] = useState(0)
  const [creating, setCreating] = useState(false)

  const handleCreate = async () => {
    if (creating) return
    setCreating(true)
    try {
      const result = await window.synapse?.workflow.create()
      if (!result) {
        toast.error("创建工作流失败：无法连接到主进程")
        return
      }
      if ("errors" in result) {
        toast.error(result.errors[0]?.message ?? "创建工作流失败：校验未通过")
        return
      }
      await window.synapse?.workflow.openEditor(result.id)
      setListKey((k) => k + 1)
    } catch (err) {
      logger.warn("Workflow create failed.", {
        boundary: "renderer.workflow.create",
        ...errorLogMeta(err),
      })
      toast.error("创建工作流失败，请重试")
    } finally {
      setCreating(false)
    }
  }
  return (
    <div className="flex flex-col h-full">
      <div className="flex items-center justify-between border-b px-4 py-3">
        <h2 className="text-sm font-semibold">工作流</h2>
        <Button size="sm" variant="outline" disabled={creating} onClick={handleCreate}>
          {creating ? <Loader2 className="h-4 w-4 mr-1.5 animate-spin" /> : <Plus className="h-4 w-4 mr-1.5" />}新建
        </Button>
      </div>
      <div className="flex-1 overflow-auto"><WorkflowList key={listKey} /></div>
    </div>
  )
}

function errorLogMeta(error: unknown): { readonly errorName: string; readonly errorLength: number } {
  const text = error instanceof Error
    ? error.message
    : typeof error === "string"
      ? error
      : String(error)
  return {
    errorName: error instanceof Error ? error.name : typeof error,
    errorLength: text.length,
  }
}
