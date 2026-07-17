import { useEffect, useMemo, useRef, useState } from "react"
import { Label } from "@/components/ui/label"
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select"
import { Textarea } from "@/components/ui/textarea"
import type { SynapseProjectConfig } from "@/types/config"
import type { WorkflowMeta, WorkflowParam, WorkflowParamBinding } from "@/types/workflow"
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
  const [bindings, setBindings] = useState<Record<string, WorkflowParamBinding>>(config.paramBindings ?? {})
  const [selectedWorkflowMissing, setSelectedWorkflowMissing] = useState(false)
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
        setSelectedWorkflowMissing(false)
        return
      }
      const child = await window.synapse?.workflow.get(config.workflowId)
      if (cancelled) return
      if (!child) {
        setChildParams([])
        setSelectedWorkflowMissing(true)
        return
      }
      setSelectedWorkflowMissing(false)
      const nextParams = child?.params ?? []
      setChildParams(nextParams)
      const withInitialTemplates = buildInitialParamMappings(lastCommittedRef.current, nextParams, workflowParams)
      if (withInitialTemplates !== lastCommittedRef.current) {
        lastCommittedRef.current = withInitialTemplates
        setTemplates(withInitialTemplates.paramTemplates)
        setBindings(withInitialTemplates.paramBindings ?? {})
        onChange(withInitialTemplates)
      }
    })()
    return () => { cancelled = true }
  }, [config.workflowId, onChange, workflowParams])

  useEffect(() => {
    setTemplates(config.paramTemplates)
    setBindings(config.paramBindings ?? {})
    lastCommittedRef.current = config
  }, [config])

  const selectedWorkflowName = useMemo(
    () => workflows.find((workflow) => workflow.id === config.workflowId)?.name,
    [workflows, config.workflowId],
  )
  const workflowSummary = selectedWorkflowMissing ? "子工作流不存在" : selectedWorkflowName

  const commit = (patch: Partial<WorkflowCallNodeConfig>) => {
    const next = { ...lastCommittedRef.current, ...patch }
    lastCommittedRef.current = next
    onChange(next)
  }

  const variableNames = new Set(config.variables.map((variable) => variable.name).filter(Boolean))
  const templateSummary = childParams.length > 0 ? `${childParams.length}个` : undefined

  const updateResourceBinding = (param: WorkflowParam, value: string) => {
    if (value === RESOURCE_STATIC_VALUE || value === RESOURCE_NODE_OUTPUT_VALUE) return

    const nextTemplates = { ...templates }
    const nextBindings = { ...bindings }
    delete nextTemplates[param.name]

    if (value === RESOURCE_DEFAULT_VALUE) {
      delete nextBindings[param.name]
    } else if (value.startsWith(RESOURCE_PARAM_PREFIX)) {
      nextBindings[param.name] = {
        mode: "value",
        source: { type: "param", param: value.slice(RESOURCE_PARAM_PREFIX.length) },
      }
    }

    setTemplates(nextTemplates)
    setBindings(nextBindings)
    commit({ paramTemplates: nextTemplates, paramBindings: nextBindings })
  }

  return (
    <div className="grid gap-2">
      <CollapsibleSection title="工作流" summary={workflowSummary}>
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
          {selectedWorkflowMissing ? (
            <p className="text-xs text-destructive">子工作流不存在</p>
          ) : null}
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
          ) : childParams.map((param) => {
            const label = param.description ?? param.name
            const isResourceParam = param.type === "file" || param.type === "directory"
            const matchingParentParams = workflowParams.filter((parentParam) =>
              parentParam.type === param.type
              && Boolean(parentParam.allowMultiple) === Boolean(param.allowMultiple),
            )
            const binding = bindings[param.name]
            const preservedBindingOption = resourceBindingSelectOption(binding, upstreamNodes)
            const bindingMismatch = resourceBindingMismatch(param, binding, workflowParams)

            return (
              <div key={param.name} className="grid gap-1.5">
                <Label htmlFor={`workflow-call-param-${param.name}`} className="text-xs">{label}</Label>
                {isResourceParam ? (
                  <Select
                    value={resourceBindingSelectValue(binding)}
                    onValueChange={(value) => updateResourceBinding(param, value)}
                  >
                    <SelectTrigger id={`workflow-call-param-${param.name}`} aria-label={label} className="w-full">
                      <SelectValue placeholder={param.default !== null ? "使用子工作流默认值" : "选择来源"} />
                    </SelectTrigger>
                    <SelectContent>
                      {preservedBindingOption ? (
                        <SelectItem value={preservedBindingOption.value}>{preservedBindingOption.label}</SelectItem>
                      ) : null}
                      {param.default !== null ? (
                        <SelectItem value={RESOURCE_DEFAULT_VALUE}>使用子工作流默认值</SelectItem>
                      ) : null}
                      {matchingParentParams.map((parentParam) => (
                        <SelectItem key={parentParam.name} value={`${RESOURCE_PARAM_PREFIX}${parentParam.name}`}>
                          {parentParam.name}
                        </SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                ) : (
                  <Textarea
                    id={`workflow-call-param-${param.name}`}
                    aria-label={label}
                    className="min-h-16 resize-none text-xs"
                    value={templates[param.name] ?? ""}
                    onChange={(event) => setTemplates((current) => ({ ...current, [param.name]: event.target.value }))}
                    onBlur={() => commit({ paramTemplates: templates })}
                    placeholder={param.default !== null ? "使用子工作流默认值" : "输入模板"}
                  />
                )}
                {!isResourceParam && templates[param.name] && extractLooseTemplateNames(templates[param.name]).some((name) => !variableNames.has(name)) ? (
                  <p className="text-xs text-destructive">存在未绑定变量</p>
                ) : null}
                {bindingMismatch ? <p className="text-xs text-destructive">绑定参数的资源类型或多选设置不一致</p> : null}
              </div>
            )
          })}
        </div>
      </CollapsibleSection>
    </div>
  )
}

