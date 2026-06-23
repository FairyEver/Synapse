import { useEffect, useMemo, useState } from "react"
import { Button } from "@/components/ui/button"
import { Alert, AlertDescription } from "@/components/ui/alert"
import {
  Dialog,
  DialogContent,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog"
import { ScrollArea } from "@/components/ui/scroll-area"
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select"
import { ProviderModelSelectDialog } from "@/components/provider-model-select-dialog"
import { ChevronDown } from "lucide-react"
import { resolveModelDisplayName } from "@/lib/provider-model"
import type { SynapseProjectConfig } from "@/types/config"
import type { ModelTier, ProviderModelSelection } from "@/types/provider-model"
import type {
  WorkflowImportOptions,
  WorkflowImportPreview,
  WorkflowModelMapping,
  WorkflowModelReference,
  WorkflowPackageModelTier,
} from "@/types/workflow-package"

interface WorkflowImportDialogProps {
  open: boolean
  preview: WorkflowImportPreview | null
  projects: readonly SynapseProjectConfig[]
  importing?: boolean
  onOpenChange: (open: boolean) => void
  onImport: (mappings: WorkflowModelMapping[], options: WorkflowImportOptions) => void
}

function WorkflowImportDialog({
  open,
  preview,
  projects,
  importing = false,
  onOpenChange,
  onImport,
}: WorkflowImportDialogProps) {
  const [mappings, setMappings] = useState<Record<string, WorkflowModelMapping>>({})
  const [targetProjectId, setTargetProjectId] = useState("")
  const [selectingRefId, setSelectingRefId] = useState<string | null>(null)
  const activeProvider = preview?.providerOptions.find((provider) => provider.active) ?? preview?.providerOptions[0]

  useEffect(() => {
    if (!preview) {
      setMappings({})
      setTargetProjectId("")
      return
    }
    setMappings(Object.fromEntries(preview.suggestedMappings.map((mapping) => [mapping.sourceRefId, mapping])))
    setTargetProjectId(projects[0]?.id ?? "")
  }, [preview, projects])

  const rows = preview?.modelReferences ?? []
  const missingProviders = Boolean(preview && rows.length > 0 && preview.providerOptions.length === 0)
  const missingProject = Boolean(preview?.workflow.requiresProjectMapping && projects.length === 0)
  const canImport = Boolean(preview)
    && !missingProject
    && (!preview?.workflow.requiresProjectMapping || Boolean(targetProjectId))
    && rows.every((row) => mappings[row.id]?.targetProviderId && mappings[row.id]?.targetModelTier)

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
    onImport(preview.modelReferences.map((ref) => mappings[ref.id]), {
      ...(preview.workflow.requiresProjectMapping ? { targetProjectId } : {}),
    })
  }

  function handleOpenChange(nextOpen: boolean) {
    if (!nextOpen && importing) return
    onOpenChange(nextOpen)
  }

  function preventCloseWhileImporting(event: Event) {
    if (!importing) return
    event.preventDefault()
  }

  function handleSelectModel(selection: ProviderModelSelection) {
    if (!selectingRefId) return
    updateMapping(selectingRefId, {
      targetProviderId: selection.providerId,
      targetModelTier: selection.modelTier,
    })
  }

  return (
    <Dialog open={open} onOpenChange={handleOpenChange}>
      <DialogContent
        aria-describedby={undefined}
        className="flex max-h-[calc(100vh-2rem)] flex-col sm:max-w-[760px]"
        showCloseButton={!importing}
        onEscapeKeyDown={preventCloseWhileImporting}
        onInteractOutside={preventCloseWhileImporting}
      >
        <DialogHeader>
          <DialogTitle>导入工作流</DialogTitle>
        </DialogHeader>
        {preview ? (
          <>
            <div className="flex items-center gap-2 border-b pb-3 text-sm">
              <span className="font-medium">{preview.workflow.name}</span>
              <span className="text-muted-foreground">{preview.workflow.nodeCount} 个节点</span>
              <span className="text-muted-foreground">{preview.workflow.modelReferenceCount} 个模型</span>
            </div>
            {missingProviders ? (
              <Alert>
                <AlertDescription>先配置供应商后再导入。</AlertDescription>
              </Alert>
            ) : null}
            {missingProject ? (
              <Alert>
                <AlertDescription>先添加项目后再导入。</AlertDescription>
              </Alert>
            ) : null}
            {preview.workflow.requiresProjectMapping && projects.length > 0 ? (
              <div className="grid gap-2 border-b pb-3">
                <div className="text-sm font-medium">默认项目</div>
                <Select value={targetProjectId} onValueChange={setTargetProjectId}>
                  <SelectTrigger className="w-full">
                    <SelectValue placeholder="选择项目" />
                  </SelectTrigger>
                  <SelectContent>
                    {projects.map((project) => (
                      <SelectItem key={project.id} value={project.id}>
                        {project.name}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
            ) : null}
            <ScrollArea className="min-h-0 flex-1 pr-3">
              <div className="space-y-3">
                {rows.map((ref) => {
                  const mapping = mappings[ref.id]
                  return (
                    <div key={ref.id} className="grid gap-2 border-b pb-3 md:grid-cols-[1.2fr_1fr_1.2fr]">
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
  const modelName = provider
    ? resolveModelDisplayName({
      id: provider.providerId,
      model: provider.models.default,
      haikuModel: provider.models.haiku,
      sonnetModel: provider.models.sonnet,
      opusModel: provider.models.opus,
    }, mapping.targetModelTier) ?? mapping.targetModelTier
    : mapping.targetModelTier
  return `${providerName} / ${modelName}`
}

export { WorkflowImportDialog }
export type { WorkflowImportDialogProps }
