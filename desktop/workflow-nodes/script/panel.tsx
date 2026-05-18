import { useRef } from "react"
import type { WorkflowParam } from "@/types/workflow"
import type { ScriptNodeConfig } from "./schema"
import type { ScriptActionConfig } from "../../action-packages/builtin/script/schema"
import { ScriptConfigForm } from "../../action-packages/builtin/script/config.renderer"
import { VariableBindingEditor } from "../variable-binding-editor"
import { CollapsibleSection } from "../collapsible-section"

export interface ScriptNodePanelProps {
  config: ScriptNodeConfig
  onChange: (config: ScriptNodeConfig) => void
  upstreamNodes: { id: string; name: string }[]
  workflowParams: WorkflowParam[]
}

export function ScriptNodePanel({ config, onChange, upstreamNodes, workflowParams }: ScriptNodePanelProps) {
  const lastCommittedRef = useRef<ScriptNodeConfig>(config)

  const commit = (overrides?: Partial<ScriptNodeConfig>) => {
    const next: ScriptNodeConfig = { ...lastCommittedRef.current, ...overrides }
    lastCommittedRef.current = next
    onChange(next)
  }

  const handleActionConfigChange = (actionConfig: ScriptActionConfig) => {
    commit({ ...actionConfig })
  }

  const varSummary = config.variables.length > 0 ? `${config.variables.length}个` : undefined

  return (
    <div className="grid gap-2">
      <CollapsibleSection title="脚本配置">
        <ScriptConfigForm
          value={config}
          onChange={handleActionConfigChange}
          idPrefix="wf-node-script"
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
    </div>
  )
}
