import { useRef, useState } from "react"
import { Input } from "@/components/ui/input"
import { Button } from "@/components/ui/button"
import { Checkbox } from "@/components/ui/checkbox"
import { Label } from "@/components/ui/label"
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select"
import { AlertTriangle, ChevronDown, FileText, Plus, Trash2 } from "lucide-react"
import { ProviderModelSelectDialog } from "@/components/provider-model-select-dialog"
import type { ModelTier } from "@/types/provider-model"
import type { SynapseProjectConfig } from "@/types/config"
import type { WorkflowParam } from "@/types/workflow"
import type { WorkflowValidationDisplayItem } from "@/modules/workflow/editor/validation-display"
import type { SwitchNodeConfig, SwitchBranch } from "./schema"
import { VariableBindingEditor } from "../variable-binding-editor"
import { PromptEditor } from "../prompt-editor"
import { CollapsibleSection } from "../collapsible-section"
import { useProviderLookup } from "../provider-lookup-context"
import { ProjectSelect } from "../project-select"
import { DEFAULT_AGENT_TIMEOUT_MINS } from "../agent-timeout"

const TIER_LABELS: Record<ModelTier, string> = { default: "主模型", haiku: "Haiku", sonnet: "Sonnet", opus: "Opus" }

const NO_DEFAULT = "__none__"
const BRANCH_ID_RE = /^[a-z][a-z0-9_]*$/

export interface SwitchNodePanelProps {
  config: SwitchNodeConfig
  onChange: (config: SwitchNodeConfig) => void
  upstreamNodes: { id: string; name: string }[]
  workflowParams: WorkflowParam[]
  projects: readonly SynapseProjectConfig[]
  defaultProjectName?: string
  defaultProviderId?: string
  defaultModelTier?: string
  defaultNodeTimeoutMins?: number
  validationItems?: readonly WorkflowValidationDisplayItem[]
}

