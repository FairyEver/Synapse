import { z } from "zod"
import { batchSchema, createTableSchema, deleteRecordSchema, fieldSchema, permissionsSchema, querySchema, recordCreateSchema, recordUpdateSchema, tableChangeSchema } from "./cloud-table-contract"

export const CLOUD_TABLE_JSON_SCHEMA = { anyOf: [
  { type: "string" }, { type: "number" }, { type: "boolean" }, { type: "null" },
  { type: "array", items: { $ref: "#/components/schemas/CloudTableJsonValue" } },
  { type: "object", additionalProperties: { $ref: "#/components/schemas/CloudTableJsonValue" } },
] }
function schema(value: z.ZodType): Record<string, unknown> {
  const { $schema: _dialect, $defs: _localDefs, ...result } = z.toJSONSchema(value, { io: "input" })
  // 嵌套请求中的递归JSON引用提升为OpenAPI组件，避免悬空的根级$defs指针。
  return JSON.parse(JSON.stringify(result, (key, v: unknown) => {
    if (key === "$ref" && typeof v === "string" && v.startsWith("#/$defs/")) {
      if (!["#/$defs/CloudTableJsonValue", "#/$defs/__schema0"].includes(v)) throw new Error("Unexpected cloud-table schema reference")
      return "#/components/schemas/CloudTableJsonValue"
    }
    return v
  })) as Record<string, unknown>
}
export function cloudTableOpenApiPaths() {
  const id = { name: "id", in: "path", required: true, schema: { type: "string" } }
  const recordId = { name: "recordId", in: "path", required: true, schema: { type: "string" } }
  const cursor = { name: "cursor", in: "query", schema: { type: "string" } }
  const idem = { name: "Idempotency-Key", in: "header", description: "记录写入的幂等键，8至120个字母、数字、下划线或连字符；重试保持相同键和请求。", schema: { type: "string", pattern: "^[A-Za-z0-9_-]{8,120}$" } }
  const paths: Record<string, Record<string, unknown>> = {}
  const routes: [string, string, string, z.ZodType | null, boolean, boolean?][] = [
    ["", "get", "listCloudTables", null, false, true], ["", "post", "createCloudTable", createTableSchema, false],
    ["/trash", "get", "listDeletedCloudTables", null, false, true],
    ["/{id}", "get", "getCloudTable", null, true], ["/{id}", "patch", "updateCloudTable", tableChangeSchema, false], ["/{id}", "delete", "deleteCloudTable", deleteRecordSchema, false],
    ["/{id}/schema", "get", "getCloudTableSchema", null, true],
    ["/{id}/permissions", "patch", "setCloudTablePermissions", permissionsSchema, false], ["/{id}/restore", "post", "restoreCloudTable", null, false],
    ["/{id}/collaborators/resolve", "post", "resolveCloudTableCollaborator", z.object({ handle: z.string().min(1).max(64) }).strict(), false],
    ["/{id}/logs", "get", "listCloudTableLogs", null, false, true],
    ["/{id}/records/query", "post", "queryCloudTableRecords", querySchema, true], ["/{id}/records/batch", "post", "mutateCloudTableRecords", batchSchema, true],
    ["/{id}/records/trash", "get", "listDeletedCloudTableRecords", null, false, true],
    ["/{id}/records", "post", "createCloudTableRecord", recordCreateSchema, true],
    ["/{id}/records/{recordId}", "get", "getCloudTableRecord", null, true], ["/{id}/records/{recordId}", "patch", "updateCloudTableRecord", recordUpdateSchema, true], ["/{id}/records/{recordId}", "delete", "deleteCloudTableRecord", deleteRecordSchema, true],
    ["/{id}/records/{recordId}/restore", "post", "restoreCloudTableRecord", null, false],
  ]
  const error = { description: "请求失败；通过X-Request-Id定位，503包含Retry-After。", content: { "application/json": { schema: { type: "object", required: ["requestId", "error"], properties: { requestId: { type: "string" }, error: { type: "object", required: ["code", "message"], properties: { code: { type: "string" }, message: { type: "string" } } } } } } } }
  const row = { type: "object", required: ["id", "values", "version", "creatorUserId", "createdAt", "updatedAt", "deletedAt"], properties: { id: { type: "string" }, values: { type: "object", additionalProperties: true }, version: { type: "integer", minimum: 1 }, creatorUserId: { type: ["string", "null"] }, createdAt: { type: "string", format: "date-time" }, updatedAt: { type: "string", format: "date-time" }, deletedAt: { type: ["string", "null"] } } }
  const outputField = schema(fieldSchema.extend({ archivedAt: z.string().nullable().optional() }))
  const outputMembers = schema(permissionsSchema.shape.members.element.extend({ handle: z.string().optional() }).array())
  const table = { type: "object", properties: { id: { type: "string" }, ownerId: { type: "string" }, viewerId: { type: "string" }, name: { type: "string" }, schemaVersion: { type: "integer" }, fields: { type: "array", items: outputField }, anonymous: (schema(permissionsSchema).properties as Record<string, unknown>).anonymous, permissions: { type: "object", additionalProperties: { type: "string", enum: ["none", "own", "all"] } }, members: outputMembers, deletedAt: { type: ["string", "null"] }, createdAt: { type: "string", format: "date-time" } } }
  const confirmation = { type: "object", required: ["id", "version"], properties: { id: { type: "string" }, version: { type: "integer" } } }
  const page = (item: unknown) => ({ type: "object", required: ["data", "nextCursor"], properties: { data: { type: "array", items: item }, nextCursor: { type: ["string", "null"] } } })
  for (const [suffix, method, operationId, body, anonymous, paged] of routes) {
    const parameters = [...(suffix.includes("{id}") ? [id] : []), ...(suffix.includes("{recordId}") ? [recordId] : []), ...(paged ? [cursor] : []), ...((method !== "get" && suffix.includes("/records")) || operationId === "createCloudTable" ? [idem] : [])]
    const mutation = ["createCloudTableRecord", "updateCloudTableRecord", "deleteCloudTableRecord", "restoreCloudTableRecord"].includes(operationId)
    let responseSchema: unknown = mutation ? confirmation : operationId === "mutateCloudTableRecords" ? { type: "object", properties: { data: { type: "array", items: confirmation } } } : operationId === "queryCloudTableRecords" || operationId === "listDeletedCloudTableRecords" ? page(row) : operationId === "getCloudTableRecord" ? row : operationId === "listCloudTables" || operationId === "listDeletedCloudTables" ? page(table) : operationId === "listCloudTableLogs" ? page({ type: "object" }) : operationId === "createCloudTable" || operationId === "setCloudTablePermissions" || operationId === "deleteCloudTable" || operationId === "restoreCloudTable" ? { type: "object", properties: { id: { type: "string" }, schemaVersion: { type: "integer" } } } : operationId === "resolveCloudTableCollaborator" ? { type: "object", properties: { id: { type: "string" }, handle: { type: "string" } } } : table
    paths[`/tables${suffix}`] ??= {}
    paths[`/tables${suffix}`]![method] = { operationId, tags: ["云端数据表"], description: "身份为API密钥或匿名，忽略Cookie与普通登录Token；密钥需相应scope及表资源授权，并执行表ACL。记录写入只返回最小确认。", security: anonymous ? [{}, { ApiKeyBearer: [] }] : [{ ApiKeyBearer: [] }], parameters, ...(body ? { requestBody: { required: true, content: { "application/json": { schema: schema(body) } } } } : {}), responses: { [method === "post" ? "201" : "200"]: { description: "成功", content: { "application/json": { schema: responseSchema } } }, "400": error, "401": error, "403": error, "404": error, "409": error, "413": error, "503": error } }
  }
  return paths
}
