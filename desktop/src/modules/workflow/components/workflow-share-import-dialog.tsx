import { useEffect, useMemo, useRef, useState, type ReactNode } from "react"
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert"
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
import {
  InputGroup,
  InputGroupAddon,
  InputGroupButton,
  InputGroupInput,
} from "@/components/ui/input-group"
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select"
import { ScrollArea } from "@/components/ui/scroll-area"
import { ProviderModelSelectDialog } from "@/components/provider-model-select-dialog"
import { resolveModelDisplayName } from "@/lib/provider-model"
import { createRendererLogger } from "@/app-shell/logging"
import { FolderOpenIcon } from "lucide-react"
import { toast } from "sonner"
import { useWorkflowResourcePicker } from "../hooks/use-workflow-resource-picker"
import type { ModelTier, ProviderModelSelection } from "@/types/provider-model"
import type {
  WorkflowShareEnvironmentMapping,
  WorkflowShareFieldLocation,
  WorkflowShareImportPreview,
  WorkflowShareImportSelections,
  WorkflowShareModelMapping,
  WorkflowShareOccurrence,
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
  const bodyRef = useRef<HTMLDivElement>(null)

  useEffect(() => {
    setStep(0)
    setSelectingModelRefId(null)
    setSelections(preview ? buildInitialSelections(preview) : emptySelections())
  }, [preview])

  useEffect(() => {
    if (bodyRef.current) bodyRef.current.scrollTop = 0
  }, [preview, step])

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
        className="max-h-[calc(100vh-2rem)] p-0 sm:max-w-[800px]"
        showCloseButton={false}
        onEscapeKeyDown={(event) => { if (importing) event.preventDefault() }}
        onInteractOutside={(event) => { if (importing) event.preventDefault() }}
      >
        <DialogFrame className="h-auto max-h-[calc(100vh-2rem)]">
          <DialogFrameHeader
            bordered
            title="导入工作流"
            showCloseButton={!importing}
            center={(
              <span aria-live="polite" className="text-sm font-medium tabular-nums">
                {step + 1} / {STEPS.length} · {STEPS[step]}
              </span>
            )}
          />
          <DialogFrameBody
            className="max-h-[min(30rem,calc(100vh-10rem))] overflow-hidden"
          >
            <ScrollArea className="h-full" viewportClassName="overscroll-contain" viewportRef={bodyRef}>
              <div className="mx-auto max-w-3xl px-5 py-4">
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
  const nodeCount = preview.content.workflows.reduce((sum, workflow) => sum + workflow.nodeCount, 0)
  return (
    <div className="space-y-4">
      <MetaStrip items={[
        { label: "导入方式", value: formatImportMode(preview.mode) },
        { label: "工作流", value: preview.content.workflows.length },
        { label: "节点", value: nodeCount },
      ]} />
      {preview.shareNote ? (
        <StepSection title="分享说明">
          <p className="text-pretty text-sm text-muted-foreground">{preview.shareNote}</p>
        </StepSection>
      ) : null}
      <StepSection title="工作流" count={preview.content.workflows.length}>
        <WorkflowPlanList preview={preview} showRole />
      </StepSection>
    </div>
  )
}

