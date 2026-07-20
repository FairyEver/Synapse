import { useState } from "react"
import { toast } from "sonner"
import { useAppConfig } from "@/app-shell/config"
import { createRendererLogger } from "@/app-shell/logging"
import { ModulePage } from "@/components/module-page"
import { SystemAppTopBarActionButton } from "@/modules/apps/components/system-app-top-bar"
import { requireBridgeDomain } from "@/lib/electron-bridge"
import { WorkflowList } from "./components/workflow-list"
import { Loader2, Plus, Upload } from "lucide-react"
import { WorkflowImportDialog } from "./components/workflow-import-dialog"
import { WorkflowShareImportDialog } from "./components/workflow-share-import-dialog"
// Renderer-side registration: manifests only. Executors live in `*.main.ts`
// files that import main-process modules (electron, node:fs, ...) and must not
// be pulled into the Vite renderer bundle.
import "../../../workflow-nodes/register.renderer"

import type {
  WorkflowImportOptions,
  WorkflowImportPreview,
  WorkflowModelMapping,
  WorkflowShareImportPreview,
  WorkflowShareImportSelections,
} from "@/types/workflow-package"
import { errorDiagnostic } from "./lib/error-utils"

const logger = createRendererLogger("workflow")

export function WorkflowModule() {
  const [listKey, setListKey] = useState(0)
  const [creating, setCreating] = useState(false)
  const [importPreview, setImportPreview] = useState<WorkflowImportPreview | WorkflowShareImportPreview | null>(null)
  const [importing, setImporting] = useState(false)
  const appConfig = useAppConfig()

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
      const diagnostic = errorDiagnostic(err)
      logger.warn("Workflow import preview failed.", {
        boundary: "renderer.workflow.import.preview",
        ...diagnostic,
      })
      toast.error(diagnostic.errorMessage ?? "导入失败，请重试")
    }
  }

  const handleImportConfirm = async (mappings: WorkflowModelMapping[], options: WorkflowImportOptions) => {
    if (!importPreview || isShareImportPreview(importPreview)) return
    setImporting(true)
    try {
      const result = await requireBridgeDomain("workflow").importPackage(importPreview.packagePath, mappings, options, importPreview.packageDigest)
      if ("errors" in result) {
        toast.error(result.errors[0]?.message ?? "导入失败：校验未通过")
        return
      }
      setImportPreview(null)
      setListKey((key) => key + 1)
      toast.success("工作流已导入")
      try {
        await requireBridgeDomain("workflow").openEditor(result.workflowId)
      } catch (err) {
        logger.warn("Workflow import open editor failed.", {
          boundary: "renderer.workflow.import.openEditor",
          workflowId: result.workflowId,
          ...errorDiagnostic(err),
        })
        toast.error("工作流已导入，但打开编辑器失败")
      }
    } catch (err) {
      const diagnostic = errorDiagnostic(err)
      logger.warn("Workflow import failed.", {
        boundary: "renderer.workflow.import",
        ...diagnostic,
      })
      toast.error(diagnostic.errorMessage ?? "导入失败，请重试")
    } finally {
      setImporting(false)
    }
  }

  const handleShareImportConfirm = async (selections: WorkflowShareImportSelections) => {
    if (!importPreview || !isShareImportPreview(importPreview)) return
    setImporting(true)
    try {
      const result = await requireBridgeDomain("workflow").importSharePackage(
        importPreview.packagePath,
        selections,
        importPreview.packageDigest,
      )
      if ("errors" in result) {
        toast.error(result.errors[0]?.message ?? "导入失败：校验未通过")
        return
      }
      const lineageId = importPreview.lineageId
      setImportPreview(null)
      setListKey((key) => key + 1)
      toast.success(result.mutated === false
        ? "该版本已导入，无需重复处理"
        : importPreview.mode === "update" ? "工作流已更新" : "工作流已导入", result.undoCreated ? {
        action: {
          label: "撤销",
          onClick: () => {
            void requireBridgeDomain("workflow").undoShareImport(lineageId).then(() => {
              setListKey((key) => key + 1)
              toast.success("已撤销本次导入")
            }).catch((err) => {
              const diagnostic = errorDiagnostic(err)
              logger.warn("Workflow share import undo failed.", {
                boundary: "renderer.workflow.share-import.undo",
                ...diagnostic,
              })
              toast.error(diagnostic.errorMessage ?? "撤销失败")
            })
          },
        },
      } : undefined)
      try {
        await requireBridgeDomain("workflow").openEditor(result.workflowId)
      } catch (err) {
        logger.warn("Workflow share import open editor failed.", {
          boundary: "renderer.workflow.share-import.openEditor",
          workflowId: result.workflowId,
          ...errorDiagnostic(err),
        })
        toast.error("工作流已导入，但打开编辑器失败")
      }
    } catch (err) {
      const diagnostic = errorDiagnostic(err)
      logger.warn("Workflow share import failed.", {
        boundary: "renderer.workflow.share-import",
        ...diagnostic,
      })
      toast.error(diagnostic.errorMessage ?? "导入失败，请重试")
    } finally {
      setImporting(false)
    }
  }

  return (
    <ModulePage
      title="工作流"
      actions={(
        <>
          <SystemAppTopBarActionButton type="button" disabled={importing} onClick={handleImportStart}>
            <Upload data-icon="inline-start" />
            导入
          </SystemAppTopBarActionButton>
          <SystemAppTopBarActionButton type="button" disabled={creating} onClick={handleCreate}>
            {creating ? <Loader2 className="animate-spin" data-icon="inline-start" /> : <Plus data-icon="inline-start" />}
            新建
          </SystemAppTopBarActionButton>
        </>
      )}
      afterContent={(
        isShareImportPreview(importPreview) ? (
          <WorkflowShareImportDialog
            open
            preview={importPreview}
            importing={importing}
            onOpenChange={(open) => { if (!open) setImportPreview(null) }}
            onImport={(selections) => void handleShareImportConfirm(selections)}
          />
        ) : (
          <WorkflowImportDialog
            open={!!importPreview}
            preview={importPreview}
            projects={appConfig.config.global.projects}
            importing={importing}
            onOpenChange={(open) => { if (!open) setImportPreview(null) }}
            onImport={(mappings, options) => void handleImportConfirm(mappings, options)}
          />
        )
      )}
    >
      <WorkflowList key={listKey} onCreate={handleCreate} />
    </ModulePage>
  )
}

function isShareImportPreview(
  preview: WorkflowImportPreview | WorkflowShareImportPreview | null,
): preview is WorkflowShareImportPreview {
  return Boolean(preview && "content" in preview)
}
