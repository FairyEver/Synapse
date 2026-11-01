import type { CloudAction, CloudField, CloudMember, CloudRange } from "@synapse/shared"
import { OpenApiHttpError } from "../open-api/open-api.types"
import { fieldSchema, CLOUD_TABLE_FIELD_BYTES, CLOUD_TABLE_JSON_DEPTH, CLOUD_TABLE_JSON_NODES } from "./cloud-table-contract"

export function fail(code: string, message: string, status = 400): never { throw new OpenApiHttpError(status, code, message) }
export function assertJsonBudget(value: unknown): void {
  const stack = [{ value, depth: 0 }]; let nodes = 0
  while (stack.length) {
    const item = stack.pop()!
    if (++nodes > CLOUD_TABLE_JSON_NODES || item.depth > CLOUD_TABLE_JSON_DEPTH) fail("JSON_TOO_COMPLEX", "JSON超过32层或50000节点，请拆分请求。")
    if (item.value && typeof item.value === "object") {
      const values = Object.values(item.value)
      if (nodes + stack.length + values.length > CLOUD_TABLE_JSON_NODES) fail("JSON_TOO_COMPLEX", "JSON节点过多，请拆分请求。")
      for (const child of values) stack.push({ value: child, depth: item.depth + 1 })
    }
  }
}
export function validateFields(fields: CloudField[]): void {
  assertJsonBudget(fields)
  if (fields.length > 100 || new Set(fields.map(f => f.key)).size !== fields.length) fail("INVALID_FIELDS", "字段过多或标识重复。")
  for (const field of fields) {
    const { archivedAt: _archived, ...definition } = field
    if (Buffer.byteLength(JSON.stringify(definition)) > CLOUD_TABLE_FIELD_BYTES) fail("SCHEMA_TOO_LARGE", "单字段定义不能超过64 KiB。")
    if (!fieldSchema.safeParse(definition).success) fail("INVALID_FIELDS", "字段定义无效。")
    const opts = field.options ?? []
    if (new Set(opts.map(o => o.key)).size !== opts.length) fail("INVALID_FIELDS", "选项标识重复。")
    if (field.type.endsWith("Select") && !opts.length) fail("INVALID_FIELDS", "选择字段需要选项。")
    if (field.defaultValue !== undefined) validateValue(field, field.defaultValue)
  }
  const defaults = Object.fromEntries(fields.filter(f => f.defaultValue !== undefined).map(f => [f.key, f.defaultValue]))
  if (Buffer.byteLength(JSON.stringify(defaults)) > 65536) fail("SCHEMA_TOO_LARGE", "字段默认值合计不能超过64 KiB。")
}
export function validateValue(field: CloudField, value: unknown): void {
  if (value === null) { if (field.required) fail("INVALID_VALUE", `${field.name}不能为空。`); return }
  let valid = false
  switch (field.type) {
    case "text": valid = typeof value === "string"; break
    case "integer": valid = Number.isSafeInteger(value); break
    case "number": valid = typeof value === "number" && Number.isFinite(value); break
    case "boolean": valid = typeof value === "boolean"; break
    case "date": valid = typeof value === "string" && /^\d{4}-\d{2}-\d{2}$/u.test(value) && !Number.isNaN(Date.parse(value)) && new Date(value).toISOString().slice(0, 10) === value; break
    case "datetime": valid = typeof value === "string" && /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d{1,3})?Z$/u.test(value) && !Number.isNaN(Date.parse(value)) && new Date(value).toISOString().slice(0, 10) === value.slice(0, 10); break
    case "url": try { valid = typeof value === "string" && ["http:", "https:"].includes(new URL(value).protocol) } catch { valid = false }; break
    case "singleSelect": valid = typeof value === "string" && Boolean(field.options?.some(o => o.key === value)); break
    case "multiSelect": valid = Array.isArray(value) && new Set(value).size === value.length && value.every(v => typeof v === "string" && field.options?.some(o => o.key === v)); break
    case "json": try { valid = value !== undefined && JSON.stringify(value) !== undefined } catch { valid = false }; break
  }
  if (!valid) fail("INVALID_VALUE", `${field.name}的值不符合字段类型。`)
}
export function normalizeValues(fields: CloudField[], input: Record<string, unknown>, existing?: Record<string, unknown>): Record<string, unknown> {
  const active = fields.filter(f => !f.archivedAt)
  if (Object.keys(input).some(k => !active.some(f => f.key === k))) fail("UNKNOWN_FIELD", "包含未知或归档字段。")
  const result: Record<string, unknown> = { ...existing }
  for (const f of active) {
    const value = Object.hasOwn(input, f.key) ? input[f.key] : existing && Object.hasOwn(existing, f.key) ? existing[f.key] : existing ? null : f.defaultValue ?? null
    validateValue(f, value)
    result[f.key] = f.type === "datetime" && typeof value === "string" ? new Date(value).toISOString() : value
  }
  if (Buffer.byteLength(JSON.stringify(result), "utf8") > 65536) fail("RECORD_TOO_LARGE", "单条记录不能超过64 KiB。", 413)
  return result
}
export type PermissionTable = { ownerId: string; anonymous: Partial<Record<CloudAction, boolean>>; members: CloudMember[] }
export function authorize(table: PermissionTable, userId: string | null, action: CloudAction | "manage"): CloudRange {
  if (userId === table.ownerId) return "all"
  if (action === "manage") fail("FORBIDDEN", "仅表主可管理。", 403)
  if (userId) {
    const permission = table.members.find(m => m.userId === userId)?.permissions[action]
    if (permission && permission !== "none") return permission
  }
  if (table.anonymous[action]) return "all"
  fail("FORBIDDEN", "没有执行此操作的权限。", 403)
}
