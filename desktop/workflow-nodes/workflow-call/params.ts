import type { WorkflowDefinition, WorkflowParam, WorkflowParamBinding, WorkflowVariableSource } from "../../src/types/workflow"
import { interpolatePrompt } from "../../electron/services/workflow/variable-resolver"

const TEMPLATE_VARIABLE_RE = /\{\{\s*\$?([\p{L}\p{N}_.-]+)\s*\}\}/gu

export interface BuildWorkflowCallParamsInput {
  childDefinition: Pick<WorkflowDefinition, "params">
  paramTemplates: Record<string, string>
  paramBindings?: Record<string, WorkflowParamBinding>
  parentParamValues?: Record<string, unknown>
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
    const binding = input.paramBindings?.[param.name]
    const template = input.paramTemplates[param.name]
    const hasTemplate = typeof template === "string" && template.length > 0

    if (binding && hasTemplate) {
      errors.push(`子工作流参数「${param.name}」不能同时使用 paramTemplates 和 paramBindings`)
      continue
    }

    if (binding) {
      if (binding.mode === "value") {
        params[param.name] = resolveValueBinding(binding.source, input)
        continue
      }
      const templateResult = renderTemplateParam(param, binding.template, input.resolvedVariables)
      if ("error" in templateResult) {
        errors.push(templateResult.error)
      } else if (templateResult.hasValue) {
        params[param.name] = templateResult.value
      }
      continue
    }

    if (!hasTemplate) {
      if (paramHasDefault(param)) {
        params[param.name] = param.default
      } else {
        errors.push(`子工作流参数「${param.name}」缺少必填值`)
      }
      continue
    }

    const templateResult = renderTemplateParam(param, template, input.resolvedVariables)
    if ("error" in templateResult) {
      errors.push(templateResult.error)
    } else if (templateResult.hasValue) {
      params[param.name] = templateResult.value
    }
  }

  return { params, errors }
}

function resolveValueBinding(source: WorkflowVariableSource, input: BuildWorkflowCallParamsInput): unknown {
  if (source.type === "param") return input.parentParamValues?.[source.param]
  if (source.type === "static") return source.value
  return input.resolvedVariables[source.node] ?? ""
}

function renderTemplateParam(
  param: WorkflowParam,
  template: string,
  resolvedVariables: Record<string, string>,
): { hasValue: true; value: unknown } | { hasValue: false } | { error: string } {
  let rendered: string
  try {
    rendered = interpolatePrompt(template, resolvedVariables)
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error)
    return { error: `子工作流参数「${param.name}」模板变量解析失败：${message}` }
  }

  if (param.type === "text" || param.type === "file" || param.type === "directory") {
    if (rendered.trim().length === 0 && !paramHasDefault(param)) {
      return { error: `子工作流参数「${param.name}」缺少必填值` }
    }
    if (rendered.trim().length === 0 && paramHasDefault(param)) {
      return { hasValue: true, value: param.default }
    }
    return { hasValue: true, value: rendered }
  }

  const trimmed = rendered.trim()
  if (trimmed.length === 0) {
    if (paramHasDefault(param)) return { hasValue: true, value: param.default }
    return { error: `子工作流参数「${param.name}」缺少必填值` }
  }

  const numberValue = Number(trimmed)
  if (!Number.isFinite(numberValue)) {
    return { error: `子工作流参数「${param.name}」必须是数字` }
  }
  return { hasValue: true, value: numberValue }
}

function paramHasDefault(param: WorkflowParam): boolean {
  return param.default !== undefined && param.default !== null
}
