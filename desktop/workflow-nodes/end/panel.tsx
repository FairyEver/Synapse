import { useRef, useState } from "react"
import type { WorkflowParam } from "@/types/workflow"
import type { EndNodeConfig } from "./schema"
import { VariableBindingEditor } from "../variable-binding-editor"
import { PromptEditor } from "../prompt-editor"
import { CollapsibleSection } from "../collapsible-section"

export interface EndNodePanelProps {
  config: EndNodeConfig
  onChange: (config: EndNodeConfig) => void
  upstreamNodes: { id: string; name: string }[]
  workflowParams: WorkflowParam[]
}

export function EndNodePanel({ config, onChange, upstreamNodes, workflowParams }: EndNodePanelProps) {
  const [template, setTemplate] = useState(config.template)
  const lastCommittedRef = useRef<EndNodeConfig>(config)

  const commit = (overrides?: Partial<EndNodeConfig>) => {
    const next: EndNodeConfig = { ...lastCommittedRef.current, template, ...overrides }
    lastCommittedRef.current = next
    onChange(next)
  }

  const varSummary = config.variables.length > 0 ? `${config.variables.length}个` : undefined
  const templateSummary = template.length > 0 ? `${template.length}字` : undefined

  return (
    <div className="grid gap-2">
      <CollapsibleSection title="输入映射" summary={varSummary}>
        <VariableBindingEditor
          variables={config.variables}
          onChange={(variables) => commit({ variables })}
          upstreamNodes={upstreamNodes}
          workflowParams={workflowParams}
        />
      </CollapsibleSection>

      <CollapsibleSection title="输出模板" summary={templateSummary}>
        <PromptEditor
          value={template}
          onChange={setTemplate}
          onBlur={() => commit({ template })}
          variables={config.variables}
          placeholder="输入返回文本，用 {{变量名}} 引用变量…"
        />
      </CollapsibleSection>
    </div>
  )
}
