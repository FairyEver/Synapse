import { useEffect, useMemo, useState } from "react"
import { Alert, AlertDescription } from "@/components/ui/alert"
import { Badge } from "@/components/ui/badge"
import { Button } from "@/components/ui/button"
import {
  Dialog,
  DialogContent,
  DialogFrame,
  DialogFrameBody,
  DialogFrameFooter,
  DialogFrameHeader,
} from "@/components/ui/dialog"
import { Input } from "@/components/ui/input"
import { Label } from "@/components/ui/label"
import { ScrollArea } from "@/components/ui/scroll-area"
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select"
import { ProviderModelSelectDialog } from "@/components/provider-model-select-dialog"
import { resolveModelDisplayName } from "@/lib/provider-model"
import { createRendererLogger } from "@/app-shell/logging"
import { toast } from "sonner"
import { useWorkflowResourcePicker } from "../hooks/use-workflow-resource-picker"
import type { ModelTier, ProviderModelSelection } from "@/types/provider-model"
import type {
  WorkflowShareEnvironmentMapping,
  WorkflowShareImportPreview,
  WorkflowShareImportSelections,
  WorkflowShareModelMapping,
  WorkflowShareProjectMapping,
  WorkflowShareResourceMapping,
} from "@/types/workflow-package"

const STEPS = ["内容", "风险与兼容", "模型映射", "项目映射", "外部依赖", "确认"] as const
const logger = createRendererLogger("workflow.share-import")

interface WorkflowShareImportDialogProps {
  readonly open: boolean
  readonly preview: WorkflowShareImportPreview | null
  readonly importing?: boolean
  readonly onOpenChange: (open: boolean) => void
  readonly onImport: (selections: WorkflowShareImportSelections) => void
}

function WorkflowShareImportDialog({
  open,
  preview,
  importing = false,
  onOpenChange,
  onImport,
}: WorkflowShareImportDialogProps) {
  const [step, setStep] = useState(0)
  const [selections, setSelections] = useState<WorkflowShareImportSelections>(emptySelections())
  const [selectingModelRefId, setSelectingModelRefId] = useState<string | null>(null)

  useEffect(() => {
    setStep(0)
    setSelectingModelRefId(null)
    setSelections(preview ? buildInitialSelections(preview) : emptySelections())
  }, [preview])

  const missing = useMemo(() => preview ? findMissingMappings(preview, selections) : [], [preview, selections])
  const canImport = Boolean(preview?.compatibility.supported) && missing.length === 0
  const selectingModel = selectingModelRefId
    ? selections.models.find((mapping) => mapping.sourceRefId === selectingModelRefId)
    : undefined

  function move(direction: 1 | -1) {
    if (!preview) return
    setStep((current) => nextRelevantStep(preview, current, direction))
  }

  function updateModel(mapping: WorkflowShareModelMapping) {
    setSelections((current) => ({
      ...current,
      models: replaceMapping(current.models, mapping),
    }))
  }

  function updateProject(mapping: WorkflowShareProjectMapping) {
    setSelections((current) => ({
      ...current,
      projects: replaceMapping(current.projects, mapping),
    }))
  }

  function updateResource(mapping: WorkflowShareResourceMapping) {
    setSelections((current) => ({
      ...current,
      resources: replaceMapping(current.resources, mapping),
    }))
  }

  function updateEnvironment(mapping: WorkflowShareEnvironmentMapping) {
    setSelections((current) => ({
      ...current,
      environments: replaceMapping(current.environments, mapping),
    }))
  }

  function handleOpenChange(nextOpen: boolean) {
    if (!nextOpen && importing) return
    onOpenChange(nextOpen)
  }

  return (
    <Dialog open={open} onOpenChange={handleOpenChange}>
      <DialogContent
        aria-describedby={undefined}
        className="h-[min(760px,calc(100vh-2rem))] p-0 sm:max-w-[920px]"
        showCloseButton={false}
        onEscapeKeyDown={(event) => { if (importing) event.preventDefault() }}
        onInteractOutside={(event) => { if (importing) event.preventDefault() }}
      >
        <DialogFrame>
          <DialogFrameHeader
            bordered
            title="导入工作流"
            description={preview?.shareNote || undefined}
            showCloseButton={!importing}
            center={<span className="text-sm font-medium">{step + 1} / {STEPS.length} · {STEPS[step]}</span>}
          />
          <DialogFrameBody>
            <ScrollArea className="h-full">
              <div className="mx-auto max-w-3xl space-y-4 px-5 py-5">
                {preview ? renderStep({
                  preview,
                  selections,
                  step,
                  missing,
                  onSelectModel: setSelectingModelRefId,
                  onUpdateModel: updateModel,
                  onUpdateProject: updateProject,
                  onUpdateResource: updateResource,
                  onUpdateEnvironment: updateEnvironment,
                }) : null}
              </div>
            </ScrollArea>
          </DialogFrameBody>
          <DialogFrameFooter>
            <Button type="button" variant="outline" disabled={importing} onClick={() => onOpenChange(false)}>取消</Button>
            {step > 0 ? (
              <Button type="button" variant="outline" disabled={importing} onClick={() => move(-1)}>上一步</Button>
            ) : null}
            {step < STEPS.length - 1 ? (
              <Button type="button" disabled={importing} onClick={() => move(1)}>下一步</Button>
            ) : (
              <Button type="button" disabled={!canImport || importing} onClick={() => onImport(selections)}>
                {importing ? "导入中..." : preview?.mode === "update" ? "更新工作流" : "导入工作流"}
              </Button>
            )}
          </DialogFrameFooter>
        </DialogFrame>
        <ProviderModelSelectDialog
          open={selectingModelRefId !== null}
          onOpenChange={(nextOpen) => { if (!nextOpen) setSelectingModelRefId(null) }}
          defaultSelection={selectingModel?.targetProviderId && selectingModel.targetModelTier
            ? { providerId: selectingModel.targetProviderId, modelTier: selectingModel.targetModelTier as ModelTier }
            : undefined}
          onSelect={(selection) => {
            if (!selectingModelRefId) return
            updateModelMappingFromSelection(selectingModelRefId, selection, updateModel)
            setSelectingModelRefId(null)
          }}
        />
      </DialogContent>
    </Dialog>
  )
}

