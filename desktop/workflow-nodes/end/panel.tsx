import { useRef, useState } from "react"
import { Label } from "@/components/ui/label"
import { Textarea } from "@/components/ui/textarea"
import type { WorkflowParam } from "@/types/workflow"
import type { EndNodeConfig } from "./schema"
import { VariableBindingEditor } from "../variable-binding-editor"

export interface EndNodePanelProps {
  config: EndNodeConfig
  onChange: (config: EndNodeConfig) => void
  upstreamNodes: { id: string; name: string }[]
  workflowParams: WorkflowParam[]
}

export function EndNodePanel({ config, onChange, upstreamNodes, workflowParams }: EndNodePanelProps) {
  const [template, setTemplate] = useState(config.template)
  // Track the last-committed config to avoid stale-prop overwrites when
  // multiple fields are edited in rapid succession before re-render propagates.
  const lastCommittedRef = useRef<EndNodeConfig>(config)

  const commit = (overrides?: Partial<EndNodeConfig>) => {
    const next: EndNodeConfig = { ...lastCommittedRef.current, template, ...overrides }
    lastCommittedRef.current = next
    onChange(next)
  }

  return (
    <div className="grid gap-3">
      <VariableBindingEditor
        variables={config.variables}
        onChange={(variables) => commit({ variables })}
        upstreamNodes={upstreamNodes}
        workflowParams={workflowParams}
      />
      <div className="grid gap-1.5">
        <Label className="text-xs">返回文本</Label>
        <Textarea
          className="text-xs resize-none"
          rows={8}
          value={template}
          onChange={(e) => setTemplate(e.target.value)}
          onBlur={() => commit({ template })}
          placeholder="输入返回文本，用 {{变量名}} 引用变量…"
        />
      </div>
    </div>
  )
}
