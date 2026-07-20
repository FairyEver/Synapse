import { useEffect, useState } from "react"

import {
  Field,
  FieldContent,
  FieldGroup,
  FieldLabel,
} from "../../../src/components/ui/field"
import { Input } from "../../../src/components/ui/input"
import {
  Select,
  SelectContent,
  SelectGroup,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "../../../src/components/ui/select"
import { Textarea } from "../../../src/components/ui/textarea"
import type { WorkflowDefinition, WorkflowMeta } from "../../../src/types/workflow"
import type { WorkflowActionConfig } from "./schema"

export function WorkflowConfigForm({
  value,
  onChange,
}: {
  readonly value: WorkflowActionConfig
  readonly onChange: (value: WorkflowActionConfig) => void
}) {
  const [workflows, setWorkflows] = useState<WorkflowMeta[]>([])
  const [definition, setDefinition] = useState<WorkflowDefinition | null>(null)

  useEffect(() => {
    let cancelled = false
    const workflowBridge = window.synapse?.workflow
    if (!workflowBridge) {
      setWorkflows([])
      return () => {
        cancelled = true
      }
    }
    workflowBridge.definition.list().then((result) => {
      if (!cancelled) setWorkflows(result.items)
    }).catch(() => {
      if (!cancelled) setWorkflows([])
    })
    return () => {
      cancelled = true
    }
  }, [])

  useEffect(() => {
    let cancelled = false
    const workflowBridge = window.synapse?.workflow
    if (!value.workflowId || !workflowBridge) {
      setDefinition(null)
      return () => {
        cancelled = true
      }
    }
    workflowBridge.definition.get(value.workflowId).then((next) => {
      if (!cancelled) setDefinition(next)
    }).catch(() => {
      if (!cancelled) setDefinition(null)
    })
    return () => {
      cancelled = true
    }
  }, [value.workflowId])

  return (
    <FieldGroup>
      <Field>
        <FieldLabel htmlFor="automation-workflow-select">选择工作流</FieldLabel>
        <FieldContent>
          <Select
            value={value.workflowId}
            onValueChange={(workflowId) => onChange({
              ...value,
              workflowId,
              paramTemplates: preserveMatchingTemplates(value.paramTemplates, definition),
            })}
          >
            <SelectTrigger id="automation-workflow-select" className="w-full">
              <SelectValue placeholder="选择工作流" />
            </SelectTrigger>
            <SelectContent>
              <SelectGroup>
                {workflows.map((workflow) => (
                  <SelectItem key={workflow.id} value={workflow.id}>
                    {workflow.name}
                  </SelectItem>
                ))}
              </SelectGroup>
            </SelectContent>
          </Select>
        </FieldContent>
      </Field>

      {definition && definition.params.length === 0 ? (
        <p className="text-sm text-muted-foreground">无需参数</p>
      ) : null}

      {definition?.params.map((param) => (
        <Field key={param.name}>
          <FieldLabel htmlFor={`automation-workflow-param-${param.name}`}>
            {param.description ?? param.name}
          </FieldLabel>
          <FieldContent>
            {param.type === "text" ? (
              <Textarea
                id={`automation-workflow-param-${param.name}`}
                rows={3}
                value={value.paramTemplates[param.name] ?? ""}
                onChange={(event) => onChange({
                  ...value,
                  paramTemplates: {
                    ...value.paramTemplates,
                    [param.name]: event.target.value,
                  },
                })}
              />
            ) : (
              <Input
                id={`automation-workflow-param-${param.name}`}
                type="text"
                value={value.paramTemplates[param.name] ?? ""}
                onChange={(event) => onChange({
                  ...value,
                  paramTemplates: {
                    ...value.paramTemplates,
                    [param.name]: event.target.value,
                  },
                })}
              />
            )}
          </FieldContent>
        </Field>
      ))}
    </FieldGroup>
  )
}

function preserveMatchingTemplates(
  current: Record<string, string>,
  definition: WorkflowDefinition | null,
): Record<string, string> {
  if (!definition) return {}
  const names = new Set(definition.params.map((param) => param.name))
  return Object.fromEntries(Object.entries(current).filter(([name]) => names.has(name)))
}
