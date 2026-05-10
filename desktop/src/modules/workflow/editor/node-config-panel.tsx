import { useState } from "react"
import { Input } from "@/components/ui/input"
import { Label } from "@/components/ui/label"
import { Textarea } from "@/components/ui/textarea"
import { Button } from "@/components/ui/button"
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select"
import { Plus, Trash2 } from "lucide-react"
import type { WorkflowDefinition } from "@/types/workflow"
import type { PromptNodeConfig } from "../../../../workflow-nodes/prompt/schema"
import type { SwitchNodeConfig, SwitchBranch } from "../../../../workflow-nodes/switch/schema"

interface NodeConfigPanelProps {
  nodeId: string | null
  definition: WorkflowDefinition
  onConfigChange: (nodeId: string, config: Record<string, unknown>) => void
  onNameChange: (nodeId: string, name: string) => void
}

function PromptEditor({ config, onChange }: { config: PromptNodeConfig; onChange: (c: PromptNodeConfig) => void }) {
  const [agent, setAgent] = useState(config.agent)
  const [prompt, setPrompt] = useState(config.prompt)
  const commit = () => onChange({ ...config, agent, prompt })
  return (
    <div className="grid gap-3">
      <div className="grid gap-1.5">
        <Label className="text-xs">Agent</Label>
        <Input className="h-7 text-xs" value={agent} onChange={(e) => setAgent(e.target.value)} onBlur={commit} placeholder="Agent 名称" />
      </div>
      <div className="grid gap-1.5">
        <Label className="text-xs">Prompt</Label>
        <Textarea className="text-xs resize-none" rows={8} value={prompt} onChange={(e) => setPrompt(e.target.value)} onBlur={commit} placeholder="输入提示词，用 {{$变量名}} 引用变量…" />
      </div>
    </div>
  )
}

const NO_DEFAULT = "__none__"

function SwitchEditor({ config, onChange }: { config: SwitchNodeConfig; onChange: (c: SwitchNodeConfig) => void }) {
  const [agent, setAgent] = useState(config.agent)
  const [prompt, setPrompt] = useState(config.prompt)
  const [branches, setBranches] = useState<SwitchBranch[]>(config.branches)
  const [defaultBranch, setDefaultBranch] = useState<string>(config.defaultBranch ?? NO_DEFAULT)

  const commit = (overrides?: Partial<SwitchNodeConfig>) => onChange({ ...config, agent, prompt, branches, defaultBranch: defaultBranch === NO_DEFAULT ? undefined : defaultBranch, ...overrides })

  const addBranch = () => {
    const id = `branch${branches.length + 1}`
    const next = [...branches, { id, label: `分支 ${branches.length + 1}` }]
    setBranches(next)
    commit({ branches: next })
  }

  const removeBranch = (i: number) => {
    const next = branches.filter((_, j) => j !== i)
    setBranches(next)
    commit({ branches: next })
  }

  const updateBranchLabel = (i: number, label: string) => {
    const next = branches.map((b, j) => j === i ? { ...b, label } : b)
    setBranches(next)
    commit({ branches: next })
  }

  return (
    <div className="grid gap-3">
      <div className="grid gap-1.5">
        <Label className="text-xs">Agent</Label>
        <Input className="h-7 text-xs" value={agent} onChange={(e) => setAgent(e.target.value)} onBlur={() => commit({ agent })} placeholder="Agent 名称" />
      </div>
      <div className="grid gap-1.5">
        <Label className="text-xs">Prompt</Label>
        <Textarea className="text-xs resize-none" rows={6} value={prompt} onChange={(e) => setPrompt(e.target.value)} onBlur={() => commit({ prompt })} placeholder="输入提示词…" />
      </div>
      <div className="grid gap-1.5">
        <Label className="text-xs">分支</Label>
        {branches.map((b, i) => (
          <div key={b.id} className="flex items-center gap-1.5">
            <span className="text-xs text-muted-foreground w-16 truncate">{b.id}</span>
            <Input className="h-7 text-xs flex-1" value={b.label} onChange={(e) => updateBranchLabel(i, e.target.value)} />
            <Button size="icon" variant="ghost" className="h-7 w-7 shrink-0" onClick={() => removeBranch(i)} disabled={branches.length <= 1}>
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

export function NodeConfigPanel({ nodeId, definition, onConfigChange, onNameChange }: NodeConfigPanelProps) {
  const node = nodeId ? definition.nodes.find((n) => n.id === nodeId) : null

  return (
    <div className="w-60 border-l bg-background flex flex-col shrink-0">
      {node ? (
        <>
          <div className="border-b px-3 py-2 grid gap-1">
            <Input
              className="h-7 text-xs font-medium"
              defaultValue={node.name}
              key={node.id}
              onBlur={(e) => onNameChange(node.id, e.target.value)}
            />
            <p className="text-xs text-muted-foreground">{node.type === "prompt" ? "提示词节点" : "分支节点"}</p>
          </div>
          <div className="flex-1 overflow-auto p-3">
            {node.type === "prompt" && (
              <PromptEditor key={node.id} config={node.config as PromptNodeConfig} onChange={(c) => onConfigChange(node.id, c as Record<string, unknown>)} />
            )}
            {node.type === "switch" && (
              <SwitchEditor key={node.id} config={node.config as SwitchNodeConfig} onChange={(c) => onConfigChange(node.id, c as Record<string, unknown>)} />
            )}
          </div>
        </>
      ) : (
        <div className="flex-1 flex items-center justify-center p-4">
          <p className="text-xs text-muted-foreground text-center">点击节点编辑配置</p>
        </div>
      )}
    </div>
  )
}
