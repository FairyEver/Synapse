import { useRef, useState } from "react"
import { AlertTriangle, ChevronDown } from "lucide-react"
import { Button } from "@/components/ui/button"
import { ProviderModelSelectDialog } from "@/components/provider-model-select-dialog"
import type { ModelTier } from "@/types/provider-model"
import type { SynapseProjectConfig } from "@/types/config"
import type { WorkflowParam } from "@/types/workflow"
import type { PromptNodeConfig } from "./schema"
import { VariableBindingEditor } from "../variable-binding-editor"
import { PromptEditor } from "../prompt-editor"
import { CollapsibleSection } from "../collapsible-section"
import { useProviderLookup } from "../provider-lookup-context"
import { ProjectSelect } from "../project-select"

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
}

export function PromptNodePanel({ config, onChange, upstreamNodes, workflowParams, projects, defaultProjectName, defaultProviderId, defaultModelTier }: PromptNodePanelProps) {
  const [prompt, setPrompt] = useState(config.prompt)
  const [providerDialogOpen, setProviderDialogOpen] = useState(false)
  const lastCommittedRef = useRef<PromptNodeConfig>(config)
  const { getProviderName, getModelName, isProviderAvailable } = useProviderLookup()
  const providerUnavailable = Boolean(config.providerId && !isProviderAvailable(config.providerId))

  const commit = (overrides?: Partial<PromptNodeConfig>) => {
    const next: PromptNodeConfig = { ...lastCommittedRef.current, prompt, ...overrides }
    lastCommittedRef.current = next
    onChange(next)
  }

  const varSummary = config.variables.length > 0 ? `${config.variables.length}个` : undefined
  const promptSummary = prompt.length > 0 ? `${prompt.length}字` : undefined

  return (
    <div className="grid gap-2">
      <CollapsibleSection title="执行配置">
        <Button variant="outline" className={`w-full justify-between h-7 text-xs${providerUnavailable ? " border-destructive" : ""}`} onClick={() => setProviderDialogOpen(true)}>
          <span className="flex min-w-0 items-center gap-1 truncate">
            {providerUnavailable && <AlertTriangle className="size-3 shrink-0 text-destructive" />}
            {config.providerId
              ? `${getProviderName(config.providerId) ?? config.providerId} · ${getModelName(config.providerId, config.modelTier ?? "default") ?? TIER_LABELS[config.modelTier ?? "default"]}`
              : defaultProviderId
                ? `继承: ${getProviderName(defaultProviderId) ?? defaultProviderId} · ${getModelName(defaultProviderId, (defaultModelTier as ModelTier) ?? "default") ?? TIER_LABELS[(defaultModelTier as ModelTier) ?? "default"]}`
                : "选择供应商 + 模型"}
          </span>
          <ChevronDown className="size-3.5 text-muted-foreground" />
        </Button>
        {providerUnavailable && <p className="text-[11px] text-destructive">供应商不可用，请重新选择</p>}
        <ProviderModelSelectDialog
          open={providerDialogOpen}
          onOpenChange={setProviderDialogOpen}
          defaultSelection={config.providerId ? { providerId: config.providerId, modelTier: config.modelTier ?? "default" } : undefined}
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
      </CollapsibleSection>

      <CollapsibleSection title="指令" summary={promptSummary}>
        <PromptEditor
          value={prompt}
          onChange={setPrompt}
          onBlur={() => commit({ prompt })}
          variables={config.variables}
          placeholder="输入提示词，用 {{变量名}} 引用变量…"
        />
      </CollapsibleSection>
    </div>
  )
}
