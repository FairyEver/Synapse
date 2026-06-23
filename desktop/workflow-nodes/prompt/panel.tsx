import { useRef, useState } from "react"
import { AlertTriangle, ChevronDown } from "lucide-react"
import { Button } from "@/components/ui/button"
import { Checkbox } from "@/components/ui/checkbox"
import { Input } from "@/components/ui/input"
import { Label } from "@/components/ui/label"
import { ProviderModelSelectDialog } from "@/components/provider-model-select-dialog"
import type { ModelTier } from "@/types/provider-model"
import type { SynapseProjectConfig } from "@/types/config"
import type { WorkflowParam } from "@/types/workflow"
import type { WorkflowValidationDisplayItem } from "@/modules/workflow/editor/validation-display"
import type { PromptNodeConfig } from "./schema"
import { VariableBindingEditor } from "../variable-binding-editor"
import { PromptEditor } from "../prompt-editor"
import { CollapsibleSection } from "../collapsible-section"
import { useProviderLookup } from "../provider-lookup-context"
import { ProjectSelect } from "../project-select"
import { DEFAULT_AGENT_TIMEOUT_MINS } from "../agent-timeout"

const TIER_LABELS: Record<ModelTier, string> = { default: "主模型", haiku: "Haiku", sonnet: "Sonnet", opus: "Opus" }

export interface PromptNodePanelProps {
  config: PromptNodeConfig
  onChange: (config: PromptNodeConfig) => void
  upstreamNodes: { id: string; name: string }[]
  workflowParams: WorkflowParam[]
  projects: readonly SynapseProjectConfig[]
  defaultProjectName?: string
  defaultProviderId?: string
  defaultModelTier?: string
  defaultNodeTimeoutMins?: number
  validationItems?: readonly WorkflowValidationDisplayItem[]
}

export function PromptNodePanel({ config, onChange, upstreamNodes, workflowParams, projects, defaultProjectName, defaultProviderId, defaultModelTier, defaultNodeTimeoutMins, validationItems = [] }: PromptNodePanelProps) {
  const [prompt, setPrompt] = useState(config.prompt)
  const [providerDialogOpen, setProviderDialogOpen] = useState(false)
  const [customProviderEnabled, setCustomProviderEnabled] = useState(Boolean(config.providerId))
  const [customTimeoutEnabled, setCustomTimeoutEnabled] = useState(config.timeoutMins !== undefined)
  const lastCommittedRef = useRef<PromptNodeConfig>(config)
  const { getProviderName, getModelName, getModelDisplayName, isProviderAvailable } = useProviderLookup()
  const providerUnavailable = Boolean(config.providerId && !isProviderAvailable(config.providerId))

  const commit = (overrides?: Partial<PromptNodeConfig>) => {
    const next: PromptNodeConfig = { ...lastCommittedRef.current, prompt, ...overrides }
    lastCommittedRef.current = next
    onChange(next)
  }

  const varSummary = config.variables.length > 0 ? `${config.variables.length}个` : undefined
  const promptSummary = prompt.length > 0 ? `${prompt.length}字` : undefined
  const errorFor = (fieldKey: string) => validationItems.find((item) => item.fieldKey === fieldKey)?.summary
  const inheritedProviderLabel = defaultProviderId
    ? `${getProviderName(defaultProviderId) ?? defaultProviderId} · ${getModelDisplayName(defaultProviderId, (defaultModelTier as ModelTier) ?? "default") ?? getModelName(defaultProviderId, (defaultModelTier as ModelTier) ?? "default") ?? TIER_LABELS[(defaultModelTier as ModelTier) ?? "default"]}`
    : undefined
  const inheritedTimeoutMins = defaultNodeTimeoutMins ?? DEFAULT_AGENT_TIMEOUT_MINS
  const nodeProviderLabel = config.providerId
    ? `${getProviderName(config.providerId) ?? config.providerId} · ${getModelDisplayName(config.providerId, config.modelTier ?? "default") ?? getModelName(config.providerId, config.modelTier ?? "default") ?? TIER_LABELS[config.modelTier ?? "default"]}`
    : "选择供应商 + 模型"

  return (
    <div className="grid gap-2">
      <CollapsibleSection title="执行配置">
        <div className="grid gap-2">
          <div className="flex items-center gap-2">
            <Checkbox
              id="prompt-node-custom-provider"
              checked={customProviderEnabled}
              onCheckedChange={(checked) => {
                const enabled = checked === true
                setCustomProviderEnabled(enabled)
                if (!enabled) commit({ providerId: undefined, modelTier: undefined })
              }}
            />
            <Label htmlFor="prompt-node-custom-provider" className="text-xs font-normal">单独设置供应商</Label>
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
                id="prompt-node-custom-timeout"
                checked={customTimeoutEnabled}
                onCheckedChange={(checked) => {
                  const enabled = checked === true
                  setCustomTimeoutEnabled(enabled)
                  commit({ timeoutMins: enabled ? (config.timeoutMins ?? inheritedTimeoutMins) : undefined })
                }}
              />
              <Label htmlFor="prompt-node-custom-timeout" className="text-xs font-normal">单独设置超时</Label>
            </div>
            {customTimeoutEnabled ? (
              <Input
                id="prompt-node-timeout"
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

      <CollapsibleSection title="指令" summary={promptSummary}>
        <PromptEditor
          value={prompt}
          onChange={setPrompt}
          onBlur={() => commit({ prompt })}
          variables={config.variables}
          placeholder="输入提示词，用 {{变量名}} 引用变量…"
        />
        {errorFor("prompt") && <p className="text-xs text-destructive">{errorFor("prompt")}</p>}
      </CollapsibleSection>
    </div>
  )
}
