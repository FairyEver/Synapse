import { useState } from "react"
import { Input } from "@/components/ui/input"
import { Label } from "@/components/ui/label"
import { Textarea } from "@/components/ui/textarea"
import { Button } from "@/components/ui/button"
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select"
import { Plus, Trash2 } from "lucide-react"
import type { WorkflowParam } from "@/types/workflow"
import type { SwitchNodeConfig, SwitchBranch } from "./schema"
import { VariableBindingEditor } from "../variable-binding-editor"

const NO_DEFAULT = "__none__"

export interface SwitchNodePanelProps {
  config: SwitchNodeConfig
  onChange: (config: SwitchNodeConfig) => void
  upstreamNodes: { id: string; name: string }[]
  workflowParams: WorkflowParam[]
}

export function SwitchNodePanel({ config, onChange, upstreamNodes, workflowParams }: SwitchNodePanelProps) {
  const [agent, setAgent] = useState(config.agent)
  const [prompt, setPrompt] = useState(config.prompt)
  const [branches, setBranches] = useState<SwitchBranch[]>(config.branches)
  const [defaultBranch, setDefaultBranch] = useState<string>(config.defaultBranch ?? NO_DEFAULT)

  const commit = (overrides?: Partial<SwitchNodeConfig>) =>
    onChange({
      ...config, agent, prompt, branches,
      defaultBranch: defaultBranch === NO_DEFAULT ? undefined : defaultBranch,
      ...overrides,
    })

  const addBranch = () => {
    const id = `branch${branches.length + 1}`
    const next = [...branches, { id, label: `分支 ${branches.length + 1}` }]
    setBranches(next)
    commit({ branches: next })
  }

  const removeBranch = (i: number) => {
    const next = branches.filter((_, j) => j !== i)
    const nextDefault = next.some((branch) => branch.id === defaultBranch) ? defaultBranch : NO_DEFAULT
    setBranches(next)
    setDefaultBranch(nextDefault)
    commit({ branches: next, defaultBranch: nextDefault === NO_DEFAULT ? undefined : nextDefault })
  }

  const updateBranchLabel = (i: number, label: string) => {
    const next = branches.map((b, j) => (j === i ? { ...b, label } : b))
    setBranches(next)
    commit({ branches: next })
  }

  return (
    <div className="grid gap-3">
      <div className="grid gap-1.5">
        <Label className="text-xs">Agent</Label>
        <Input
          className="h-7 text-xs"
          value={agent}
          onChange={(e) => setAgent(e.target.value)}
          onBlur={() => commit({ agent })}
          placeholder="Agent 名称"
        />
      </div>
      <VariableBindingEditor
        variables={config.variables}
        onChange={(variables) =>
          onChange({
            ...config, agent, prompt, branches,
            defaultBranch: defaultBranch === NO_DEFAULT ? undefined : defaultBranch,
            variables,
          })
        }
        upstreamNodes={upstreamNodes}
        workflowParams={workflowParams}
      />
      <div className="grid gap-1.5">
        <Label className="text-xs">Prompt</Label>
        <Textarea
          className="text-xs resize-none"
          rows={6}
          value={prompt}
          onChange={(e) => setPrompt(e.target.value)}
          onBlur={() => commit({ prompt })}
          placeholder="输入提示词…"
        />
      </div>
      <div className="grid gap-1.5">
        <Label className="text-xs">分支</Label>
        {branches.map((b, i) => (
          <div key={b.id} className="flex items-center gap-1.5">
            <span className="text-xs text-muted-foreground w-16 truncate">{b.id}</span>
            <Input
              className="h-7 text-xs flex-1"
              value={b.label}
              onChange={(e) => updateBranchLabel(i, e.target.value)}
            />
            <Button
              size="icon" variant="ghost" className="h-7 w-7 shrink-0"
              onClick={() => removeBranch(i)}
              disabled={branches.length <= 1}
            >
              <Trash2 className="h-3 w-3" />
            </Button>
          </div>
        ))}
        <Button size="sm" variant="outline" className="h-7 text-xs" onClick={addBranch}>
          <Plus className="h-3 w-3 mr-1" />添加分支
        </Button>
      </div>
      <div className="grid gap-1.5">
        <Label className="text-xs">默认分支</Label>
        <Select
          value={defaultBranch}
          onValueChange={(v) => {
            setDefaultBranch(v)
            commit({ defaultBranch: v === NO_DEFAULT ? undefined : v })
          }}
        >
          <SelectTrigger className="h-7 text-xs">
            <SelectValue placeholder="无（匹配失败则失败）" />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value={NO_DEFAULT} className="text-xs">无（匹配失败则失败）</SelectItem>
            {branches.map((b) => (
              <SelectItem key={b.id} value={b.id} className="text-xs">{b.label}</SelectItem>
            ))}
          </SelectContent>
        </Select>
      </div>
    </div>
  )
}