function RiskStep({ preview }: { readonly preview: WorkflowShareImportPreview }) {
  const riskGroups: Array<{ readonly title: string; readonly items: readonly WorkflowShareFieldLocation[] }> = [
    { title: "敏感信息", items: preview.compatibility.sensitiveLocations },
    { title: "高风险配置", items: preview.compatibility.highRiskLocations },
    { title: "兼容提醒", items: preview.compatibility.portabilityWarnings },
  ].filter((group) => group.items.length > 0)
  const riskCount = riskGroups.reduce((sum, group) => sum + group.items.length, 0)
  const impactCount = preview.compatibility.excludedAutomationCount
    + preview.compatibility.automationUpdates.length
    + preview.summary.incompatiblePresetCount
  const hasDetails = riskCount > 0
    || preview.compatibility.requiredCapabilities.length > 0
    || impactCount > 0
    || !preview.compatibility.supported

  return (
    <div className="space-y-4">
      <MetaStrip items={[
        { label: "格式", value: preview.formatVersion },
        { label: "必需能力", value: preview.compatibility.requiredCapabilities.length },
        { label: "风险项", value: riskCount },
      ]} />
      {!preview.sourceVerified ? (
        <Alert>
          <AlertTitle>来源未验证</AlertTitle>
          <AlertDescription>文件完整性已校验，但无法验证分享者身份。只导入可信来源的工作流。</AlertDescription>
        </Alert>
      ) : null}
      {!preview.compatibility.supported ? (
        <Alert variant="destructive">
          <AlertTitle>当前环境无法导入</AlertTitle>
          <AlertDescription>{preview.compatibility.issues.join("；")}</AlertDescription>
        </Alert>
      ) : null}
      {riskGroups.map((group) => (
        <StepSection key={group.title} title={group.title} count={group.items.length}>
          <StepList>
            {group.items.map((location, index) => (
              <RiskLocationRow
                key={`${group.title}-${location.workflowRef}-${location.nodeId ?? "workflow"}-${index}`}
                location={location}
                preview={preview}
              />
            ))}
          </StepList>
        </StepSection>
      ))}
      {preview.compatibility.requiredCapabilities.length > 0 ? (
        <StepSection title="必需能力" count={preview.compatibility.requiredCapabilities.length}>
          <StepList>
            {preview.compatibility.requiredCapabilities.map((capability) => (
              <div key={`${capability.id}-${capability.minVersion}`} className="flex items-start justify-between gap-4 px-4 py-2.5">
                <span className="min-w-0 break-all font-medium">{capability.id}</span>
                <span className="shrink-0 text-xs text-muted-foreground">最低 {capability.minVersion}</span>
              </div>
            ))}
          </StepList>
        </StepSection>
      ) : null}
      {impactCount > 0 ? (
        <StepSection title="导入影响" count={impactCount}>
          <StepList>
            {preview.compatibility.excludedAutomationCount > 0 ? (
              <ImpactRow
                label={`${preview.compatibility.excludedAutomationCount} 个关联 Automation`}
                description="不包含在分享包中，导入后需要单独配置。"
              />
            ) : null}
            {preview.compatibility.automationUpdates.map((item) => (
              <ImpactRow key={item.id} label={item.name} description={`${item.reason}。将停用，配置和运行历史保留。`} />
            ))}
            {preview.summary.incompatiblePresetCount > 0 ? (
              <ImpactRow
                label={`${preview.summary.incompatiblePresetCount} 个参数预设`}
                description="与新参数不兼容，将保留且不会自动修改。"
              />
            ) : null}
          </StepList>
        </StepSection>
      ) : null}
      {!hasDetails ? (
        <div className="rounded-lg bg-muted/50 px-3 py-2 text-sm text-muted-foreground">未发现需要额外确认的配置。</div>
      ) : null}
    </div>
  )
}

