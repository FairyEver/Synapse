import { lstat } from "node:fs/promises"
import path from "node:path"
import type { ValidationError, WorkflowDefinition, WorkflowParam, WorkflowResourceEntryType, WorkflowResourceRef } from "../../../src/types/workflow"

export interface NormalizedWorkflowRunParams {
  readonly params: Record<string, unknown>
  readonly stringValues: Record<string, string>
  readonly snapshotParams: Record<string, unknown>
  readonly errors: ValidationError[]
}

export async function normalizeWorkflowRunParams(
  def: Pick<WorkflowDefinition, "params">,
  rawParams: Record<string, unknown>,
): Promise<NormalizedWorkflowRunParams> {
  const params: Record<string, unknown> = { ...rawParams }
  const stringValues: Record<string, string> = {}
  const snapshotParams: Record<string, unknown> = { ...rawParams }
  const errors: ValidationError[] = []

  for (const param of def.params) {
    const raw = Object.prototype.hasOwnProperty.call(rawParams, param.name)
      ? rawParams[param.name]
      : param.default
    if (raw === undefined || raw === null) {
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
  if (param.type === "number") {
    const value = typeof raw === "number" ? raw : typeof raw === "string" ? Number(raw) : Number.NaN
    if (!Number.isFinite(value)) return paramError(param, "必须是数字")
    return { value, stringValue: String(value), snapshotValue: value }
  }

  const ref = normalizeResourceInput(param, raw)
  if ("error" in ref) return ref
  if (ref.value.kind !== "local_path") {
    return paramError(param, `暂不支持 ${ref.value.kind} ${param.type === "file" ? "文件" : "文件夹"}引用`)
  }
  const statResult = await statLocalResource(param, ref.value.path)
  if ("error" in statResult) return statResult
  return { value: ref.value, stringValue: ref.value.path, snapshotValue: ref.value }
}

function normalizeResourceInput(
  param: WorkflowParam,
  raw: unknown,
): { value: WorkflowResourceRef } | { error: ValidationError } {
  const entryType = resourceEntryType(param)
  if (!entryType) return paramError(param, "必须是文件或文件夹参数")
  if (typeof raw === "string") {
    const trimmed = raw.trim()
    if (!path.isAbsolute(trimmed)) return paramError(param, "必须是绝对路径")
    return { value: { kind: "local_path", entryType, path: trimmed } }
  }
  if (!raw || typeof raw !== "object" || Array.isArray(raw)) return paramError(param, "必须是资源引用")
  const ref = raw as WorkflowResourceRef
  if (ref.entryType !== entryType) return paramError(param, `必须是${entryType === "file" ? "文件" : "文件夹"}`)
  return { value: ref }
}

async function statLocalResource(param: WorkflowParam, resourcePath: string): Promise<{} | { error: ValidationError }> {
  try {
    const stat = await lstat(resourcePath)
    if (param.type === "file" && !stat.isFile()) return paramError(param, "必须是文件")
    if (param.type === "directory" && !stat.isDirectory()) return paramError(param, "必须是文件夹")
    return {}
  } catch {
    return paramError(param, "路径不存在或不可访问")
  }
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
