import { useState } from "react"
import { Input } from "@/components/ui/input"
import { Label } from "@/components/ui/label"
import { Textarea } from "@/components/ui/textarea"
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
  const [agent, setAgent] = useState(config.agent)
  const [prompt, setPrompt] = useState(config.prompt)
  const commit = () => onChange({ ...config, agent, prompt })

  return (
    <div className="grid gap-3">
      <div className="grid gap-1.5">
        <Label className="text-xs">Agent</Label>
        <Input
          className="h-7 text-xs"
          value={agent}
          onChange={(e) => setAgent(e.target.value)}
          onBlur={commit}
          placeholder="Agent 名称"
        />
      </div>
      <VariableBindingEditor
        variables={config.variables}
        onChange={(variables) => onChange({ ...config, agent, prompt, variables })}
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
          onBlur={commit}
          placeholder="输入提示词，用 {{$变量名}} 引用变量…"
        />
      </div>
    </div>
  )
}
