import path from "node:path"
import { WORKFLOW_MULTI_RESOURCE_PARAM_MAX_ITEMS } from "../../../config"
import type { ValidationError, WorkflowDefinition, WorkflowParam, WorkflowResourceEntryType, WorkflowResourceRef } from "../../../src/types/workflow"
import { resolveWorkflowLocalResourceIdentity } from "./workflow-resource-identity"

export interface NormalizedWorkflowRunParams {
  readonly params: Record<string, unknown>
  readonly stringValues: Record<string, string>
  readonly snapshotParams: Record<string, unknown>
  readonly errors: ValidationError[]
}

export async function validateWorkflowResourceDefaults(
  def: Pick<WorkflowDefinition, "params">,
): Promise<ValidationError[]> {
  const errors: ValidationError[] = []
  for (const param of def.params) {
    if (param.allowMultiple !== true) {
      const defaultValue = param.default
      if (!defaultValue || typeof defaultValue !== "object" || Array.isArray(defaultValue) || defaultValue.kind !== "local_path") continue
      const statResult = await statLocalResource(param, defaultValue.path)
      if ("error" in statResult) errors.push(statResult.error)
      continue
    }
    if (!Array.isArray(param.default)) continue
    const identities = new Set<string>()
    for (const [index, value] of param.default.entries()) {
      if (value?.kind !== "local_path") continue
      const statResult = await statLocalResource(param, value.path, index)
      if ("error" in statResult) {
        errors.push(statResult.error)
        break
      }
      if (identities.has(statResult.identity)) {
        errors.push(paramItemError(param, index, "与前面的资源重复").error)
        break
      }
      identities.add(statResult.identity)
    }
  }
  return errors
}

export async function normalizeWorkflowRunParams(
  def: Pick<WorkflowDefinition, "params">,
  rawParams: Record<string, unknown>,
): Promise<NormalizedWorkflowRunParams> {
  const declaredParamNames = new Set(def.params.map((param) => param.name))
  const declaredRawParams = Object.fromEntries(
    Object.entries(rawParams).filter(([name]) => declaredParamNames.has(name)),
  )
  const params: Record<string, unknown> = { ...declaredRawParams }
  const stringValues: Record<string, string> = {}
  const snapshotParams: Record<string, unknown> = { ...declaredRawParams }
  const errors: ValidationError[] = Object.keys(rawParams)
    .filter((name) => !declaredParamNames.has(name))
    .map((name) => ({
      type: "invalid_config",
      message: `运行参数「${name}」未在 Workflow 中定义`,
    }))

  for (const param of def.params) {
    const hasRawValue = Object.prototype.hasOwnProperty.call(rawParams, param.name)
    const supplied = hasRawValue ? rawParams[param.name] : undefined
    const raw = hasRawValue ? supplied : param.default
    if (raw === undefined || raw === null || (param.allowMultiple === true && Array.isArray(raw) && raw.length === 0)) {
      errors.push({ type: "missing_param", message: `缺少必填参数「${param.name}」` })
      continue
    }
    const normalized = await normalizeOneParam(param, raw)
    if ("error" in normalized) {
      errors.push(normalized.error)
      continue
    }
    params[param.name] = normalized.value
    stringValues[param.name] = normalized.stringValue
    snapshotParams[param.name] = normalized.snapshotValue
  }

  return { params, stringValues, snapshotParams, errors }
}

async function normalizeOneParam(
  param: WorkflowParam,
  raw: unknown,
): Promise<
  | { value: unknown; stringValue: string; snapshotValue: unknown }
  | { error: ValidationError }
> {
  if (param.type === "text") {
    if (typeof raw !== "string") return paramError(param, "必须是文本")
    return { value: raw, stringValue: raw, snapshotValue: raw }
  }
  if (param.type === "option") {
    if (typeof raw !== "string") return paramError(param, "必须是文本")
    const value = raw.trim()
    if (!value) {
      return { error: { type: "missing_param", message: `缺少必填参数「${param.name}」` } }
    }
    const options = normalizeOptionValues(param.options)
    if (param.allowCustomOption !== true && !options.includes(value)) {
      return paramError(param, "必须是预设选项之一")
    }
    return { value, stringValue: value, snapshotValue: value }
  }
  if (param.type === "number") {
    const value = typeof raw === "number" ? raw : typeof raw === "string" ? Number(raw) : Number.NaN
    if (!Number.isFinite(value)) return paramError(param, "必须是数字")
    return { value, stringValue: String(value), snapshotValue: value }
  }

  if (param.allowMultiple === true) return normalizeMultipleResourceParam(param, raw)
  if (Array.isArray(raw)) return paramError(param, "必须是单个资源引用")
  return normalizeSingleResourceParam(param, raw)
}

async function normalizeSingleResourceParam(
  param: WorkflowParam,
  raw: unknown,
): Promise<{ value: WorkflowResourceRef; stringValue: string; snapshotValue: WorkflowResourceRef } | { error: ValidationError }> {
  const ref = normalizeResourceInput(param, raw)
  if ("error" in ref) return ref
  if (ref.value.kind !== "local_path") {
    return paramError(param, `暂不支持 ${ref.value.kind} ${param.type === "file" ? "文件" : "文件夹"}引用`)
  }
  const statResult = await statLocalResource(param, ref.value.path)
  if ("error" in statResult) return statResult
  return { value: ref.value, stringValue: ref.value.path, snapshotValue: ref.value }
}

