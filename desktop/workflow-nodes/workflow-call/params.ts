import type { WorkflowDefinition, WorkflowParam } from "../../src/types/workflow"
import { interpolatePrompt } from "../../electron/services/workflow/variable-resolver"

const TEMPLATE_VARIABLE_RE = /\{\{\s*\$?([\p{L}\p{N}_.-]+)\s*\}\}/gu

export interface BuildWorkflowCallParamsInput {
  childDefinition: Pick<WorkflowDefinition, "params">
  paramTemplates: Record<string, string>
  resolvedVariables: Record<string, string>
}

export interface BuildWorkflowCallParamsResult {
  params: Record<string, unknown>
  errors: string[]
}

export function extractWorkflowCallTemplateVariables(template: string): string[] {
  const names = new Set<string>()
  for (const match of template.matchAll(TEMPLATE_VARIABLE_RE)) {
    names.add(match[1])
  }
  return [...names]
}

export function buildWorkflowCallParams(input: BuildWorkflowCallParamsInput): BuildWorkflowCallParamsResult {
  const params: Record<string, unknown> = {}
  const errors: string[] = []

  for (const param of input.childDefinition.params) {
    const template = input.paramTemplates[param.name]
    const hasTemplate = typeof template === "string" && template.length > 0

    if (!hasTemplate) {
      if (paramHasDefault(param)) {
        params[param.name] = param.default
      } else {
        errors.push(`子工作流参数「${param.name}」缺少必填值`)
      }
      continue
    }

    let rendered: string
    try {
      rendered = interpolatePrompt(template, input.resolvedVariables)
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error)
      errors.push(`子工作流参数「${param.name}」模板变量解析失败：${message}`)
      continue
    }

    if (param.type === "text") {
      if (rendered.trim().length === 0 && !paramHasDefault(param)) {
        errors.push(`子工作流参数「${param.name}」缺少必填值`)
      } else if (rendered.trim().length === 0 && paramHasDefault(param)) {
        params[param.name] = param.default
      } else {
        params[param.name] = rendered
      }
      continue
    }

    const numberValue = Number(rendered.trim())
    if (!Number.isFinite(numberValue)) {
      errors.push(`子工作流参数「${param.name}」必须是数字`)
      continue
    }
    params[param.name] = numberValue
  }

  return { params, errors }
}

function paramHasDefault(param: WorkflowParam): boolean {
  return param.default !== undefined && param.default !== null
}