function ModelStep({ preview, selections, onSelectModel, onUpdateModel }: StepProps) {
  return (
    <MappingList sourceLabel="发送方模型" targetLabel="导入后使用">
      {preview.mappings.models.map((reference) => {
        const mapping = selections.models.find((item) => item.sourceRefId === reference.id)
        const localDefault = mapping?.action === "local-default"
        return (
          <div key={reference.id} className="grid gap-3 px-4 py-3 md:grid-cols-[minmax(0,1fr)_minmax(0,1fr)] md:items-center">
            <div className="min-w-0">
              <div className="truncate font-medium">{formatSourceModelName(reference)}</div>
              <div className="text-pretty text-xs text-muted-foreground">
                {formatSourceModelContext(reference)} · 用于 {formatOccurrenceNames(reference.occurrences)}
              </div>
            </div>
            <div className="flex min-w-0 gap-2">
              {reference.environment === "synapse" ? (
                <Button type="button" variant="outline" className="min-w-0 flex-1 justify-start" disabled={localDefault} onClick={() => onSelectModel(reference.id)}>
                  <span className="truncate">{formatMappedModel(mapping, preview)}</span>
                </Button>
              ) : (
                <Input
                  aria-label={`${formatSourceModel(reference)}目标模型`}
                  className="min-w-0"
                  disabled={localDefault}
                  value={mapping?.targetModelName ?? ""}
                  onChange={(event) => onUpdateModel({ sourceRefId: reference.id, action: "map", targetModelName: event.target.value })}
                  placeholder="输入目标模型"
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
    </MappingList>
  )
}

function ProjectStep({ preview, selections, onUpdateProject }: StepProps) {
  return (
    <div className="space-y-3">
      {preview.projectOptions.length === 0 ? (
        <Alert><AlertDescription>没有可用项目。请先添加项目后再导入。</AlertDescription></Alert>
      ) : null}
      <MappingList sourceLabel="发送方项目" targetLabel="本地项目">
        {preview.mappings.projects.map((reference) => {
          const mapping = selections.projects.find((item) => item.sourceRefId === reference.id)
          return (
            <div key={reference.id} className="grid gap-3 px-4 py-3 md:grid-cols-[minmax(0,1fr)_minmax(0,1fr)] md:items-center">
              <div className="min-w-0">
                <div className="truncate font-medium">{reference.sourceProjectName ?? reference.id}</div>
                <div className="text-pretty text-xs text-muted-foreground">
                  {reference.sourceProjectType ? `${reference.sourceProjectType} · ` : ""}用于 {formatOccurrenceNames(reference.occurrences)}
                </div>
              </div>
              <Select
                disabled={preview.projectOptions.length === 0}
                value={mapping?.targetProjectId ?? ""}
                onValueChange={(targetProjectId) => onUpdateProject({ sourceRefId: reference.id, targetProjectId })}
              >
                <SelectTrigger className="w-full"><SelectValue placeholder="选择本地项目" /></SelectTrigger>
                <SelectContent>
                  {preview.projectOptions.map((project) => <SelectItem key={project.id} value={project.id}>{project.name}</SelectItem>)}
                </SelectContent>
              </Select>
            </div>
          )
        })}
      </MappingList>
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
    <div className="space-y-4">
      {preview.mappings.resources.length > 0 ? (
        <StepSection
          title="文件与目录"
          count={preview.mappings.resources.length}
          description="分享包不附带这些文件，请选择当前机器上的对应资源。"
        >
          <MappingList sourceLabel="发送方资源" targetLabel="本地资源">
            {preview.mappings.resources.map((reference) => {
              const mapping = selections.resources.find((item) => item.sourceRefId === reference.id)
              return (
                <div key={reference.id} className="grid gap-3 px-4 py-3 md:grid-cols-[minmax(0,1fr)_minmax(0,1fr)] md:items-center">
                  <div className="min-w-0">
                    <div className="truncate font-medium">{reference.displayName ?? reference.sourceIdentity ?? reference.id}</div>
                    <div className="text-pretty text-xs text-muted-foreground">
                      {formatResourceMetadata(reference)} · 用于 {formatOccurrenceNames(reference.occurrences)}
                    </div>
                  </div>
                  <InputGroup>
                    <InputGroupInput
                      aria-label={`${reference.displayName ?? reference.id}本地路径`}
                      readOnly={mapping?.target.kind === "drive"}
                      value={mapping?.target.kind === "drive"
                        ? `沿用 Drive：${reference.displayName ?? mapping.target.id}`
                        : mapping?.target.path ?? ""}
                      onChange={(event) => onUpdateResource({ sourceRefId: reference.id, target: { kind: "local_path", path: event.target.value } })}
                      placeholder="本地路径"
                    />
                    <InputGroupAddon align="inline-end">
                      <InputGroupButton onClick={() => { void selectResource(reference) }}>
                        <FolderOpenIcon />
                        选择
                      </InputGroupButton>
                    </InputGroupAddon>
                  </InputGroup>
                </div>
              )
            })}
          </MappingList>
        </StepSection>
      ) : null}
      {preview.mappings.environments.length > 0 ? (
        <StepSection title="运行环境" count={preview.mappings.environments.length}>
          <MappingList sourceLabel="发送方环境" targetLabel="导入后使用">
            {preview.mappings.environments.map((reference) => {
              const mapping = selections.environments.find((item) => item.sourceRefId === reference.id)
              return (
                <div key={reference.id} className="grid gap-3 px-4 py-3 md:grid-cols-[minmax(0,1fr)_minmax(0,1fr)] md:items-center">
                  <div className="min-w-0">
                    <div className="truncate font-medium">{reference.kind}</div>
                    <div className="text-pretty text-xs text-muted-foreground">用于 {formatOccurrenceNames(reference.occurrences)}</div>
                  </div>
                  <div className={mapping?.action === "replace" ? "grid min-w-0 gap-2 sm:grid-cols-[10rem_minmax(0,1fr)]" : "min-w-0"}>
                    <Select value={mapping?.action ?? "reuse"} onValueChange={(action: WorkflowShareEnvironmentMapping["action"]) => onUpdateEnvironment({ sourceRefId: reference.id, action, ...(action === "replace" ? { targetValue: mapping?.targetValue ?? "" } : {}) })}>
                      <SelectTrigger className="w-full"><SelectValue /></SelectTrigger>
                      <SelectContent>
                        <SelectItem value="reuse">保留原值</SelectItem>
                        <SelectItem value="replace">替换</SelectItem>
                        <SelectItem value="local-default">本地默认</SelectItem>
                      </SelectContent>
                    </Select>
                    {mapping?.action === "replace" ? (
                      <Input
                        aria-label={`${reference.kind}替换值`}
                        value={mapping.targetValue ?? ""}
                        onChange={(event) => onUpdateEnvironment({ sourceRefId: reference.id, action: "replace", targetValue: event.target.value })}
                        placeholder="替换值"
                      />
                    ) : null}
                  </div>
                </div>
              )
            })}
          </MappingList>
        </StepSection>
      ) : null}
    </div>
  )
}

function ConfirmStep({ preview, missing }: { readonly preview: WorkflowShareImportPreview; readonly missing: string[] }) {
  const changes = [
    { label: "新建", value: preview.summary.createCount },
    { label: "更新", value: preview.summary.updateCount },
    { label: "删除", value: preview.summary.deleteCount },
    { label: "解除关联", value: preview.summary.detachCount },
    { label: "停用 Automation", value: preview.compatibility.automationUpdates.length },
  ].filter((item) => item.value > 0)
  const dependencies = [
    { label: "模型", value: preview.mappings.models.length },
    { label: "项目", value: preview.mappings.projects.length },
    { label: "文件与目录", value: preview.mappings.resources.length },
    { label: "运行环境", value: preview.mappings.environments.length },
  ].filter((item) => item.value > 0)
  const safeguards = [
    preview.summary.preserveRunHistory ? "保留运行历史" : null,
    preview.summary.transactionalBackup ? "导入失败时自动恢复" : null,
    preview.summary.undoAvailable ? "完成后可撤销本次导入" : null,
    preview.summary.incompatiblePresetCount > 0
      ? `${preview.summary.incompatiblePresetCount} 个不兼容参数预设将保留`
      : null,
  ].filter((item): item is string => Boolean(item))

  return (
    <div className="space-y-4">
      {missing.length > 0 ? (
        <Alert variant="destructive">
          <AlertTitle>映射尚未完成</AlertTitle>
          <AlertDescription>还需完成：{missing.join("、")}</AlertDescription>
        </Alert>
      ) : null}
      {!preview.compatibility.supported ? (
        <Alert variant="destructive">
          <AlertTitle>当前环境无法导入</AlertTitle>
          <AlertDescription>{preview.compatibility.issues.join("；")}</AlertDescription>
        </Alert>
      ) : null}
      {preview.mode === "duplicate" ? (
        <Alert><AlertDescription>
          该版本已导入，不会重复修改。
        </AlertDescription></Alert>
      ) : null}
      {changes.length > 0 ? (
        <StepSection title="变更摘要">
          <MetaStrip items={changes} />
        </StepSection>
      ) : null}
      <StepSection title="工作流" count={preview.content.workflows.length}>
        <WorkflowPlanList preview={preview} />
      </StepSection>
      {dependencies.length > 0 ? (
        <StepSection title="依赖映射">
          <MetaStrip items={dependencies} />
        </StepSection>
      ) : null}
      {safeguards.length > 0 ? (
        <StepSection title="导入保障" count={safeguards.length}>
          <StepList>
            {safeguards.map((item) => <div key={item} className="px-4 py-2.5 text-sm">{item}</div>)}
          </StepList>
        </StepSection>
      ) : null}
    </div>
  )
}

function StepSection({
  children,
  count,
  description,
  title,
}: {
  readonly children: ReactNode
  readonly count?: number
  readonly description?: string
  readonly title: string
}) {
  return (
    <section className="space-y-2">
      <div className="flex items-baseline gap-2">
        <h3 className="text-balance text-sm font-medium">{title}</h3>
        {count !== undefined ? <span className="text-xs text-muted-foreground tabular-nums">{count}</span> : null}
      </div>
      {description ? <p className="text-pretty text-xs text-muted-foreground">{description}</p> : null}
      {children}
    </section>
  )
}

function StepList({ children }: { readonly children: ReactNode }) {
  return <div className="divide-y rounded-lg border">{children}</div>
}

function MappingList({
  children,
  sourceLabel,
  targetLabel,
}: {
  readonly children: ReactNode
  readonly sourceLabel: string
  readonly targetLabel: string
}) {
  return (
    <StepList>
      <div className="hidden grid-cols-[minmax(0,1fr)_minmax(0,1fr)] gap-3 bg-muted/50 px-4 py-2 text-xs font-medium text-muted-foreground md:grid">
        <span>{sourceLabel}</span>
        <span>{targetLabel}</span>
      </div>
      {children}
    </StepList>
  )
}

function MetaStrip({ items }: { readonly items: ReadonlyArray<{ readonly label: string; readonly value: ReactNode }> }) {
  return (
    <dl className="flex flex-wrap gap-x-5 gap-y-2 rounded-lg bg-muted/50 px-3 py-2 text-sm">
      {items.map((item) => (
        <div key={item.label} className="flex items-baseline gap-1.5">
          <dt className="text-muted-foreground">{item.label}</dt>
          <dd className="font-medium tabular-nums">{item.value}</dd>
        </div>
      ))}
    </dl>
  )
}

function WorkflowPlanList({ preview, showRole = false }: { readonly preview: WorkflowShareImportPreview; readonly showRole?: boolean }) {
  const entrypoints = new Set(preview.content.entrypoints)
  return (
    <StepList>
      {preview.content.workflows.map((workflow) => (
        <div key={workflow.ref} className="grid grid-cols-[minmax(0,1fr)_auto] items-center gap-3 px-4 py-2.5">
          <div className="flex min-w-0 items-center gap-2">
            <span className="truncate font-medium">{workflow.name}</span>
            {showRole ? <Badge variant="secondary">{entrypoints.has(workflow.ref) ? "入口" : "依赖"}</Badge> : null}
          </div>
          <div className="flex flex-col items-end gap-1">
            <Badge variant="outline">{formatImportAction(workflow.action)}</Badge>
            <span className="text-xs text-muted-foreground tabular-nums">{workflow.nodeCount} 个节点</span>
          </div>
        </div>
      ))}
    </StepList>
  )
}

function RiskLocationRow({
  location,
  preview,
}: {
  readonly location: WorkflowShareFieldLocation
  readonly preview: WorkflowShareImportPreview
}) {
  const workflowName = preview.content.workflows.find((workflow) => workflow.ref === location.workflowRef)?.name
  const message = "message" in location && typeof location.message === "string" ? location.message : undefined
  return (
    <div className="px-4 py-2.5">
      <div className="font-medium">{location.nodeName ?? workflowName ?? "工作流设置"}</div>
      {location.nodeName && workflowName ? <div className="text-xs text-muted-foreground">{workflowName}</div> : null}
      {message ? <div className="text-pretty text-xs text-muted-foreground">{message}</div> : null}
      {location.fieldPath.length > 0 ? (
        <div className="break-all text-xs text-muted-foreground">{location.fieldPath.join(".")}</div>
      ) : null}
    </div>
  )
}

function ImpactRow({ label, description }: { readonly label: string; readonly description: string }) {
  return (
    <div className="px-4 py-2.5">
      <div className="font-medium">{label}</div>
      <div className="text-pretty text-xs text-muted-foreground">{description}</div>
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

function formatImportMode(mode: WorkflowShareImportPreview["mode"]): string {
  if (mode === "update") return "更新"
  if (mode === "duplicate") return "重复导入"
  return "新建"
}

function formatSourceModelName(reference: WorkflowShareImportPreview["mappings"]["models"][number]): string {
  if (reference.sourceModelName) return reference.sourceModelName
  if (reference.sourceModelTier === "haiku") return "Haiku"
  if (reference.sourceModelTier === "sonnet") return "Sonnet"
  if (reference.sourceModelTier === "opus") return "Opus"
  return "默认模型"
}

function formatSourceModelContext(reference: WorkflowShareImportPreview["mappings"]["models"][number]): string {
  const environment = { synapse: "Synapse", codex: "Codex", "claude-code": "Claude Code" }[reference.environment]
  const provider = reference.sourceProviderName ?? reference.sourceProviderId
  return provider ? `${environment} · ${provider}` : environment
}

function formatSourceModel(reference: WorkflowShareImportPreview["mappings"]["models"][number]): string {
  return `${formatSourceModelContext(reference)} · ${formatSourceModelName(reference)}`
}

function formatOccurrenceNames(occurrences: readonly WorkflowShareOccurrence[]): string {
  const names = Array.from(new Set(occurrences.map((occurrence) => occurrence.nodeName ?? "工作流默认值")))
  return names.length > 0 ? names.join("、") : "工作流默认值"
}

function formatResourceMetadata(reference: WorkflowShareImportPreview["mappings"]["resources"][number]): string {
  const kind = {
    local_path: "本地资源",
    drive: "Drive",
    staged: "临时资源",
    inline_file: "内嵌文件",
  }[reference.kind]
  const entryType = reference.entryType === "file" ? "文件" : "目录"
  const access = { read: "读取", write: "写入", "read-write": "读写" }[reference.access]
  return [kind, entryType, access, reference.cardinality === "many" ? "多个" : null].filter(Boolean).join(" · ")
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
