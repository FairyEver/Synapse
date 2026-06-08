import { z } from "zod"
import type { WorkflowParam, WorkflowRunResult } from "../../../src/types/workflow"

const TEMPLATE_VARIABLE_PATTERN = /\{\{\s*\$?([\p{L}\p{N}_.-]+)\s*\}\}/gu

export const workflowActionConfigSchema = z.object({
  workflowId: z.string().default(""),
  paramTemplates: z.record(z.string(), z.string()).default({}),
})

export type WorkflowActionConfig = z.infer<typeof workflowActionConfigSchema>

export type WorkflowActionOutputs = {
  readonly workflowId?: string
  readonly workflowName?: string
  readonly workflowRunId?: string
  readonly workflowStatus?: WorkflowRunResult["status"]
  readonly output?: string
  readonly durationMs?: number
  readonly params?: Record<string, unknown>
}

export function buildWorkflowRunParams(input: {
  readonly workflowParams: readonly WorkflowParam[]
  readonly paramTemplates: Record<string, string>
  readonly templateVariables: Record<string, string>
}): Record<string, unknown> {
  const built: Record<string, unknown> = {}

  for (const param of input.workflowParams) {
    const rawTemplate = input.paramTemplates[param.name] ?? ""
    const rendered = renderWorkflowActionTemplate(rawTemplate, input.templateVariables).trim()

    if (!rendered) {
      if (param.default !== null) {
        built[param.name] = param.default
        continue
      }
      throw new Error(`参数「${param.name}」不能为空`)
    }

    if (param.type === "number") {
      const numeric = Number(rendered)
      if (!Number.isFinite(numeric)) {
        throw new Error(`参数「${param.name}」必须是数字`)
      }
      built[param.name] = numeric
      continue
    }

    built[param.name] = rendered
  }

  return built
}

export function workflowStatusToActionStatus(status: WorkflowRunResult["status"]): "success" | "failed" | "cancelled" {
  if (status === "completed") {
    return "success"
  }
  if (status === "cancelled") {
    return "cancelled"
  }
  return "failed"
}

function renderWorkflowActionTemplate(template: string, variables: Record<string, string>): string {
  return template.replace(TEMPLATE_VARIABLE_PATTERN, (_match, variableName: string) => {
    const value = variables[variableName]
    if (value === undefined) {
      throw new Error(`未知变量：${variableName}`)
    }
    return value
  })
}
