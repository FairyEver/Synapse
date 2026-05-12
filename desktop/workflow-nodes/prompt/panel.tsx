import { useRef, useState } from "react"
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select"
import { agentDefinitions } from "@/definitions/generated/renderer-registry"
import type { WorkflowParam } from "@/types/workflow"
import type { PromptNodeConfig } from "./schema"
import { VariableBindingEditor } from "../variable-binding-editor"
import { PromptEditor } from "../prompt-editor"
import { CollapsibleSection } from "../collapsible-section"
import { AgentIcon, getAgentLabel } from "../agent-icon"

export interface PromptNodePanelProps {
  config: PromptNodeConfig
  onChange: (config: PromptNodeConfig) => void
  upstreamNodes: { id: string; name: string }[]
  workflowParams: WorkflowParam[]
}

export function PromptNodePanel({ config, onChange, upstreamNodes, workflowParams }: PromptNodePanelProps) {
  const [prompt, setPrompt] = useState(config.prompt)
  const lastCommittedRef = useRef<PromptNodeConfig>(config)

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
        <Select value={config.agent} onValueChange={(agent) => commit({ agent })}>
          <SelectTrigger className="h-7 text-xs">
            <SelectValue placeholder="选择 Agent">
              {config.agent ? (
                <span className="flex items-center gap-2">
                  <AgentIcon agentId={config.agent} />
                  {getAgentLabel(config.agent)}
                </span>
              ) : null}
            </SelectValue>
          </SelectTrigger>
          <SelectContent>
            {agentDefinitions.map((def) => (
              <SelectItem key={def.id} value={def.id} className="text-xs">
                <span className="flex items-center gap-2">
                  <AgentIcon agentId={def.id} />
                  {def.label}
                </span>
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
      </CollapsibleSection>

      <CollapsibleSection title="输入映射" summary={varSummary}>
        <VariableBindingEditor
          variables={config.variables}
          onChange={(variables) => commit({ variables })}
          upstreamNodes={upstreamNodes}
          workflowParams={workflowParams}
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
