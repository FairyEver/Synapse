import { useState } from "react"
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
  const commit = () => onChange({ ...config, template })

  return (
    <div className="grid gap-3">
      <VariableBindingEditor
        variables={config.variables}
        onChange={(variables) => onChange({ ...config, template, variables })}
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
          onBlur={commit}
          placeholder="输入返回文本，用 {{变量名}} 引用变量…"
        />
      </div>
    </div>
  )
}
