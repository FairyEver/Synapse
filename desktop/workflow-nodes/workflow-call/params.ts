import type { WorkflowDefinition, WorkflowParam, WorkflowParamBinding, WorkflowVariableSource } from "../../src/types/workflow"
import { interpolatePrompt } from "../../electron/services/workflow/variable-resolver"

const TEMPLATE_VARIABLE_RE = /\{\{\s*\$?([\p{L}\p{N}_.-]+)\s*\}\}/gu

export interface BuildWorkflowCallParamsInput {
  childDefinition: Pick<WorkflowDefinition, "params">
  paramTemplates: Record<string, string>
  paramBindings?: Record<string, WorkflowParamBinding>
  parentParamValues?: Record<string, unknown>
  parentParamDefinitions?: readonly WorkflowParam[]
  resolvedVariables: Record<string, string>
  nodeOutputs?: Readonly<Record<string, string>>
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
        const bindingError = validateWorkflowCallValueBinding(param, binding.source, input.parentParamDefinitions)
        if (bindingError) {
          errors.push(bindingError)
          continue
        }
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
      if (workflowParamHasDefault(param)) {
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

export function validateWorkflowCallValueBinding(
  childParam: WorkflowParam,
  source: WorkflowVariableSource,
  parentParams: readonly WorkflowParam[] | undefined,
): string | null {
  if (childParam.type !== "file" && childParam.type !== "directory") return null
  if (source.type !== "param") {
    return childParam.allowMultiple === true
      ? `子工作流多选资源参数「${childParam.name}」不能绑定 ${source.type} 字符串来源，必须直接绑定类型和多选设置一致的父工作流参数`
      : null
  }
  if (!parentParams) return null
  const parentParam = parentParams?.find((param) => param.name === source.param)
  if (!parentParam) return `子工作流参数「${childParam.name}」引用的父工作流参数「${source.param}」不存在`
  if (parentParam.type !== childParam.type || Boolean(parentParam.allowMultiple) !== Boolean(childParam.allowMultiple)) {
    return `子工作流参数「${childParam.name}」与父工作流参数「${source.param}」的资源类型或多选设置不一致`
  }
  return null
}

function resolveValueBinding(source: WorkflowVariableSource, input: BuildWorkflowCallParamsInput): unknown {
  if (source.type === "param") return input.parentParamValues?.[source.param]
  if (source.type === "static") return source.value
  return input.nodeOutputs?.[source.node] ?? ""
}

function renderTemplateParam(
  param: WorkflowParam,
  template: string,
  resolvedVariables: Record<string, string>,
): { hasValue: true; value: unknown } | { hasValue: false } | { error: string } {
  if ((param.type === "file" || param.type === "directory") && param.allowMultiple === true) {
    return { error: `子工作流多选资源参数「${param.name}」不能使用模板传值，必须直接绑定类型和多选设置一致的父工作流参数` }
  }

  let rendered: string
  try {
    rendered = interpolatePrompt(template, resolvedVariables)
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error)
    return { error: `子工作流参数「${param.name}」模板变量解析失败：${message}` }
  }

  if (param.type === "text" || param.type === "file" || param.type === "directory" || param.type === "option") {
    if (rendered.trim().length === 0 && !workflowParamHasDefault(param)) {
      return { error: `子工作流参数「${param.name}」缺少必填值` }
    }
    if (rendered.trim().length === 0 && workflowParamHasDefault(param)) {
      return { hasValue: true, value: param.default }
    }
    return { hasValue: true, value: rendered }
  }

  const trimmed = rendered.trim()
  if (trimmed.length === 0) {
    if (workflowParamHasDefault(param)) return { hasValue: true, value: param.default }
    return { error: `子工作流参数「${param.name}」缺少必填值` }
  }

  const numberValue = Number(trimmed)
  if (!Number.isFinite(numberValue)) {
    return { error: `子工作流参数「${param.name}」必须是数字` }
  }
  return { hasValue: true, value: numberValue }
}

export function workflowParamHasDefault(param: Pick<WorkflowParam, "default">): boolean {
  return param.default !== undefined && param.default !== null && (!Array.isArray(param.default) || param.default.length > 0)
}
