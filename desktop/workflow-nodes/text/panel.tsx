import { useRef, useState } from "react"
import type { WorkflowParam } from "@/types/workflow"
import { CollapsibleSection } from "../collapsible-section"
import { PromptEditor } from "../prompt-editor"
import { VariableBindingEditor } from "../variable-binding-editor"
import type { TextNodeConfig } from "./schema"

export interface TextNodePanelProps {
  config: TextNodeConfig
  onChange: (config: TextNodeConfig) => void
  upstreamNodes: { id: string; name: string }[]
  workflowParams: WorkflowParam[]
}

export function TextNodePanel({ config, onChange, upstreamNodes, workflowParams }: TextNodePanelProps) {
  const [template, setTemplate] = useState(config.template)
  const lastCommittedRef = useRef<TextNodeConfig>(config)

  const commit = (overrides?: Partial<TextNodeConfig>) => {
    const next: TextNodeConfig = { ...lastCommittedRef.current, template, ...overrides }
    lastCommittedRef.current = next
    onChange(next)
  }

  const variableSummary = config.variables.length > 0 ? `${config.variables.length}个` : undefined
  const outputSummary = template.length > 0 ? `${template.length}字` : undefined

  return (
    <div className="grid gap-2">
      <CollapsibleSection title="输入映射" summary={variableSummary}>
        <VariableBindingEditor
          variables={config.variables}
          onChange={(variables) => commit({ variables })}
          upstreamNodes={upstreamNodes}
          workflowParams={workflowParams}
        />
      </CollapsibleSection>

      <CollapsibleSection title="输出" summary={outputSummary}>
        <PromptEditor
          value={template}
          onChange={setTemplate}
          onBlur={() => commit({ template })}
          variables={config.variables}
          placeholder="输入文本，用 {{变量名}} 引用变量…"
          enableSkillShortcuts={false}
        />
      </CollapsibleSection>
    </div>
  )
}