interface StepProps {
  readonly preview: WorkflowShareImportPreview
  readonly selections: WorkflowShareImportSelections
  readonly step: number
  readonly missing: string[]
  readonly onSelectModel: (refId: string) => void
  readonly onUpdateModel: (mapping: WorkflowShareModelMapping) => void
  readonly onUpdateProject: (mapping: WorkflowShareProjectMapping) => void
  readonly onUpdateResource: (mapping: WorkflowShareResourceMapping) => void
  readonly onUpdateEnvironment: (mapping: WorkflowShareEnvironmentMapping) => void
}

function renderStep(props: StepProps) {
  switch (props.step) {
    case 0: return <ContentStep preview={props.preview} />
    case 1: return <RiskStep preview={props.preview} />
    case 2: return <ModelStep {...props} />
    case 3: return <ProjectStep {...props} />
    case 4: return <ExternalStep {...props} />
    default: return <ConfirmStep preview={props.preview} missing={props.missing} />
  }
}

function ContentStep({ preview }: { readonly preview: WorkflowShareImportPreview }) {
  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-center gap-2">
        <Badge variant="secondary">{preview.content.workflows.length} 个工作流</Badge>
        <Badge variant="secondary">{preview.content.workflows.reduce((sum, workflow) => sum + workflow.nodeCount, 0)} 个节点</Badge>
        <Badge variant="secondary">格式 {preview.formatVersion}</Badge>
      </div>
      <div className="divide-y rounded-lg border">
        {preview.content.workflows.map((workflow) => (
          <div key={workflow.ref} className="flex items-center justify-between gap-4 px-4 py-3">
            <div className="min-w-0">
              <div className="truncate font-medium">{workflow.name}</div>
              <div className="text-xs text-muted-foreground">{workflow.nodeCount} 个节点</div>
            </div>
            <Badge variant="outline">{formatWorkflowAction(workflow.action)}</Badge>
          </div>
        ))}
      </div>
      {preview.compatibility.excludedAutomationCount > 0 ? (
        <Alert><AlertDescription>关联的 Automation 不在分享包中，导入后需要单独配置。</AlertDescription></Alert>
      ) : null}
    </div>
  )
}

