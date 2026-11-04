import {
  cloudTableZod as z, batchSchema, createTableSchema, deleteRecordSchema, filterSchema, permissionsSchema,
  querySchema, recordCreateSchema, recordUpdateSchema, resolveCollaboratorSchema, tableChangeSchema,
} from "@synapse/shared/cloud-table-contracts"
import type { CapabilityDomainDefinition, McpToolDefinition } from "../../../synapse-capabilities/shared/types"

const table = "/:tableId"
const records = "/:tableId/records"
const record = "/:tableId/records/:recordId"
const pathId = z.string().min(1).max(128).regex(/^[A-Za-z0-9_-]+$/u)
// GET /records/trash is a collection route, never an individual record.
const recordPathId = pathId.regex(/^(?![Tt][Rr][Aa][Ss][Hh]$)/u)
const pagination = " Pagination: cursor-based. Continue with nextCursor until null."
const idempotencyKey = z.string().regex(/^[A-Za-z0-9_-]{8,120}$/u).optional()
  .describe("Stable key for this write. Retry the same input and key within 24 hours after a lost response.")

type OperationOptions = { body?: z.ZodObject; cursor?: boolean; idempotent?: boolean; mutates?: boolean }

function operation(
  method: "GET" | "POST" | "PATCH" | "DELETE",
  path: string,
  title: string,
  description: string,
  options: OperationOptions = {},
) {
  const input = z.strictObject({
    ...options.body?.shape,
    ...(path.includes(":tableId") ? { tableId: pathId.describe("Cloud table ID from the table list or create result.") } : {}),
    ...(path.includes(":recordId") ? { recordId: recordPathId.describe("Record ID from this cloud table.") } : {}),
    ...(options.cursor ? { cursor: z.string().min(1).max(131072).optional() } : {}),
    ...(options.idempotent ? { idempotencyKey } : {}),
  })
  return { method, path, title, description, input, ...options }
}

