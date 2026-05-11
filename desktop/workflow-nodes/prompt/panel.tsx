import { useState } from "react"
import { Label } from "@/components/ui/label"
import { Textarea } from "@/components/ui/textarea"
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select"
import { agentDefinitions } from "@/definitions/generated/renderer-registry"
import type { WorkflowParam } from "@/types/workflow"
import type { PromptNodeConfig } from "./schema"
import { VariableBindingEditor } from "../variable-binding-editor"

export interface PromptNodePanelProps {
  config: PromptNodeConfig
  onChange: (config: PromptNodeConfig) => void
  upstreamNodes: { id: string; name: string }[]
  workflowParams: WorkflowParam[]
}

export function PromptNodePanel({ config, onChange, upstreamNodes, workflowParams }: PromptNodePanelProps) {
  const [prompt, setPrompt] = useState(config.prompt)

  return (
    <div className="grid gap-3">
      <div className="grid gap-1.5">
        <Label className="text-xs">Agent</Label>
        <Select
          value={config.agent}
          onValueChange={(agent) => onChange({ ...config, agent, prompt })}
        >
          <SelectTrigger className="h-7 text-xs">
            <SelectValue placeholder="选择 Agent" />
          </SelectTrigger>
          <SelectContent>
            {agentDefinitions.map((def) => (
              <SelectItem key={def.id} value={def.id} className="text-xs">
                {def.label}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
      </div>
      <VariableBindingEditor
        variables={config.variables}
        onChange={(variables) => onChange({ ...config, prompt, variables })}
        upstreamNodes={upstreamNodes}
        workflowParams={workflowParams}
      />
      <div className="grid gap-1.5">
        <Label className="text-xs">Prompt</Label>
        <Textarea
          className="text-xs resize-none"
          rows={8}
          value={prompt}
          onChange={(e) => setPrompt(e.target.value)}
          onBlur={() => onChange({ ...config, prompt })}
          placeholder="输入提示词，用 {{变量名}} 引用变量…"
        />
      </div>
    </div>
  )
}
