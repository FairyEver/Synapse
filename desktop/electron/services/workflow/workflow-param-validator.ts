import path from "node:path"
import { WORKFLOW_MULTI_RESOURCE_PARAM_MAX_ITEMS } from "../../../config"
import type { WorkflowParam, WorkflowResourceRef, ValidationError } from "../../../src/types/workflow"

export function isResourceParamType(type: WorkflowParam["type"]): type is "file" | "directory" {
  return type === "file" || type === "directory"
}

export function isMultiResourceParam(param: WorkflowParam): boolean {
  return isResourceParamType(param.type) && param.allowMultiple === true
}

export function validateWorkflowParamConfiguration(param: WorkflowParam): readonly ValidationError[] {
  const errors: ValidationError[] = []
  validateParamDefault(param, errors)
  validateOptionParam(param, errors)
  return errors
}

function validateParamDefault(param: WorkflowParam, errors: ValidationError[]): void {
  const name = param.name.trim()
  if (param.allowMultiple !== undefined && typeof param.allowMultiple !== "boolean") {
    errors.push({ type: "invalid_config", message: `参数「${name}」的允许多选设置必须是布尔值` })
  }
  if (param.allowMultiple !== undefined && !isResourceParamType(param.type)) {
    errors.push({ type: "invalid_config", message: `参数「${name}」只有文件或文件夹类型可以允许多选` })
  }
  if (param.type === "number" && param.default !== null) {
    if (typeof param.default !== "number" || !Number.isFinite(param.default)) {
      errors.push({ type: "invalid_config", message: `参数「${name}」是数字类型，默认值必须是有效数字` })
    }
  }
  if (param.type === "text" && param.default !== null && typeof param.default !== "string") {
    errors.push({ type: "invalid_config", message: `参数「${name}」的默认值必须是文本` })
  }
  if (isResourceParamType(param.type) && param.default !== null) {
    if (param.allowMultiple === true) {
      validateMultiResourceDefault(param, errors)
    } else if (!isWorkflowResourceRef(param.default) || param.default.entryType !== param.type) {
      errors.push({ type: "invalid_config", message: `参数「${name}」的默认值必须是${param.type === "file" ? "文件" : "文件夹"}引用` })
    }
  }
}

function validateMultiResourceDefault(param: WorkflowParam, errors: ValidationError[]): void {
  const name = param.name.trim()
  if (!Array.isArray(param.default)) {
    errors.push({ type: "invalid_config", message: `参数「${name}」的多选默认值必须是资源引用数组` })
    return
  }
  if (param.default.length === 0) {
    errors.push({ type: "invalid_config", message: `参数「${name}」的多选默认值不能为空` })
    return
  }
  if (param.default.length > WORKFLOW_MULTI_RESOURCE_PARAM_MAX_ITEMS) {
    errors.push({ type: "invalid_config", message: `参数「${name}」的多选默认值最多包含 ${WORKFLOW_MULTI_RESOURCE_PARAM_MAX_ITEMS} 项` })
    return
  }
  const identities = new Set<string>()
  for (const value of param.default) {
    if (!isWorkflowResourceRef(value) || value.entryType !== param.type) {
      errors.push({ type: "invalid_config", message: `参数「${name}」的多选默认值必须全部是${param.type === "file" ? "文件" : "文件夹"}引用` })
      return
    }
    const identity = workflowResourceIdentity(value)
    if (identities.has(identity)) {
      errors.push({ type: "invalid_config", message: `参数「${name}」的多选默认值不能包含重复资源` })
      return
    }
    identities.add(identity)
  }
}

function isWorkflowResourceRef(value: unknown): value is WorkflowResourceRef {
  if (!value || typeof value !== "object" || Array.isArray(value)) return false
  const record = value as Record<string, unknown>
  if (record.kind === "local_path") {
    return (record.entryType === "file" || record.entryType === "directory")
      && typeof record.path === "string"
  }
  if (record.kind === "drive") {
    return (record.entryType === "file" || record.entryType === "directory")
      && typeof record.id === "string"
      && (record.versionId === undefined || typeof record.versionId === "string")
  }
  if (record.kind === "staged") {
    return (record.entryType === "file" || record.entryType === "directory")
      && typeof record.id === "string"
  }
  if (record.kind === "inline_file") {
    return record.entryType === "file"
      && typeof record.name === "string"
      && typeof record.base64 === "string"
      && (record.mimeType === undefined || typeof record.mimeType === "string")
  }
  return false
}

function workflowResourceIdentity(value: WorkflowResourceRef): string {
  if (value.kind === "local_path") {
    const normalizedPath = path.normalize(value.path)
    return `local_path:${value.entryType}:${process.platform === "win32" ? normalizedPath.toLocaleLowerCase() : normalizedPath}`
  }
  if (value.kind === "drive") return `drive:${value.entryType}:${value.id}:${value.versionId ?? ""}`
  if (value.kind === "staged") return `staged:${value.entryType}:${value.id}`
  return `inline_file:${value.name}:${value.mimeType ?? ""}:${value.base64}`
}

function normalizeOptionValues(options: unknown): string[] {
  if (!Array.isArray(options)) return []
  return options
    .filter((option): option is string => typeof option === "string")
    .map((option) => option.trim())
    .filter(Boolean)
}

function validateOptionParam(param: WorkflowParam, errors: ValidationError[]): void {
  if (param.type !== "option") return
  const name = param.name.trim()
  const rawOptions = param.options as unknown
  const hasMalformedOptions = rawOptions !== undefined
    && (!Array.isArray(rawOptions) || rawOptions.some((option) => typeof option !== "string"))
  if (hasMalformedOptions) {
    errors.push({ type: "invalid_config", message: `参数「${name}」的选项必须是文本数组` })
  }
  if (param.allowCustomOption !== undefined && typeof param.allowCustomOption !== "boolean") {
    errors.push({ type: "invalid_config", message: `参数「${name}」的允许自定义设置必须是布尔值` })
  }
  const options = normalizeOptionValues(rawOptions)
  if (hasMalformedOptions) return
  if (options.length === 0) {
    errors.push({ type: "invalid_config", message: `参数「${name}」至少需要一个选项` })
  }
  if (new Set(options).size !== options.length) {
    errors.push({ type: "invalid_config", message: `参数「${name}」的选项不能重复` })
  }
  if (param.default !== null) {
    const defaultValue = typeof param.default === "string" ? param.default.trim() : null
    if (!defaultValue || !options.includes(defaultValue)) {
      errors.push({ type: "invalid_config", message: `参数「${name}」的默认值必须是选项之一` })
    }
  }
}
