import { z } from "zod"

// Keep schema composition and JSON Schema generation on the same Zod instance.
export { z as cloudTableZod }

export const CLOUD_TABLE_BASE = "/api/open/v1/tables"
export const CLOUD_TABLE_SCHEMA_BYTES = 1048576
export const CLOUD_TABLE_FIELD_BYTES = 65536
export const CLOUD_TABLE_JSON_DEPTH = 32
export const CLOUD_TABLE_JSON_NODES = 50000
export const cloudActions = ["read", "create", "update", "delete"] as const
export const cloudJsonValue = z.json().meta({ id: "CloudTableJsonValue" })
export const fieldSchema = z.object({
  key: z.string().regex(/^[a-z][a-z0-9_]{0,63}$/u), name: z.string().trim().min(1).max(100),
  type: z.enum(["text", "integer", "number", "boolean", "date", "datetime", "singleSelect", "multiSelect", "url", "json"]),
  required: z.boolean().optional(), defaultValue: cloudJsonValue.optional(),
  options: z.array(z.object({ key: z.string().min(1).max(64), name: z.string().min(1).max(100) }).strict()).max(100).optional(),
}).strict()
export const createTableSchema = z.object({ name: z.string().trim().min(1).max(100), fields: z.array(fieldSchema).max(100).default([]) }).strict()
export const versionSchema = z.number().int().positive()
export const tableChangeSchema = z.object({ version: versionSchema, name: z.string().trim().min(1).max(100).optional(), fields: z.array(fieldSchema).max(100).optional() }).strict()
export const dailySummarySchema = z.object({
  dateField: fieldSchema.shape.key.describe("Date field of the private response table."),
  selectionField: fieldSchema.shape.key.describe("Text field containing the public catalog record ID."),
  flagField: fieldSchema.shape.key.describe("Boolean field counted when true."),
  catalogTableId: z.string().regex(/^[A-Za-z0-9_-]{1,128}$/u).describe("ID of a separate, publicly readable table owned by the response table owner."),
  catalogLabelField: fieldSchema.shape.key.describe("Public catalog text field used as the row label."),
  timeZone: z.string().min(1).max(100).describe("IANA time zone used to determine today's date, e.g. Asia/Shanghai."),
}).strict()
export const permissionsSchema = z.object({
  version: versionSchema,
  anonymous: z.object({ read: z.boolean(), create: z.boolean(), update: z.boolean(), delete: z.boolean() }).partial().strict(),
  members: z.array(z.object({ userId: z.string().min(1).max(128), permissions: z.object({ read: z.enum(["none", "own", "all"]), create: z.enum(["none", "all"]), update: z.enum(["none", "own", "all"]), delete: z.enum(["none", "own", "all"]) }).partial().strict() }).strict()).max(100),
  dailySummary: dailySummarySchema.nullable().optional().describe("Explicitly publish today's catalog counts; omit to preserve the setting, or pass null to disable. Does not grant record read access."),
  publicCount: z.boolean().optional().describe("Publish the total active record count without filters or record access. Omit to preserve the setting; false disables it."),
}).strict()
export const recordCreateSchema = z.object({ values: z.record(z.string(), cloudJsonValue) }).strict()
export const recordUpdateSchema = recordCreateSchema.extend({ version: versionSchema }).strict()
export const deleteRecordSchema = z.object({ version: versionSchema }).strict()
export const resolveCollaboratorSchema = z.object({ handle: z.string().trim().min(1).max(64) }).strict()
export const filterSchema = z.object({
  filters: z.array(z.object({ field: z.string().min(1).max(64), op: z.enum(["eq", "ne", "gt", "gte", "lt", "lte", "in", "contains"]), value: cloudJsonValue }).strict()).max(20).default([]).describe("活动业务字段或系统字段的条件；系统时间使用有效ISO时间，带Z或时区偏移，小数秒最多3位；contains允许text/url的字面子串。"),
  filterMode: z.enum(["all", "any"]).default("all"),
}).strict()
export const querySchema = filterSchema.extend({
  fields: z.array(z.string().min(1).max(64)).max(100).refine(keys => new Set(keys).size === keys.length, "返回字段不能重复。").meta({ uniqueItems: true }).optional(),
  sort: z.array(z.object({ field: z.string().min(1).max(64), direction: z.enum(["asc", "desc"]) }).strict()).max(3).default([]),
  cursor: z.string().max(131072).optional(), limit: z.number().int().min(1).max(100).default(50),
}).strict()
export const batchSchema = z.object({ operations: z.array(z.discriminatedUnion("action", [
  recordCreateSchema.extend({ action: z.literal("create") }),
  recordUpdateSchema.extend({ action: z.literal("update"), id: z.string().min(1).max(128) }),
  deleteRecordSchema.extend({ action: z.literal("delete"), id: z.string().min(1).max(128) }),
])).min(1).max(100) }).strict()
export const keyResourcesSchema = z.object({ mode: z.enum(["selected", "all_owned"]), tableIds: z.array(z.string().min(1).max(128)).max(500) }).strict().refine(v => new Set(v.tableIds).size === v.tableIds.length && (v.mode !== "all_owned" || v.tableIds.length === 0), "表资源范围无效。")
export type CloudQuery = z.infer<typeof querySchema>
export type CloudFilter = z.infer<typeof filterSchema>
export type CloudBatch = z.infer<typeof batchSchema>
export type CloudPermissions = z.infer<typeof permissionsSchema>
export type CloudDailySummary = z.infer<typeof dailySummarySchema>