async function normalizeMultipleResourceParam(
  param: WorkflowParam,
  raw: unknown,
): Promise<{ value: WorkflowResourceRef[]; stringValue: string; snapshotValue: WorkflowResourceRef[] } | { error: ValidationError }> {
  if (!Array.isArray(raw)) return paramError(param, "必须是资源引用数组")
  if (raw.length === 0) return { error: { type: "missing_param", message: `缺少必填参数「${param.name}」` } }
  if (raw.length > WORKFLOW_MULTI_RESOURCE_PARAM_MAX_ITEMS) {
    return paramError(param, `最多包含 ${WORKFLOW_MULTI_RESOURCE_PARAM_MAX_ITEMS} 项`)
  }

  const refs: WorkflowResourceRef[] = []
  const paths: string[] = []
  const identities = new Set<string>()
  for (const [index, item] of raw.entries()) {
    const ref = normalizeResourceInput(param, item, index)
    if ("error" in ref) return ref
    if (ref.value.kind !== "local_path") {
      return paramItemError(param, index, `暂不支持 ${ref.value.kind} ${param.type === "file" ? "文件" : "文件夹"}引用`)
    }
    const statResult = await statLocalResource(param, ref.value.path, index)
    if ("error" in statResult) return statResult
    if (identities.has(statResult.identity)) return paramItemError(param, index, "与前面的资源重复")
    identities.add(statResult.identity)
    refs.push(ref.value)
    paths.push(ref.value.path)
  }
  return { value: refs, stringValue: JSON.stringify(paths), snapshotValue: refs }
}

function normalizeOptionValues(options: unknown): string[] {
  if (!Array.isArray(options)) return []
  return options
    .filter((option): option is string => typeof option === "string")
    .map((option) => option.trim())
    .filter(Boolean)
}

function normalizeResourceInput(
  param: WorkflowParam,
  raw: unknown,
  itemIndex?: number,
): { value: WorkflowResourceRef } | { error: ValidationError } {
  const entryType = resourceEntryType(param)
  if (!entryType) return paramError(param, "必须是文件或文件夹参数")
  if (typeof raw === "string") {
    const trimmed = raw.trim()
    if (!path.isAbsolute(trimmed)) return itemIndex === undefined ? paramError(param, "必须是绝对路径") : paramItemError(param, itemIndex, "必须是绝对路径")
    return { value: { kind: "local_path", entryType, path: path.normalize(trimmed) } }
  }
  if (!raw || typeof raw !== "object" || Array.isArray(raw)) {
    return itemIndex === undefined ? paramError(param, "必须是资源引用") : paramItemError(param, itemIndex, "必须是资源引用")
  }
  const ref = raw as Record<string, unknown>
  if (ref.entryType !== entryType) {
    return itemIndex === undefined
      ? paramError(param, `必须是${entryType === "file" ? "文件" : "文件夹"}`)
      : paramItemError(param, itemIndex, `必须是${entryType === "file" ? "文件" : "文件夹"}`)
  }
  if (!isWorkflowResourceRef(ref)) {
    return itemIndex === undefined ? paramError(param, "必须是有效资源引用") : paramItemError(param, itemIndex, "必须是有效资源引用")
  }
  const resourceRef = ref as WorkflowResourceRef
  if (resourceRef.kind !== "local_path") return { value: resourceRef }
  const trimmed = resourceRef.path.trim()
  if (!path.isAbsolute(trimmed)) {
    return itemIndex === undefined ? paramError(param, "必须是绝对路径") : paramItemError(param, itemIndex, "必须是绝对路径")
  }
  return { value: { ...resourceRef, path: path.normalize(trimmed) } }
}

function isWorkflowResourceRef(value: Record<string, unknown>): boolean {
  if (value.kind === "local_path") return typeof value.path === "string" && value.path.trim().length > 0
  if (value.kind === "drive") {
    return typeof value.id === "string"
      && (value.versionId === undefined || typeof value.versionId === "string")
  }
  if (value.kind === "staged") return typeof value.id === "string"
  if (value.kind === "inline_file") {
    return value.entryType === "file"
      && typeof value.name === "string"
      && typeof value.base64 === "string"
      && (value.mimeType === undefined || typeof value.mimeType === "string")
  }
  return false
}

type ResourceStatResult = { identity: string } | { error: ValidationError }

async function statLocalResource(param: WorkflowParam, resourcePath: string, itemIndex?: number): Promise<ResourceStatResult> {
  try {
    const resource = await resolveWorkflowLocalResourceIdentity(resourcePath)
    if (param.type === "file" && !resource.isFile) return itemIndex === undefined ? paramError(param, "必须是文件") : paramItemError(param, itemIndex, "必须是文件")
    if (param.type === "directory" && !resource.isDirectory) return itemIndex === undefined ? paramError(param, "必须是文件夹") : paramItemError(param, itemIndex, "必须是文件夹")
    return { identity: resource.identity }
  } catch {
    return itemIndex === undefined ? paramError(param, "路径不存在或不可访问") : paramItemError(param, itemIndex, "路径不存在或不可访问")
  }
}

function paramItemError(param: WorkflowParam, itemIndex: number, message: string): { error: ValidationError } {
  return paramError(param, `第 ${itemIndex + 1} 项${message}`)
}

function paramError(param: WorkflowParam, message: string): { error: ValidationError } {
  return {
    error: {
      type: message.includes("缺少") ? "missing_param" : "invalid_config",
      message: `参数「${param.name}」${message}`,
    },
  }
}

function resourceEntryType(param: WorkflowParam): WorkflowResourceEntryType | null {
  return param.type === "file" || param.type === "directory" ? param.type : null
}