export const cloudTableOperations = {
  "app.cloud_tables.publish_preflight.get": operation("GET", "/publish-preflight", "云表应用发布前检查", "Before creating or updating a public registration, survey, or voting page (报名页、征集页、问卷、投票), check the signed-in account, configured public base URL, and server features. local_only means local preview; external_verification_required needs an anonymous reachability check. Does not publish or grant permissions."),
  "app.cloud_tables.table.list": operation("GET", "", "列出云端数据表", "List my own and accessible collaborator cloud tables (云端数据表、云表目录). Read the actual table ID before operating." + pagination, { cursor: true }),
  "app.cloud_tables.table.create": operation("POST", "", "创建云端数据表", "Create a private cloud table owned by the signed-in user (新建云端数据表). Set typed fields and defaults in the same request. Returns id and schemaVersion.", { body: createTableSchema, idempotent: true, mutates: true }),
  "app.cloud_tables.table.get": operation("GET", table + "/schema", "读取云表结构", "Read a cloud table's fields, option keys, schemaVersion and current permissions. Only the owner sees collaborators and archived fields."),
  "app.cloud_tables.table.update": operation("PATCH", table, "修改云表字段或名称", "Owner only. Use the latest schemaVersion as version. When provided, fields replaces the full active field list; omitting an existing field archives it. Omit fields to rename only.", { body: tableChangeSchema, mutates: true }),
  "app.cloud_tables.permissions.update": operation("PATCH", table + "/permissions", "配置云表访问权限", "Owner only. Replaces anonymous record access and collaborators in full. Read the current schemaVersion and preserve unrelated settings. Require explicit user authorization for publishing. A public form enables anonymous.create. Set publicCount for the total or dailySummary for today's catalog counts without enabling anonymous.read. Omit either setting to preserve it; publicCount=false or dailySummary=null disables it.", { body: permissionsSchema, mutates: true }),
  "app.cloud_tables.collaborator.resolve": operation("POST", table + "/collaborators/resolve", "解析云表协作者", "Owner only. Resolve an exact Synapse username (handle) to a userId for cloud table permissions.", { body: resolveCollaboratorSchema }),
  "app.cloud_tables.table.delete": operation("DELETE", table, "将云表移入回收站", "Owner only. Move the specified cloud table to the 30-day trash using the latest schemaVersion as version.", { body: deleteRecordSchema, mutates: true }),
  "app.cloud_tables.table.trash.list": operation("GET", "/trash", "列出云表回收站", "List the signed-in user's own deleted cloud tables." + pagination, { cursor: true }),
  "app.cloud_tables.table.restore": operation("POST", table + "/restore", "恢复云端数据表", "Owner only. Restore the specified deleted cloud table within 30 days. Anonymous access is cleared on restore.", { mutates: true }),
  "app.cloud_tables.record.list": operation("POST", records + "/query", "查询云表记录", "Query accessible cloud table records by field, with projection, AND/OR filters and sorting. Read the schema first. Pagination: cursor-based. Pass nextCursor with the same query until null.", { body: querySchema }),
  "app.cloud_tables.record.count": operation("POST", records + "/count", "统计云表记录", "Return the exact number of readable cloud table records matching the filters, without fetching rows.", { body: filterSchema }),
  "app.cloud_tables.record.exists.get": operation("POST", records + "/exists", "判断云表记录是否存在", "Check whether any readable cloud table record matches the filters. This is not a deduplication guarantee.", { body: filterSchema }),
  "app.cloud_tables.record.get": operation("GET", record, "读取一条云表记录", "Read one accessible cloud table record and its current version."),
  "app.cloud_tables.record.create": operation("POST", records, "新增云表记录", "Create a cloud table record as the signed-in user. Use field and option keys from the live schema. Returns id and version.", { body: recordCreateSchema, idempotent: true, mutates: true }),
  "app.cloud_tables.record.update": operation("PATCH", record, "修改云表记录", "Patch supplied record values using the latest record version. Omitted values are preserved.", { body: recordUpdateSchema, idempotent: true, mutates: true }),
  "app.cloud_tables.record.delete": operation("DELETE", record, "将云表记录移入回收站", "Move the specified cloud table record to the 30-day trash using its latest version.", { body: deleteRecordSchema, idempotent: true, mutates: true }),
  "app.cloud_tables.record.batch.apply": operation("POST", records + "/batch", "批量写入云表记录", "Atomically create, update, or delete up to 100 records in one cloud table. Every operation is authorized independently and must succeed for the batch to commit.", { body: batchSchema, idempotent: true, mutates: true }),
  "app.cloud_tables.record.trash.list": operation("GET", records + "/trash", "列出云表记录回收站", "Owner only. List deleted records of this cloud table." + pagination, { cursor: true }),
  "app.cloud_tables.record.restore": operation("POST", record + "/restore", "恢复云表记录", "Owner only. Restore the specified deleted record within 30 days if it still satisfies the current schema.", { mutates: true }),
  "app.cloud_tables.log.list": operation("GET", table + "/logs", "查看云表操作日志", "Owner only. List recent cloud table operation metadata. Logs do not include record values." + pagination, { cursor: true }),
} as const

export type CloudTableAction = keyof typeof cloudTableOperations

export function isCloudTableAction(action: string): action is CloudTableAction {
  return Object.hasOwn(cloudTableOperations, action)
}

const actions = Object.keys(cloudTableOperations) as CloudTableAction[]
const toolName = (action: CloudTableAction) => action.replaceAll(".", "_")

export const CLOUD_TABLES_DOMAIN: CapabilityDomainDefinition = {
  id: "cloud_tables",
  capabilities: actions.map(id => {
    const { title, description, mutates } = cloudTableOperations[id]
    return { id, title, description, mutates: Boolean(mutates) }
  }),
}

export const CLOUD_TABLES_MCP_TOOL_ACTIONS = Object.fromEntries(actions.map(action => [toolName(action), action]))

export function buildCloudTableTools(): McpToolDefinition[] {
  return actions.map(action => {
    const { description, input } = cloudTableOperations[action]
    const { $schema: _dialect, ...schema } = z.toJSONSchema(input, { io: "input" })
    if (!schema.properties) throw new Error("Cloud table discovery requires object input")
    return {
      name: toolName(action),
      description: description + " Permissions: network.connect; signed-in desktop account and existing cloud table permissions.",
      inputSchema: { ...schema, type: "object", properties: schema.properties, additionalProperties: false },
    }
  })
}