function RiskStep({ preview }: { readonly preview: WorkflowShareImportPreview }) {
  const risks = [
    ...preview.compatibility.sensitiveLocations.map((location) => ({ label: "敏感信息", location })),
    ...preview.compatibility.highRiskLocations.map((location) => ({ label: "高风险配置", location })),
    ...preview.compatibility.portabilityWarnings.map((location) => ({ label: "兼容提醒", location })),
  ]
  return (
    <div className="space-y-4">
      {!preview.sourceVerified ? (
        <Alert><AlertDescription>文件完整性已校验，但分享者身份未经验证。只导入可信来源的工作流。</AlertDescription></Alert>
      ) : null}
      {!preview.compatibility.supported ? (
        <Alert variant="destructive"><AlertDescription>{preview.compatibility.issues.join("；")}</AlertDescription></Alert>
      ) : null}
      {risks.length === 0 ? <div className="text-sm text-muted-foreground">未发现需要额外确认的配置。</div> : (
        <div className="divide-y rounded-lg border">
          {risks.map(({ label, location }, index) => (
            <div key={`${label}-${index}`} className="flex items-start justify-between gap-4 px-4 py-3">
              <div className="min-w-0">
                <div className="font-medium">{location.nodeName ?? "工作流设置"}</div>
                <div className="break-all text-xs text-muted-foreground">{location.fieldPath.join(".")}</div>
              </div>
              <Badge variant="outline">{label}</Badge>
            </div>
          ))}
        </div>
      )}
      {preview.compatibility.automationUpdates.length > 0 ? (
        <Alert><AlertDescription>
          {preview.compatibility.automationUpdates.map((item) => `${item.name}（${item.reason}）`).join("、")} 将被停用，配置和运行历史保留。
        </AlertDescription></Alert>
      ) : null}
      {preview.summary.incompatiblePresetCount > 0 ? (
        <Alert><AlertDescription>{preview.summary.incompatiblePresetCount} 个参数预设与新参数不兼容；预设会保留，不会自动修改。</AlertDescription></Alert>
      ) : null}
    </div>
  )
}

function ModelStep({ preview, selections, onSelectModel, onUpdateModel }: StepProps) {
  return (
    <div className="divide-y rounded-lg border">
      {preview.mappings.models.map((reference) => {
        const mapping = selections.models.find((item) => item.sourceRefId === reference.id)
        const localDefault = mapping?.action === "local-default"
        return (
          <div key={reference.id} className="grid gap-3 px-4 py-4 md:grid-cols-[minmax(0,1fr)_minmax(0,1fr)] md:items-center">
            <div className="min-w-0">
              <div className="font-medium">{formatSourceModel(reference)}</div>
              <div className="text-xs text-muted-foreground">用于 {formatOccurrenceNames(reference.occurrences)}</div>
            </div>
            <div className="flex min-w-0 gap-2">
              {reference.environment === "synapse" ? (
                <Button type="button" variant="outline" className="min-w-0 flex-1 justify-start" disabled={localDefault} onClick={() => onSelectModel(reference.id)}>
                  <span className="truncate">{formatMappedModel(mapping, preview)}</span>
                </Button>
              ) : (
                <Input
                  aria-label={`${formatSourceModel(reference)}目标模型`}
                  disabled={localDefault}
                  value={mapping?.targetModelName ?? ""}
                  onChange={(event) => onUpdateModel({ sourceRefId: reference.id, action: "map", targetModelName: event.target.value })}
                />
              )}
              <Button
                type="button"
                variant={localDefault ? "secondary" : "outline"}
                onClick={() => onUpdateModel(localDefault
                  ? blankModelMapping(reference)
                  : { sourceRefId: reference.id, action: "local-default" })}
              >
                本地默认
              </Button>
            </div>
          </div>
        )
      })}
    </div>
  )
}

function ProjectStep({ preview, selections, onUpdateProject }: StepProps) {
  return (
    <div className="divide-y rounded-lg border">
      {preview.mappings.projects.map((reference) => {
        const mapping = selections.projects.find((item) => item.sourceRefId === reference.id)
        return (
          <div key={reference.id} className="grid gap-3 px-4 py-4 md:grid-cols-[minmax(0,1fr)_minmax(0,1fr)] md:items-center">
            <div className="min-w-0">
              <div className="truncate font-medium">{reference.sourceProjectName ?? reference.id}</div>
              <div className="text-xs text-muted-foreground">用于 {formatOccurrenceNames(reference.occurrences)}</div>
            </div>
            <Select value={mapping?.targetProjectId ?? ""} onValueChange={(targetProjectId) => onUpdateProject({ sourceRefId: reference.id, targetProjectId })}>
              <SelectTrigger className="w-full"><SelectValue placeholder="选择本地项目" /></SelectTrigger>
              <SelectContent>
                {preview.projectOptions.map((project) => <SelectItem key={project.id} value={project.id}>{project.name}</SelectItem>)}
              </SelectContent>
            </Select>
          </div>
        )
      })}
    </div>
  )
}