export function SwitchNodePanel({ config, onChange, upstreamNodes, workflowParams, projects, defaultProjectName, defaultProviderId, defaultModelTier, defaultNodeTimeoutMins, validationItems = [] }: SwitchNodePanelProps) {
  const [prompt, setPrompt] = useState(config.prompt)
  const [branches, setBranches] = useState<SwitchBranch[]>(config.branches)
  const [defaultBranch, setDefaultBranch] = useState<string>(config.defaultBranch ?? NO_DEFAULT)
  const [providerDialogOpen, setProviderDialogOpen] = useState(false)
  const [customProviderEnabled, setCustomProviderEnabled] = useState(Boolean(config.providerId))
  const [customTimeoutEnabled, setCustomTimeoutEnabled] = useState(config.timeoutMins !== undefined)
  const lastCommittedRef = useRef<SwitchNodeConfig>(config)
  const { getProviderName, getModelName, getModelDisplayName, isProviderAvailable } = useProviderLookup()
  const providerUnavailable = Boolean(config.providerId && !isProviderAvailable(config.providerId))

  const commit = (overrides?: Partial<SwitchNodeConfig>) => {
    const next: SwitchNodeConfig = {
      ...lastCommittedRef.current, prompt, branches,
      defaultBranch: defaultBranch === NO_DEFAULT ? undefined : defaultBranch,
      ...overrides,
    }
    lastCommittedRef.current = next
    onChange(next)
  }

  const addBranch = () => {
    const existingIds = new Set(branches.map((b) => b.id))
    let counter = branches.length + 1
    while (existingIds.has(`branch${counter}`)) counter++
    const id = `branch${counter}`
    const next = [...branches, { id, label: `分支 ${counter}` }]
    setBranches(next)
    commit({ branches: next })
  }

  const removeBranch = (i: number) => {
    const next = branches.filter((_, j) => j !== i)
    const nextDefault = next.some((branch) => branch.id === defaultBranch) ? defaultBranch : NO_DEFAULT
    setBranches(next)
    setDefaultBranch(nextDefault)
    commit({ branches: next, defaultBranch: nextDefault === NO_DEFAULT ? undefined : nextDefault })
  }

  const updateBranchId = (i: number, id: string) => {
    const committedId = lastCommittedRef.current.branches[i]?.id ?? branches[i]?.id
    const next = branches.map((b, j) => (j === i ? { ...b, id } : b))
    setBranches(next)
    if (!canCommitBranchIds(next)) return
    const nextDefault = defaultBranch === committedId ? id : defaultBranch
    setDefaultBranch(nextDefault)
    commit({ branches: next, defaultBranch: nextDefault === NO_DEFAULT ? undefined : nextDefault })
  }

  const updateBranchLabel = (i: number, label: string) => {
    const next = branches.map((b, j) => (j === i ? { ...b, label } : b))
    setBranches(next)
    if (!canCommitBranchIds(next)) return
    commit({ branches: next })
  }

  const varSummary = config.variables.length > 0 ? `${config.variables.length}个` : undefined
  const promptSummary = prompt.length > 0 ? `${prompt.length}字` : undefined
  const branchSummary = `${branches.length}条`
  const errorFor = (fieldKey: string) => validationItems.find((item) => item.fieldKey === fieldKey)?.summary
  const inheritedProviderLabel = defaultProviderId
    ? `${getProviderName(defaultProviderId) ?? defaultProviderId} · ${getModelDisplayName(defaultProviderId, (defaultModelTier as ModelTier) ?? "default") ?? getModelName(defaultProviderId, (defaultModelTier as ModelTier) ?? "default") ?? TIER_LABELS[(defaultModelTier as ModelTier) ?? "default"]}`
    : undefined
  const inheritedTimeoutMins = defaultNodeTimeoutMins ?? DEFAULT_AGENT_TIMEOUT_MINS
  const nodeProviderLabel = config.providerId
    ? `${getProviderName(config.providerId) ?? config.providerId} · ${getModelDisplayName(config.providerId, config.modelTier ?? "default") ?? getModelName(config.providerId, config.modelTier ?? "default") ?? TIER_LABELS[config.modelTier ?? "default"]}`
    : "选择供应商 + 模型"
  const branchIdError = getBranchIdError(branches)
  const defaultBranchOptions = branches.filter((branch) => BRANCH_ID_RE.test(branch.id))
  const renderedDefaultBranch = defaultBranchOptions.some((branch) => branch.id === defaultBranch)
    ? defaultBranch
    : NO_DEFAULT
  const applyRoutePromptTemplate = () => {
    const nextPrompt = buildSwitchPromptTemplate(branches, defaultBranch === NO_DEFAULT ? undefined : defaultBranch)
    setPrompt(nextPrompt)
    commit({ prompt: nextPrompt })
  }

  return (
    <div className="grid gap-2">
      <CollapsibleSection title="执行配置">
        <div className="grid gap-2">
          <div className="flex items-center gap-2">
            <Checkbox
              id="switch-node-custom-provider"
              checked={customProviderEnabled}
              onCheckedChange={(checked) => {
                const enabled = checked === true
                setCustomProviderEnabled(enabled)
                if (!enabled) commit({ providerId: undefined, modelTier: undefined })
              }}
            />
            <Label htmlFor="switch-node-custom-provider" className="text-xs font-normal">单独设置供应商</Label>
          </div>
          {customProviderEnabled ? (
            <Button variant="outline" className={`w-full justify-between h-7 text-xs${providerUnavailable ? " border-destructive" : ""}`} onClick={() => setProviderDialogOpen(true)}>
              <span className="flex min-w-0 items-center gap-1 truncate">
                {providerUnavailable && <AlertTriangle className="size-3 shrink-0 text-destructive" />}
                {nodeProviderLabel}
              </span>
              <ChevronDown className="size-3.5 text-muted-foreground" />
            </Button>
          ) : (
            <p className="text-xs text-muted-foreground">
              {inheritedProviderLabel ? `使用工作流默认：${inheritedProviderLabel}` : "未设置工作流默认供应商"}
            </p>
          )}
          <div className="grid gap-1">
            <div className="flex items-center gap-2">
              <Checkbox
                id="switch-node-custom-timeout"
                checked={customTimeoutEnabled}
                onCheckedChange={(checked) => {
                  const enabled = checked === true
                  setCustomTimeoutEnabled(enabled)
                  commit({ timeoutMins: enabled ? (config.timeoutMins ?? inheritedTimeoutMins) : undefined })
                }}
              />
              <Label htmlFor="switch-node-custom-timeout" className="text-xs font-normal">单独设置超时</Label>
            </div>
            {customTimeoutEnabled ? (
              <Input
                id="switch-node-timeout"
                className="h-7 text-xs"
                type="number"
                min={1}
                value={config.timeoutMins ?? inheritedTimeoutMins}
                onChange={(e) => commit({ timeoutMins: e.target.value === "" ? undefined : Number(e.target.value) })}
              />
            ) : (
              <p className="text-xs text-muted-foreground">使用工作流默认：{inheritedTimeoutMins} 分钟</p>
            )}
          </div>
        </div>
        {customProviderEnabled && providerUnavailable && <p className="text-[11px] text-destructive">供应商不可用，请重新选择</p>}
        <ProviderModelSelectDialog
          open={providerDialogOpen}
          onOpenChange={setProviderDialogOpen}
          defaultSelection={config.providerId
            ? { providerId: config.providerId, modelTier: config.modelTier ?? "default" }
            : defaultProviderId
              ? { providerId: defaultProviderId, modelTier: (defaultModelTier as ModelTier) ?? "default" }
              : undefined}
          onSelect={(s) => commit({ providerId: s.providerId, modelTier: s.modelTier })}
        />
      </CollapsibleSection>

      <CollapsibleSection title="输入映射" summary={varSummary}>
        <VariableBindingEditor
          variables={config.variables}
          onChange={(variables) => commit({ variables })}
          upstreamNodes={upstreamNodes}
          workflowParams={workflowParams}
        />
      </CollapsibleSection>

      <CollapsibleSection title="项目">
        <ProjectSelect
          value={config.projectId}
          onChange={(projectId) => commit({ projectId })}
          projects={projects}
          placeholder={defaultProjectName ? `继承: ${defaultProjectName}` : "继承默认"}
        />
        {errorFor("projectId") && <p className="text-xs text-destructive">{errorFor("projectId")}</p>}
      </CollapsibleSection>

      <CollapsibleSection title="路由规则" summary={branchSummary}>
        <div className="grid gap-1.5">
          <div className="grid grid-cols-[minmax(0,1fr)_minmax(0,1fr)_1.75rem] items-center gap-1.5">
            <Label className="text-[11px] text-muted-foreground">路由键</Label>
            <Label className="text-[11px] text-muted-foreground">显示名</Label>
          </div>
          {branches.map((b, i) => (
            <div key={i} className="grid grid-cols-[minmax(0,1fr)_minmax(0,1fr)_1.75rem] items-center gap-1.5">
              <Input
                className="h-7 text-xs"
                value={b.id}
                aria-label={`路由键 ${b.label || b.id}`}
                onChange={(e) => updateBranchId(i, e.target.value)}
              />
              <Input
                className="h-7 text-xs"
                value={b.label}
                aria-label={`显示名 ${b.id}`}
                onChange={(e) => updateBranchLabel(i, e.target.value)}
              />
              <Button
                size="icon" variant="ghost" className="h-7 w-7 shrink-0"
                onClick={() => removeBranch(i)}
                disabled={branches.length <= 1}
                aria-label={`删除分支 ${b.label || b.id}`}
              >
                <Trash2 className="h-3 w-3" />
              </Button>
            </div>
          ))}
          {branchIdError && <p className="text-xs text-destructive">{branchIdError}</p>}
          <Button size="sm" variant="outline" className="h-7 text-xs" onClick={addBranch}>
            <Plus className="h-3 w-3 mr-1" />添加分支
          </Button>
          {errorFor("branches") && <p className="text-xs text-destructive">{errorFor("branches")}</p>}
          <div className="grid gap-1 mt-1">
            <span className="text-[11px] text-muted-foreground">默认分支</span>
            <Select
              value={renderedDefaultBranch}
              onValueChange={(v) => {
                setDefaultBranch(v)
                commit({ defaultBranch: v === NO_DEFAULT ? undefined : v })
              }}
            >
              <SelectTrigger className="h-7 text-xs">
                <SelectValue placeholder="无（匹配失败则失败）" />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value={NO_DEFAULT} className="text-xs">无（匹配失败则失败）</SelectItem>
                {defaultBranchOptions.map((b) => (
                  <SelectItem key={b.id} value={b.id} className="text-xs">{b.label}</SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
        </div>
      </CollapsibleSection>

      <CollapsibleSection title="判断指令" summary={promptSummary}>
        <div className="grid gap-2">
          <div className="flex justify-end">
            <Button type="button" size="sm" variant="outline" onClick={applyRoutePromptTemplate}>
              <FileText data-icon="inline-start" />
              套用路由模板
            </Button>
          </div>
          <PromptEditor
            value={prompt}
            onChange={setPrompt}
            onBlur={() => commit({ prompt })}
            variables={config.variables}
            placeholder="输入提示词…"
            rows={6}
          />
          {errorFor("prompt") && <p className="text-xs text-destructive">{errorFor("prompt")}</p>}
        </div>
      </CollapsibleSection>
    </div>
  )
}

function buildSwitchPromptTemplate(branches: readonly SwitchBranch[], defaultBranch?: string): string {
  const branchLines = branches.map((branch) => `- ${branch.id}：${branch.label || branch.id}`).join("\n")
  const branchIds = branches.map((branch) => branch.id).join("、")
  const fallbackLine = defaultBranch ? `默认分支：${defaultBranch}` : "没有默认分支时，也必须从可选分支中选择最匹配的一项。"

  return [
    "请根据输入内容选择一个路由分支。",
    "",
    "判断步骤：",
    "1. 先阅读输入内容，提取影响路由的关键信息。",
    "2. 再对照可选分支，选择最匹配的一项。",
    "3. 无法明确判断时，按默认分支处理。",
    "",
    "可选分支：",
    branchLines,
    "",
    fallbackLine,
    "",
    `输出要求：只输出路由键，不要输出解释。可选路由键：${branchIds}`,
  ].join("\n")
}

function canCommitBranchIds(branches: readonly SwitchBranch[]): boolean {
  return getBranchIdError(branches) === undefined
}

function getBranchIdError(branches: readonly SwitchBranch[]): string | undefined {
  const seen = new Set<string>()
  for (const branch of branches) {
    if (!BRANCH_ID_RE.test(branch.id)) return "路由键只能使用小写字母、数字、下划线，并以字母开头"
    if (seen.has(branch.id)) return "路由键不能重复"
    seen.add(branch.id)
  }
  return undefined
}
