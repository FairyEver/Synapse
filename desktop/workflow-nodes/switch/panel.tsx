import { useRef, useState } from "react"
import { Input } from "@/components/ui/input"
import { Button } from "@/components/ui/button"
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select"
import { Plus, Trash2 } from "lucide-react"
import { agentDefinitions } from "@/definitions/generated/renderer-registry"
import type { WorkflowParam } from "@/types/workflow"
import type { SwitchNodeConfig, SwitchBranch } from "./schema"
import { VariableBindingEditor } from "../variable-binding-editor"
import { PromptEditor } from "../prompt-editor"
import { CollapsibleSection } from "../collapsible-section"
import { AgentIcon, getAgentLabel } from "../agent-icon"

const NO_DEFAULT = "__none__"

export interface SwitchNodePanelProps {
  config: SwitchNodeConfig
  onChange: (config: SwitchNodeConfig) => void
  upstreamNodes: { id: string; name: string }[]
  workflowParams: WorkflowParam[]
}

export function SwitchNodePanel({ config, onChange, upstreamNodes, workflowParams }: SwitchNodePanelProps) {
  const [prompt, setPrompt] = useState(config.prompt)
  const [branches, setBranches] = useState<SwitchBranch[]>(config.branches)
  const [defaultBranch, setDefaultBranch] = useState<string>(config.defaultBranch ?? NO_DEFAULT)
  const lastCommittedRef = useRef<SwitchNodeConfig>(config)

  const commit = (overrides?: Partial<SwitchNodeConfig>) => {
    const next: SwitchNodeConfig = {
      ...lastCommittedRef.current, prompt, branches,
      defaultBranch: defaultBranch === NO_DEFAULT ? undefined : defaultBranch,
      ...overrides,
    }
    lastCommittedRef.current = next
    onChange(next)
  }

  const addBranch = () => {
    const existingIds = new Set(branches.map((b) => b.id))
    let counter = branches.length + 1
    while (existingIds.has(`branch${counter}`)) counter++
    const id = `branch${counter}`
    const next = [...branches, { id, label: `分支 ${counter}` }]
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

  const varSummary = config.variables.length > 0 ? `${config.variables.length}个` : undefined
  const promptSummary = prompt.length > 0 ? `${prompt.length}字` : undefined
  const branchSummary = `${branches.length}条`

  return (
    <div className="grid gap-2">
      <CollapsibleSection title="执行配置">
        <Select value={config.agent} onValueChange={(agent) => commit({ agent })}>
          <SelectTrigger className="h-7 text-xs">
            <SelectValue placeholder="选择 Agent">
              {config.agent ? (
                <span className="flex items-center gap-2">
                  <AgentIcon agentId={config.agent} />
                  {getAgentLabel(config.agent)}
                </span>
              ) : null}
            </SelectValue>
          </SelectTrigger>
          <SelectContent>
            {agentDefinitions.map((def) => (
              <SelectItem key={def.id} value={def.id} className="text-xs">
                <span className="flex items-center gap-2">
                  <AgentIcon agentId={def.id} />
                  {def.label}
                </span>
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
      </CollapsibleSection>

      <CollapsibleSection title="输入映射" summary={varSummary}>
        <VariableBindingEditor
          variables={config.variables}
          onChange={(variables) => commit({ variables })}
          upstreamNodes={upstreamNodes}
          workflowParams={workflowParams}
        />
      </CollapsibleSection>

      <CollapsibleSection title="判断指令" summary={promptSummary}>
        <PromptEditor
          value={prompt}
          onChange={setPrompt}
          onBlur={() => commit({ prompt })}
          variables={config.variables}
          placeholder="输入提示词…"
          rows={6}
        />
      </CollapsibleSection>

      <CollapsibleSection title="路由规则" summary={branchSummary}>
        <div className="grid gap-1.5">
          {branches.map((b, i) => (
            <div key={b.id} className="flex items-center gap-1.5">
              <span className="text-[11px] text-muted-foreground w-14 truncate shrink-0">{b.id}</span>
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
          <div className="grid gap-1 mt-1">
            <span className="text-[11px] text-muted-foreground">默认分支</span>
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
      </CollapsibleSection>
    </div>
  )
}