function ExternalStep({ preview, selections, onUpdateResource, onUpdateEnvironment }: StepProps) {
  const { chooseResource } = useWorkflowResourcePicker()

  async function selectResource(reference: WorkflowShareImportPreview["mappings"]["resources"][number]) {
    try {
      const selectedPath = await chooseResource(reference.entryType)
      if (selectedPath) {
        onUpdateResource({ sourceRefId: reference.id, target: { kind: "local_path", path: selectedPath } })
      }
    } catch (error) {
      logger.warn("Workflow share resource selection failed.", {
        boundary: "renderer.workflow.share-import.resource-picker",
        resourceRefId: reference.id,
        errorName: error instanceof Error ? error.name : typeof error,
      })
      toast.error("选择文件失败，请重试")
    }
  }

  return (
    <div className="space-y-5">
      {preview.mappings.resources.length > 0 ? (
        <div className="space-y-2">
          <Label>文件与目录</Label>
          <Alert><AlertDescription>分享包不附带这些文件。请填入接收方机器上的对应路径。</AlertDescription></Alert>
          <div className="divide-y rounded-lg border">
            {preview.mappings.resources.map((reference) => {
              const mapping = selections.resources.find((item) => item.sourceRefId === reference.id)
              return (
                <div key={reference.id} className="grid gap-3 px-4 py-4 md:grid-cols-[minmax(0,1fr)_minmax(0,1fr)] md:items-center">
                  <div className="min-w-0">
                    <div className="truncate font-medium">{reference.displayName ?? reference.sourceIdentity ?? reference.id}</div>
                    <div className="text-xs text-muted-foreground">{reference.entryType === "file" ? "文件" : "目录"} · {formatOccurrenceNames(reference.occurrences)}</div>
                  </div>
                  <div className="flex min-w-0 gap-2">
                    <Input
                      aria-label={`${reference.displayName ?? reference.id}本地路径`}
                      disabled={mapping?.target.kind === "drive"}
                      value={mapping?.target.kind === "drive"
                        ? `沿用 Drive：${reference.displayName ?? mapping.target.id}`
                        : mapping?.target.path ?? ""}
                      onChange={(event) => onUpdateResource({ sourceRefId: reference.id, target: { kind: "local_path", path: event.target.value } })}
                      placeholder="本地路径"
                    />
                    <Button
                      type="button"
                      variant="outline"
                      onClick={() => { void selectResource(reference) }}
                    >
                      选择本地
                    </Button>
                  </div>
                </div>
              )
            })}
          </div>
        </div>
      ) : null}
      {preview.mappings.environments.length > 0 ? (
        <div className="space-y-2">
          <Label>运行环境</Label>
          <div className="divide-y rounded-lg border">
            {preview.mappings.environments.map((reference) => {
              const mapping = selections.environments.find((item) => item.sourceRefId === reference.id)
              return (
                <div key={reference.id} className="grid gap-3 px-4 py-4 md:grid-cols-[minmax(0,1fr)_160px_minmax(0,1fr)] md:items-center">
                  <div className="min-w-0">
                    <div className="truncate font-medium">{reference.kind}</div>
                    <div className="text-xs text-muted-foreground">{formatOccurrenceNames(reference.occurrences)}</div>
                  </div>
                  <Select value={mapping?.action ?? "reuse"} onValueChange={(action: WorkflowShareEnvironmentMapping["action"]) => onUpdateEnvironment({ sourceRefId: reference.id, action, ...(action === "replace" ? { targetValue: mapping?.targetValue ?? "" } : {}) })}>
                    <SelectTrigger><SelectValue /></SelectTrigger>
                    <SelectContent>
                      <SelectItem value="reuse">保留原值</SelectItem>
                      <SelectItem value="replace">替换</SelectItem>
                      <SelectItem value="local-default">本地默认</SelectItem>
                    </SelectContent>
                  </Select>
                  <Input
                    aria-label={`${reference.kind}替换值`}
                    disabled={mapping?.action !== "replace"}
                    value={mapping?.targetValue ?? ""}
                    onChange={(event) => onUpdateEnvironment({ sourceRefId: reference.id, action: "replace", targetValue: event.target.value })}
                  />
                </div>
              )
            })}
          </div>
        </div>
      ) : null}
    </div>
  )
}

