import { useEffect, useMemo, useState } from "react"
import { Button } from "@/components/ui/button"
import {
  Dialog,
  DialogContent,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog"
import { ScrollArea } from "@/components/ui/scroll-area"
import { ProviderModelSelectDialog } from "@/components/provider-model-select-dialog"
import { ChevronDown } from "lucide-react"
import type { ModelTier, ProviderModelSelection } from "@/types/provider-model"
import type {
  WorkflowImportPreview,
  WorkflowModelMapping,
  WorkflowModelReference,
  WorkflowPackageModelTier,
} from "@/types/workflow-package"

interface WorkflowImportDialogProps {
  open: boolean
  preview: WorkflowImportPreview | null
  importing?: boolean
  onOpenChange: (open: boolean) => void
  onImport: (mappings: WorkflowModelMapping[]) => void
}

function WorkflowImportDialog({
  open,
  preview,
  importing = false,
  onOpenChange,
  onImport,
}: WorkflowImportDialogProps) {
  const [mappings, setMappings] = useState<Record<string, WorkflowModelMapping>>({})
  const [selectingRefId, setSelectingRefId] = useState<string | null>(null)
  const activeProvider = preview?.providerOptions.find((provider) => provider.active) ?? preview?.providerOptions[0]

  useEffect(() => {
    if (!preview) {
      setMappings({})
      return
    }
    setMappings(Object.fromEntries(preview.suggestedMappings.map((mapping) => [mapping.sourceRefId, mapping])))
  }, [preview])

  const rows = preview?.modelReferences ?? []
  const canImport = Boolean(preview) && rows.every((row) => mappings[row.id]?.targetProviderId && mappings[row.id]?.targetModelTier)

  const providerById = useMemo(
    () => new Map((preview?.providerOptions ?? []).map((provider) => [provider.providerId, provider])),
    [preview],
  )

  const selectingMapping = selectingRefId ? mappings[selectingRefId] : undefined

  function updateMapping(refId: string, patch: Partial<WorkflowModelMapping>) {
    setMappings((prev) => {
      const current = prev[refId] ?? {
        sourceRefId: refId,
        targetProviderId: activeProvider?.providerId ?? "",
        targetModelTier: "default" as const,
      }
      return { ...prev, [refId]: { ...current, ...patch } }
    })
  }

  function useDefaultForAll() {
    if (!preview || !activeProvider) return
    setMappings(Object.fromEntries(preview.modelReferences.map((ref) => [ref.id, {
      sourceRefId: ref.id,
      targetProviderId: activeProvider.providerId,
      targetModelTier: "default" as const,
    }])))
  }

  function handleImport() {
    if (!preview || !canImport) return
    onImport(preview.modelReferences.map((ref) => mappings[ref.id]))
  }

  function handleSelectModel(selection: ProviderModelSelection) {
    if (!selectingRefId) return
    updateMapping(selectingRefId, {
      targetProviderId: selection.providerId,
      targetModelTier: selection.modelTier,
    })
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent aria-describedby={undefined} className="flex max-h-[calc(100vh-2rem)] flex-col sm:max-w-[760px]">
        <DialogHeader>
          <DialogTitle>导入工作流</DialogTitle>
        </DialogHeader>
        {preview ? (
          <>
            <div className="flex items-center gap-3 border-b pb-3 text-sm">
              <span className="font-medium">{preview.workflow.name}</span>
              <span className="text-muted-foreground">{preview.workflow.nodeCount} 个节点</span>
              <span className="text-muted-foreground">{preview.workflow.modelReferenceCount} 个模型</span>
            </div>
            <ScrollArea className="min-h-0 flex-1 pr-3">
              <div className="space-y-3">
                {rows.map((ref) => {
                  const mapping = mappings[ref.id]
                  return (
                    <div key={ref.id} className="grid gap-3 border-b pb-3 md:grid-cols-[1.2fr_1fr_1.2fr]">
                      <div className="min-w-0">
                        <div className="truncate text-sm font-medium">{formatSourceModel(ref)}</div>
                        <div className="truncate text-xs text-muted-foreground">{ref.sourceModelTier}</div>
                      </div>
                      <div className="min-w-0 text-xs text-muted-foreground">{formatOccurrences(ref)}</div>
                      <div className="min-w-0">
                        <Button
                          type="button"
                          variant="outline"
                          className="h-8 w-full justify-between"
                          onClick={() => setSelectingRefId(ref.id)}
                        >
                          <span className="truncate">{formatTargetModel(mapping, providerById)}</span>
                          <ChevronDown className="size-3.5 text-muted-foreground" />
                        </Button>
                      </div>
                    </div>
                  )
                })}
              </div>
            </ScrollArea>
          </>
        ) : null}
        <DialogFooter>
          <Button type="button" variant="outline" disabled={importing} onClick={() => onOpenChange(false)}>
            取消
          </Button>
          <Button type="button" variant="outline" disabled={!preview || importing || !activeProvider} onClick={useDefaultForAll}>
            全部使用默认模型
          </Button>
          <Button type="button" disabled={!canImport || importing} onClick={handleImport}>
            {importing ? "导入中..." : "导入"}
          </Button>
        </DialogFooter>
        <ProviderModelSelectDialog
          open={selectingRefId !== null}
          onOpenChange={(nextOpen) => { if (!nextOpen) setSelectingRefId(null) }}
          defaultSelection={selectingMapping
            ? {
              providerId: selectingMapping.targetProviderId,
              modelTier: selectingMapping.targetModelTier as ModelTier,
            }
            : undefined}
          onSelect={handleSelectModel}
        />
      </DialogContent>
    </Dialog>
  )
}

function formatSourceModel(ref: WorkflowModelReference): string {
  return [ref.sourceProviderName ?? ref.sourceProviderId ?? "未知供应商", ref.sourceModelName ?? ref.sourceModelTier].join(" / ")
}

function formatOccurrences(ref: WorkflowModelReference): string {
  return ref.occurrences.map((occurrence) => {
    if (occurrence.kind === "workflowDefault") return "全局"
    return occurrence.nodeName
  }).join("、")
}

function formatTargetModel(
  mapping: WorkflowModelMapping | undefined,
  providerById: ReadonlyMap<string, WorkflowImportPreview["providerOptions"][number]>,
): string {
  if (!mapping) return "选择供应商 + 模型"
  const provider = providerById.get(mapping.targetProviderId)
  const providerName = provider?.providerName ?? mapping.targetProviderId
  const modelName = provider?.models[mapping.targetModelTier] ?? mapping.targetModelTier
  return `${providerName} / ${modelName}`
}

export { WorkflowImportDialog }
export type { WorkflowImportDialogProps }
