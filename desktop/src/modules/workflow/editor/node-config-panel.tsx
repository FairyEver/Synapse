import { useState } from "react"
import { Input } from "@/components/ui/input"
import { Label } from "@/components/ui/label"
import { Textarea } from "@/components/ui/textarea"
import { Button } from "@/components/ui/button"
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select"
import { Plus, Trash2 } from "lucide-react"
import type { WorkflowDefinition, WorkflowParam } from "@/types/workflow"
import type { PromptNodeConfig } from "../../../../workflow-nodes/prompt/schema"
import type { SwitchNodeConfig, SwitchBranch } from "../../../../workflow-nodes/switch/schema"
import type { VariableBinding } from "../../../../workflow-nodes/schemas/variable-binding"
import { useUpstreamNodes } from "../hooks/use-upstream-nodes"

interface NodeConfigPanelProps {
  nodeId: string | null
  definition: WorkflowDefinition
  onConfigChange: (nodeId: string, config: Record<string, unknown>) => void
  onNameChange: (nodeId: string, name: string) => void
}

interface BindingEditorProps {
  variables: VariableBinding[]
  onChange: (variables: VariableBinding[]) => void
  upstreamNodes: { id: string; name: string }[]
  workflowParams: WorkflowParam[]
}

function VariableBindingEditor({ variables, onChange, upstreamNodes, workflowParams }: BindingEditorProps) {
  const add = () => onChange([...variables, { name: "", source: { type: "static", value: "" } }])
  const remove = (i: number) => onChange(variables.filter((_, j) => j !== i))
  const update = (i: number, patch: Partial<VariableBinding>) =>
    onChange(variables.map((v, j) => (j === i ? { ...v, ...patch } : v)))

  return (
    <div className="grid gap-1.5">
      <Label className="text-xs">变量绑定</Label>
      {variables.map((v, i) => (
        <div key={i} className="border rounded-md p-2 grid gap-1.5">
          <div className="flex items-center gap-1">
            <Input
              className="h-6 text-xs flex-1"
              value={v.name}
              onChange={(e) => update(i, { name: e.target.value })}
              placeholder="变量名"
            />
            <Button size="icon" variant="ghost" className="h-6 w-6 shrink-0" onClick={() => remove(i)}>
              <Trash2 className="h-3 w-3" />
            </Button>
          </div>
          <Select
            value={v.source.type}
            onValueChange={(type) => {
              if (type === "node_output") update(i, { source: { type: "node_output", node: "" } })
              else if (type === "param") update(i, { source: { type: "param", param: "" } })
              else update(i, { source: { type: "static", value: "" } })
            }}
          >
            <SelectTrigger className="h-6 text-xs"><SelectValue /></SelectTrigger>
            <SelectContent>
              <SelectItem value="node_output" className="text-xs">上游节点输出</SelectItem>
              <SelectItem value="param" className="text-xs">工作流参数</SelectItem>
              <SelectItem value="static" className="text-xs">固定值</SelectItem>
            </SelectContent>
          </Select>
          {v.source.type === "node_output" && (
            <Select
              value={v.source.node}
              onValueChange={(node) => update(i, { source: { type: "node_output", node } })}
            >
              <SelectTrigger className="h-6 text-xs"><SelectValue placeholder="选择上游节点" /></SelectTrigger>
              <SelectContent>
                {upstreamNodes.map((n) => (
                  <SelectItem key={n.id} value={n.id} className="text-xs">{n.name}</SelectItem>
                ))}
              </SelectContent>
            </Select>
          )}
          {v.source.type === "param" && (
            <Select
              value={v.source.param}
              onValueChange={(param) => update(i, { source: { type: "param", param } })}
            >
              <SelectTrigger className="h-6 text-xs"><SelectValue placeholder="选择参数" /></SelectTrigger>
              <SelectContent>
                {workflowParams.map((p) => (
                  <SelectItem key={p.name} value={p.name} className="text-xs">{p.name}</SelectItem>
                ))}
              </SelectContent>
            </Select>
          )}
          {v.source.type === "static" && (
            <Input
              className="h-6 text-xs"
              value={v.source.value}
              onChange={(e) => update(i, { source: { type: "static", value: e.target.value } })}
              placeholder="固定值"
            />
          )}
        </div>
      ))}
      <Button size="sm" variant="outline" className="h-6 text-xs" onClick={add}>
        <Plus className="h-3 w-3 mr-1" />添加变量
      </Button>
    </div>
  )
}

interface EditorCommonProps {
  upstreamNodes: { id: string; name: string }[]
  workflowParams: WorkflowParam[]
}

function PromptEditor({ config, onChange, upstreamNodes, workflowParams }: { config: PromptNodeConfig; onChange: (c: PromptNodeConfig) => void } & EditorCommonProps) {
  const [agent, setAgent] = useState(config.agent)
  const [prompt, setPrompt] = useState(config.prompt)
  const commit = () => onChange({ ...config, agent, prompt })
  return (
    <div className="grid gap-3">
      <div className="grid gap-1.5">
        <Label className="text-xs">Agent</Label>
        <Input className="h-7 text-xs" value={agent} onChange={(e) => setAgent(e.target.value)} onBlur={commit} placeholder="Agent 名称" />
      </div>
      <VariableBindingEditor
        variables={config.variables}
        onChange={(variables) => onChange({ ...config, agent, prompt, variables })}
        upstreamNodes={upstreamNodes}
        workflowParams={workflowParams}
      />
      <div className="grid gap-1.5">
        <Label className="text-xs">Prompt</Label>
        <Textarea className="text-xs resize-none" rows={8} value={prompt} onChange={(e) => setPrompt(e.target.value)} onBlur={commit} placeholder="输入提示词，用 {{$变量名}} 引用变量…" />
      </div>
    </div>
  )
}

const NO_DEFAULT = "__none__"

function SwitchEditor({ config, onChange, upstreamNodes, workflowParams }: { config: SwitchNodeConfig; onChange: (c: SwitchNodeConfig) => void } & EditorCommonProps) {
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
      <VariableBindingEditor
        variables={config.variables}
        onChange={(variables) => onChange({ ...config, agent, prompt, branches, defaultBranch: defaultBranch === NO_DEFAULT ? undefined : defaultBranch, variables })}
        upstreamNodes={upstreamNodes}
        workflowParams={workflowParams}
      />
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
  const upstreamNodes = useUpstreamNodes(nodeId ?? "", definition)

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
              <PromptEditor key={node.id} config={node.config as PromptNodeConfig} onChange={(c) => onConfigChange(node.id, c as Record<string, unknown>)} upstreamNodes={upstreamNodes} workflowParams={definition.params} />
            )}
            {node.type === "switch" && (
              <SwitchEditor key={node.id} config={node.config as SwitchNodeConfig} onChange={(c) => onConfigChange(node.id, c as Record<string, unknown>)} upstreamNodes={upstreamNodes} workflowParams={definition.params} />
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