function ConfirmStep({ preview, missing }: { readonly preview: WorkflowShareImportPreview; readonly missing: string[] }) {
  const mappingCount = preview.mappings.models.length
    + preview.mappings.projects.length
    + preview.mappings.resources.length
    + preview.mappings.environments.length
  return (
    <div className="space-y-4">
      <div className="grid grid-cols-2 gap-x-6 gap-y-3 rounded-lg border px-4 py-4 text-sm md:grid-cols-3">
        <SummaryValue label="新建" value={preview.summary.createCount} />
        <SummaryValue label="更新" value={preview.summary.updateCount} />
        <SummaryValue label="删除" value={preview.summary.deleteCount} />
        <SummaryValue label="解除分享关联" value={preview.summary.detachCount} />
        <SummaryValue label="依赖映射" value={mappingCount} />
        <SummaryValue label="停用 Automation" value={preview.compatibility.automationUpdates.length} />
      </div>
      <div className="divide-y rounded-lg border px-4 text-sm">
        {preview.content.workflows.map((workflow) => (
          <div key={`${workflow.ref}-${workflow.action}`} className="flex items-center justify-between gap-3 py-2">
            <span className="truncate">{workflow.name}</span>
            <span className="shrink-0 text-muted-foreground">{formatImportAction(workflow.action)}</span>
          </div>
        ))}
      </div>
      {missing.length > 0 ? (
        <Alert variant="destructive"><AlertDescription>还需完成：{missing.join("、")}</AlertDescription></Alert>
      ) : null}
      {!preview.compatibility.supported ? (
        <Alert variant="destructive"><AlertDescription>{preview.compatibility.issues.join("；")}</AlertDescription></Alert>
      ) : null}
      {missing.length === 0 && preview.compatibility.supported ? (
        <Alert><AlertDescription>
          {preview.mode === "duplicate"
            ? "该版本已导入，不会重复修改。"
            : `${preview.summary.preserveRunHistory ? "运行历史保留；" : ""}${preview.summary.transactionalBackup ? "导入失败会自动恢复，完成后可撤销本次操作。" : ""}`}
        </AlertDescription></Alert>
      ) : null}
    </div>
  )
}

function formatImportAction(action: WorkflowShareImportPreview["content"]["workflows"][number]["action"]): string {
  if (action === "create") return "新建"
  if (action === "update") return "更新"
  if (action === "delete") return "删除"
  if (action === "detach") return "保留并解除关联"
  return "保持不变"
}

function SummaryValue({ label, value }: { readonly label: string; readonly value: string | number }) {
  return <div><div className="text-muted-foreground">{label}</div><div className="mt-1 font-medium">{value}</div></div>
}

function emptySelections(): WorkflowShareImportSelections {
  return { models: [], projects: [], resources: [], environments: [] }
}

function buildInitialSelections(preview: WorkflowShareImportPreview): WorkflowShareImportSelections {
  const modelSuggestions = new Map(preview.suggestions.models.map((mapping) => [mapping.sourceRefId, mapping]))
  const projectSuggestions = new Map(preview.suggestions.projects.map((mapping) => [mapping.sourceRefId, mapping]))
  return {
    models: preview.mappings.models.flatMap((reference) => {
      const suggested = modelSuggestions.get(reference.id)
      return suggested ? [suggested] : []
    }),
    projects: preview.mappings.projects.flatMap((reference) => {
      const suggested = projectSuggestions.get(reference.id)
      return suggested ? [suggested] : []
    }),
    resources: preview.suggestions.resources,
    environments: preview.mappings.environments.map((reference) => preview.suggestions.environments.find((mapping) => mapping.sourceRefId === reference.id) ?? {
      sourceRefId: reference.id,
      action: "reuse",
    }),
  }
}

function blankModelMapping(
  reference: WorkflowShareImportPreview["mappings"]["models"][number],
): WorkflowShareModelMapping {
  return reference.environment === "synapse"
    ? { sourceRefId: reference.id, action: "map" }
    : { sourceRefId: reference.id, action: "map", targetModelName: "" }
}

