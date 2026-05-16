import { useRef } from "react"
import type { WorkflowParam } from "@/types/workflow"
import type { HttpRequestNodeConfig } from "./schema"
import type { HttpRequestActionConfig } from "../../action-packages/builtin/http-request/schema"
import { HttpRequestConfigForm } from "../../action-packages/builtin/http-request/config.renderer"
import { VariableBindingEditor } from "../variable-binding-editor"
import { CollapsibleSection } from "../collapsible-section"

export interface HttpRequestNodePanelProps {
  config: HttpRequestNodeConfig
  onChange: (config: HttpRequestNodeConfig) => void
  upstreamNodes: { id: string; name: string }[]
  workflowParams: WorkflowParam[]
}

export function HttpRequestNodePanel({ config, onChange, upstreamNodes, workflowParams }: HttpRequestNodePanelProps) {
  const lastCommittedRef = useRef<HttpRequestNodeConfig>(config)

  const commit = (overrides?: Partial<HttpRequestNodeConfig>) => {
    const next: HttpRequestNodeConfig = { ...lastCommittedRef.current, ...overrides }
    lastCommittedRef.current = next
    onChange(next)
  }

  const handleActionConfigChange = (actionConfig: HttpRequestActionConfig) => {
    commit({ ...actionConfig })
  }

  const varSummary = config.variables.length > 0 ? `${config.variables.length}个` : undefined

  return (
    <div className="grid gap-2">
      <HttpRequestConfigForm
        value={config}
        onChange={handleActionConfigChange}
        idPrefix="wf-node-http"
      />

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
