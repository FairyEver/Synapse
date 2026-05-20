import { useState } from "react"
import { toast } from "sonner"
import { createRendererLogger } from "@/app-shell/logging"
import { Button } from "@/components/ui/button"
import { ScrollArea } from "@/components/ui/scroll-area"
import { requireBridgeDomain } from "@/lib/electron-bridge"
import { WorkflowList } from "./components/workflow-list"
import { Loader2, Plus, Upload } from "lucide-react"
import { WorkflowImportDialog } from "./components/workflow-import-dialog"
// Renderer-side registration: manifests only. Executors live in `*.main.ts`
// files that import main-process modules (electron, node:fs, ...) and must not
// be pulled into the Vite renderer bundle.
import "../../../workflow-nodes/register.renderer"

import type { WorkflowImportPreview, WorkflowModelMapping } from "@/types/workflow-package"
import { errorDiagnostic } from "./lib/error-utils"

const logger = createRendererLogger("workflow")

export function WorkflowModule() {
  const [listKey, setListKey] = useState(0)
  const [creating, setCreating] = useState(false)
  const [importPreview, setImportPreview] = useState<WorkflowImportPreview | null>(null)
  const [importing, setImporting] = useState(false)

  const handleCreate = async () => {
    if (creating) return
    setCreating(true)
    try {
      const workflowApi = requireBridgeDomain("workflow")
      const result = await workflowApi.create()
      if ("errors" in result) {
        toast.error(result.errors[0]?.message ?? "创建工作流失败：校验未通过")
        return
      }

      setListKey((k) => k + 1)

      try {
        await workflowApi.openEditor(result.id)
      } catch (err) {
        logger.warn("Workflow created but open editor failed.", {
          boundary: "renderer.workflow.create",
          workflowId: result.id,
          ...errorDiagnostic(err),
        })
        toast.error("工作流已创建，但打开编辑器失败")
      }
    } catch (err) {
      logger.warn("Workflow create failed.", {
        boundary: "renderer.workflow.create",
        ...errorDiagnostic(err),
      })
      toast.error("创建工作流失败，请重试")
    } finally {
      setCreating(false)
    }
  }

  const handleImportStart = async () => {
    try {
      const preview = await requireBridgeDomain("workflow").inspectImportPackage()
      if (preview) setImportPreview(preview)
    } catch (err) {
      logger.warn("Workflow import preview failed.", {
        boundary: "renderer.workflow.import.preview",
        ...errorDiagnostic(err),
      })
      toast.error("导入失败，请重试")
    }
  }

  const handleImportConfirm = async (mappings: WorkflowModelMapping[]) => {
    if (!importPreview) return
    setImporting(true)
    try {
      const result = await requireBridgeDomain("workflow").importPackage(importPreview.packagePath, mappings)
      if ("errors" in result) {
        toast.error(result.errors[0]?.message ?? "导入失败：校验未通过")
        return
      }
      setImportPreview(null)
      setListKey((key) => key + 1)
      toast.success("工作流已导入")
      await requireBridgeDomain("workflow").openEditor(result.workflowId)
    } catch (err) {
      logger.warn("Workflow import failed.", {
        boundary: "renderer.workflow.import",
        ...errorDiagnostic(err),
      })
      toast.error("导入失败，请重试")
    } finally {
      setImporting(false)
    }
  }

  return (
    <div className="flex flex-col h-full">
      <div className="flex items-center justify-between border-b px-4 py-3">
        <h2 className="text-sm font-semibold">工作流</h2>
        <div className="flex items-center gap-2">
          <Button size="sm" variant="outline" disabled={importing} onClick={handleImportStart}>
            <Upload className="h-4 w-4 mr-1.5" />导入
          </Button>
          <Button size="sm" variant="outline" disabled={creating} onClick={handleCreate}>
            {creating ? <Loader2 className="h-4 w-4 mr-1.5 animate-spin" /> : <Plus className="h-4 w-4 mr-1.5" />}新建
          </Button>
        </div>
      </div>
      <ScrollArea className="flex-1"><WorkflowList key={listKey} onCreate={handleCreate} /></ScrollArea>
      <WorkflowImportDialog
        open={!!importPreview}
        preview={importPreview}
        importing={importing}
        onOpenChange={(open) => { if (!open) setImportPreview(null) }}
        onImport={(mappings) => void handleImportConfirm(mappings)}
      />
    </div>
  )
}
