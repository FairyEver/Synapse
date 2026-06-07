import { useEffect, useMemo, useRef, useState } from "react"
import { Label } from "@/components/ui/label"
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select"
import { Textarea } from "@/components/ui/textarea"
import type { SynapseProjectConfig } from "@/types/config"
import type { WorkflowMeta, WorkflowParam } from "@/types/workflow"
import { CollapsibleSection } from "../collapsible-section"
import type { VariableBinding } from "../schemas/variable-binding"
import { VariableBindingEditor } from "../variable-binding-editor"
import type { WorkflowCallNodeConfig } from "./schema"

export interface WorkflowCallNodePanelProps {
  config: WorkflowCallNodeConfig
  onChange: (config: WorkflowCallNodeConfig) => void
  upstreamNodes: { id: string; name: string }[]
  workflowParams: WorkflowParam[]
  projects?: readonly SynapseProjectConfig[]
  currentWorkflowId?: string
}

export function WorkflowCallNodePanel({ config, onChange, upstreamNodes, workflowParams, currentWorkflowId }: WorkflowCallNodePanelProps) {
  const [workflows, setWorkflows] = useState<WorkflowMeta[]>([])
  const [childParams, setChildParams] = useState<WorkflowParam[]>([])
  const [templates, setTemplates] = useState<Record<string, string>>(config.paramTemplates)
  const lastCommittedRef = useRef<WorkflowCallNodeConfig>(config)

  useEffect(() => {
    let cancelled = false
    void (async () => {
      const items = await window.synapse?.workflow.list()
      if (!cancelled) setWorkflows((items ?? []).filter((item) => item.id !== currentWorkflowId))
    })()
    return () => { cancelled = true }
  }, [currentWorkflowId])

  useEffect(() => {
    let cancelled = false
    void (async () => {
      if (!config.workflowId) {
        setChildParams([])
        return
      }
      const child = await window.synapse?.workflow.get(config.workflowId)
      if (cancelled) return
      const nextParams = child?.params ?? []
      setChildParams(nextParams)
      const withInitialTemplates = buildInitialParamTemplates(lastCommittedRef.current, nextParams, workflowParams)
      if (withInitialTemplates !== lastCommittedRef.current) {
        lastCommittedRef.current = withInitialTemplates
        setTemplates(withInitialTemplates.paramTemplates)
        onChange(withInitialTemplates)
      }
    })()
    return () => { cancelled = true }
  }, [config.workflowId, onChange, workflowParams])

  useEffect(() => {
    setTemplates(config.paramTemplates)
    lastCommittedRef.current = config
  }, [config])

  const selectedWorkflowName = useMemo(
    () => workflows.find((workflow) => workflow.id === config.workflowId)?.name,
    [workflows, config.workflowId],
  )

  const commit = (patch: Partial<WorkflowCallNodeConfig>) => {
    const next = { ...lastCommittedRef.current, ...patch }
    lastCommittedRef.current = next
    onChange(next)
  }

  const variableNames = new Set(config.variables.map((variable) => variable.name).filter(Boolean))
  const templateSummary = childParams.length > 0 ? `${childParams.length}个` : undefined

  return (
    <div className="grid gap-2">
      <CollapsibleSection title="工作流" summary={selectedWorkflowName}>
        <div className="grid gap-1.5">
          <Label className="text-xs">工作流</Label>
          <Select value={config.workflowId} onValueChange={(workflowId) => commit({ workflowId })}>
            <SelectTrigger className="w-full">
              <SelectValue placeholder="选择工作流" />
            </SelectTrigger>
            <SelectContent>
              {workflows.map((workflow) => (
                <SelectItem key={workflow.id} value={workflow.id}>{workflow.name}</SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>
      </CollapsibleSection>

      <CollapsibleSection title="输入映射" summary={config.variables.length > 0 ? `${config.variables.length}个` : undefined}>
        <VariableBindingEditor
          variables={config.variables}
          onChange={(variables) => commit({ variables })}
          upstreamNodes={upstreamNodes}
          workflowParams={workflowParams}
        />
      </CollapsibleSection>

      <CollapsibleSection title="参数" summary={templateSummary}>
        <div className="grid gap-2">
          {childParams.length === 0 ? (
            <p className="text-xs text-muted-foreground">暂无参数</p>
          ) : childParams.map((param) => (
            <div key={param.name} className="grid gap-1.5">
              <Label htmlFor={`workflow-call-param-${param.name}`} className="text-xs">{param.description ?? param.name}</Label>
              <Textarea
                id={`workflow-call-param-${param.name}`}
                aria-label={param.description ?? param.name}
                className="min-h-16 resize-none text-xs"
                value={templates[param.name] ?? ""}
                onChange={(event) => setTemplates((current) => ({ ...current, [param.name]: event.target.value }))}
                onBlur={() => commit({ paramTemplates: templates })}
                placeholder={param.default !== null ? "使用子工作流默认值" : "输入模板"}
              />
              {templates[param.name] && extractLooseTemplateNames(templates[param.name]).some((name) => !variableNames.has(name)) ? (
                <p className="text-xs text-destructive">存在未绑定变量</p>
              ) : null}
            </div>
          ))}
        </div>
      </CollapsibleSection>
    </div>
  )
}

function extractLooseTemplateNames(template: string): string[] {
  return [...template.matchAll(/\{\{\s*\$?([\p{L}\p{N}_.-]+)\s*\}\}/gu)].map((match) => match[1])
}

function buildInitialParamTemplates(config: WorkflowCallNodeConfig, childParams: WorkflowParam[], workflowParams: WorkflowParam[]): WorkflowCallNodeConfig {
  const parentParamNames = new Set(workflowParams.map((param) => param.name))
  const variableNames = new Set(config.variables.map((variable) => variable.name).filter(Boolean))
  const nextTemplates = { ...config.paramTemplates }
  const nextVariables: VariableBinding[] = [...config.variables]
  let changed = false

  for (const param of childParams) {
    if (nextTemplates[param.name] !== undefined) continue
    if (variableNames.has(param.name)) {
      nextTemplates[param.name] = `{{${param.name}}}`
      changed = true
      continue
    }
    if (parentParamNames.has(param.name)) {
      nextTemplates[param.name] = `{{${param.name}}}`
      nextVariables.push({ name: param.name, source: { type: "param", param: param.name } })
      variableNames.add(param.name)
      changed = true
    }
  }

  return changed ? { ...config, variables: nextVariables, paramTemplates: nextTemplates } : config
}