const RESOURCE_DEFAULT_VALUE = "__default__"
const RESOURCE_PARAM_PREFIX = "param:"
const RESOURCE_STATIC_VALUE = "__static__"
const RESOURCE_NODE_OUTPUT_VALUE = "__node_output__"

function extractLooseTemplateNames(template: string): string[] {
  return [...template.matchAll(/\{\{\s*\$?([\p{L}\p{N}_.-]+)\s*\}\}/gu)].map((match) => match[1])
}

function buildInitialParamMappings(config: WorkflowCallNodeConfig, childParams: WorkflowParam[], workflowParams: WorkflowParam[]): WorkflowCallNodeConfig {
  const parentParamsByName = new Map(workflowParams.map((param) => [param.name, param]))
  const variableNames = new Set(config.variables.map((variable) => variable.name).filter(Boolean))
  const nextTemplates = { ...config.paramTemplates }
  const nextBindings = { ...(config.paramBindings ?? {}) }
  const nextVariables: VariableBinding[] = [...config.variables]
  let changed = false

  for (const param of childParams) {
    if (nextTemplates[param.name] !== undefined || nextBindings[param.name] !== undefined) continue
    const parentParam = parentParamsByName.get(param.name)

    if (param.type === "file" || param.type === "directory") {
      if (
        parentParam?.type === param.type
        && Boolean(parentParam.allowMultiple) === Boolean(param.allowMultiple)
      ) {
        nextBindings[param.name] = {
          mode: "value",
          source: { type: "param", param: param.name },
        }
        changed = true
      }
      continue
    }

    if (variableNames.has(param.name)) {
      nextTemplates[param.name] = `{{${param.name}}}`
      changed = true
      continue
    }
    if (parentParam) {
      nextTemplates[param.name] = `{{${param.name}}}`
      nextVariables.push({ name: param.name, source: { type: "param", param: param.name } })
      variableNames.add(param.name)
      changed = true
    }
  }

  return changed ? { ...config, variables: nextVariables, paramTemplates: nextTemplates, paramBindings: nextBindings } : config
}

function resourceBindingSelectValue(binding: WorkflowParamBinding | undefined): string {
  if (binding?.mode === "value" && binding.source.type === "param") {
    return `${RESOURCE_PARAM_PREFIX}${binding.source.param}`
  }
  if (binding?.mode === "value" && binding.source.type === "static") return RESOURCE_STATIC_VALUE
  if (binding?.mode === "value" && binding.source.type === "node_output") return RESOURCE_NODE_OUTPUT_VALUE
  return ""
}

function resourceBindingSelectOption(
  binding: WorkflowParamBinding | undefined,
  upstreamNodes: readonly { id: string; name: string }[],
): { value: string; label: string } | null {
  if (binding?.mode !== "value") return null
  if (binding.source.type === "static") {
    return {
      value: RESOURCE_STATIC_VALUE,
      label: binding.source.value ? `固定值：${binding.source.value}` : "固定值",
    }
  }
  if (binding.source.type === "node_output") {
    const nodeId = binding.source.node
    const nodeName = upstreamNodes.find((node) => node.id === nodeId)?.name ?? nodeId
    return {
      value: RESOURCE_NODE_OUTPUT_VALUE,
      label: nodeName ? `上游节点：${nodeName}` : "上游节点",
    }
  }
  return null
}

function resourceBindingMismatch(
  childParam: WorkflowParam,
  binding: WorkflowParamBinding | undefined,
  parentParams: readonly WorkflowParam[],
): boolean {
  if (!binding) return false
  if (binding.mode !== "value") return childParam.allowMultiple === true
  if (binding.source.type !== "param") return childParam.allowMultiple === true
  const parentParamName = binding.source.param
  const parentParam = parentParams.find((param) => param.name === parentParamName)
  return !parentParam
    || parentParam.type !== childParam.type
    || Boolean(parentParam.allowMultiple) !== Boolean(childParam.allowMultiple)
}