function findMissingMappings(preview: WorkflowShareImportPreview, selections: WorkflowShareImportSelections): string[] {
  if (preview.mode === "duplicate") return []
  const missing: string[] = []
  const models = new Map(selections.models.map((mapping) => [mapping.sourceRefId, mapping]))
  if (preview.mappings.models.some((reference) => {
    const mapping = models.get(reference.id)
    if (!mapping) return true
    if (mapping.action === "local-default") return false
    return reference.environment === "synapse"
      ? !mapping.targetProviderId || !mapping.targetModelTier
      : !mapping.targetModelName?.trim()
  })) missing.push("模型映射")
  const projects = new Map(selections.projects.map((mapping) => [mapping.sourceRefId, mapping]))
  if (preview.mappings.projects.some((reference) => !projects.get(reference.id)?.targetProjectId)) missing.push("项目映射")
  const resources = new Map(selections.resources.map((mapping) => [mapping.sourceRefId, mapping]))
  if (preview.mappings.resources.some((reference) => {
    const mapping = resources.get(reference.id)
    return !mapping || (mapping.target.kind === "local_path" ? !mapping.target.path.trim() : !mapping.target.id.trim())
  })) missing.push("文件与目录")
  const environments = new Map(selections.environments.map((mapping) => [mapping.sourceRefId, mapping]))
  if (preview.mappings.environments.some((reference) => {
    const mapping = environments.get(reference.id)
    return !mapping || (mapping.action === "replace" && !mapping.targetValue?.trim())
  })) missing.push("运行环境")
  return missing
}

function nextRelevantStep(preview: WorkflowShareImportPreview, current: number, direction: 1 | -1): number {
  let next = current + direction
  while (next > 0 && next < STEPS.length - 1 && !stepHasContent(preview, next)) next += direction
  return Math.max(0, Math.min(STEPS.length - 1, next))
}

function stepHasContent(preview: WorkflowShareImportPreview, step: number): boolean {
  if (step === 2) return preview.mappings.models.length > 0
  if (step === 3) return preview.mappings.projects.length > 0
  if (step === 4) return preview.mappings.resources.length + preview.mappings.environments.length > 0
  return true
}

function replaceMapping<T extends { readonly sourceRefId: string }>(items: readonly T[], next: T): T[] {
  return [...items.filter((item) => item.sourceRefId !== next.sourceRefId), next]
}

function updateModelMappingFromSelection(
  sourceRefId: string,
  selection: ProviderModelSelection,
  update: (mapping: WorkflowShareModelMapping) => void,
) {
  update({ sourceRefId, action: "map", targetProviderId: selection.providerId, targetModelTier: selection.modelTier })
}

function formatWorkflowAction(action: WorkflowShareImportPreview["content"]["workflows"][number]["action"]): string {
  return { create: "新建", update: "更新", keep: "保留", detach: "分离保留", delete: "删除" }[action]
}

function formatSourceModel(reference: WorkflowShareImportPreview["mappings"]["models"][number]): string {
  const environment = { synapse: "Synapse", codex: "Codex", "claude-code": "Claude Code" }[reference.environment]
  return `${environment} · ${reference.sourceProviderName ?? reference.sourceProviderId ?? reference.sourceModelName ?? "默认模型"} / ${reference.sourceModelName ?? reference.sourceModelTier ?? "默认"}`
}

function formatOccurrenceNames(occurrences: WorkflowShareImportPreview["mappings"]["models"][number]["occurrences"]): string {
  return Array.from(new Set(occurrences.map((occurrence) => occurrence.nodeName ?? "工作流默认值"))).join("、")
}

function formatMappedModel(mapping: WorkflowShareModelMapping | undefined, preview: WorkflowShareImportPreview): string {
  if (!mapping || mapping.action === "local-default") return "选择供应商和模型"
  const provider = preview.providerOptions.find((item) => item.providerId === mapping.targetProviderId)
  if (!provider || !mapping.targetModelTier) return "选择供应商和模型"
  const modelName = resolveModelDisplayName({
    id: provider.providerId,
    model: provider.models.default,
    haikuModel: provider.models.haiku,
    sonnetModel: provider.models.sonnet,
    opusModel: provider.models.opus,
  }, mapping.targetModelTier) ?? mapping.targetModelTier
  return `${provider.providerName} / ${modelName}`
}

export { WorkflowShareImportDialog }
export type { WorkflowShareImportDialogProps }
