import { cloudTableZod as z, batchSchema, createTableSchema, deleteRecordSchema, fieldSchema, filterSchema, permissionsSchema, querySchema, recordCreateSchema, recordUpdateSchema, resolveCollaboratorSchema, tableChangeSchema } from "./cloud-table-contract"

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
  const idem = { name: "Idempotency-Key", in: "header", description: "建表或记录写入的幂等键，8至120个字母、数字、下划线或连字符；24小时内重试保持相同键和请求。", schema: { type: "string", pattern: "^[A-Za-z0-9_-]{8,120}$" } }
  const paths: Record<string, Record<string, unknown>> = {}
  const routes: [string, string, string, z.ZodType | null, boolean, boolean?][] = [
    ["", "get", "listCloudTables", null, false, true], ["", "post", "createCloudTable", createTableSchema, false],
    ["/trash", "get", "listDeletedCloudTables", null, false, true],
    ["/{id}", "get", "getCloudTable", null, true], ["/{id}", "patch", "updateCloudTable", tableChangeSchema, false], ["/{id}", "delete", "deleteCloudTable", deleteRecordSchema, false],
    ["/{id}/schema", "get", "getCloudTableSchema", null, true],
    ["/{id}/permissions", "patch", "setCloudTablePermissions", permissionsSchema, false], ["/{id}/restore", "post", "restoreCloudTable", null, false],
    ["/{id}/collaborators/resolve", "post", "resolveCloudTableCollaborator", resolveCollaboratorSchema, false],
    ["/{id}/logs", "get", "listCloudTableLogs", null, false, true],
    ["/{id}/records/query", "post", "queryCloudTableRecords", querySchema, true], ["/{id}/records/batch", "post", "mutateCloudTableRecords", batchSchema, true],
    ["/{id}/records/count", "post", "countCloudTableRecords", filterSchema, true], ["/{id}/records/exists", "post", "existsCloudTableRecords", filterSchema, true],
    ["/{id}/records/trash", "get", "listDeletedCloudTableRecords", null, false, true],
    ["/{id}/records", "post", "createCloudTableRecord", recordCreateSchema, true],
    ["/{id}/records/{recordId}", "get", "getCloudTableRecord", null, true], ["/{id}/records/{recordId}", "patch", "updateCloudTableRecord", recordUpdateSchema, true], ["/{id}/records/{recordId}", "delete", "deleteCloudTableRecord", deleteRecordSchema, true],
    ["/{id}/records/{recordId}/restore", "post", "restoreCloudTableRecord", null, false],
  ]
  const usage: Record<string, [string, string]> = {
    listCloudTables: ["列出已授权的数据表", "需任一云表scope，按密钥资源范围列出自己的表或有可用权限的协作表；协作权限与密钥scope没有交集时不列出。匿名不能列目录。列表不含字段，操作前读取表结构；使用nextCursor继续分页。"],
    createCloudTable: ["在密钥所属用户账号下建表", "需tables.manage及all_owned（自己的全部表）资源范围，不必先在Console手工建表；selected密钥不能建表。新表归密钥所属用户且默认私有，返回id与schemaVersion。"],
    getCloudTable: ["读取表配置与当前权限", "需至少一项可用的表权限及相应scope。表主可见协作者与归档字段；其他用户仅见活动字段。匿名须有至少一项开放操作，仅返回id、schemaVersion、fields。"],
    getCloudTableSchema: ["发现字段与结构版本", "认证与返回规则同读取表配置。先读取实际字段key、类型、选项key与schemaVersion，不凭显示名构造调用。"],
    updateCloudTable: ["修改表名、配置字段与恢复归档字段", "仅表主，需tables.manage。version取最新schemaVersion；fields完整替换活动字段列表，省略已有key会归档该字段，不传fields则保持字段不变。30天内按原key恢复归档字段；非空数据不允许不兼容的类型或选项变更。"],
    setCloudTablePermissions: ["配置匿名操作与协作者权限", "仅表主，需tables.manage。version取最新schemaVersion；anonymous与members完整替换原配置，省略操作关闭、遗漏协作者撤权。用户须授权本次开放或授权调整；不得为完成普通读写自动公开表或扩大权限。"],
    deleteCloudTable: ["删除表并移入30天回收站", "仅表主，需tables.manage及当前schemaVersion作为version；删除后普通读取不可见，30天内可恢复。"],
    listDeletedCloudTables: ["列出自己的表回收站", "需任一云表scope，按密钥资源范围仅列本人30天内删除的表；不包含协作表。使用nextCursor继续分页。"],
    restoreCloudTable: ["恢复已删除的数据表", "仅表主，需tables.manage；30天内可恢复，恢复后关闭全部匿名操作；活动表返回409 NOT_DELETED，不改变权限。此操作不支持幂等键保证。"],
    resolveCloudTableCollaborator: ["通过SY用户名解析协作者", "仅表主，需tables.manage。传准确handle，不传邮箱、不猜userId；取得用户id后再写入members授权。"],
    listCloudTableLogs: ["读取数据表操作记录", "仅表主，需tables.manage。仅含固定诊断元数据，不含记录正文、密钥或Cookie；使用nextCursor继续分页。"],
    queryCloudTableRecords: ["筛选、排序与分页查询记录", "需tables.records.read及表的读取授权，own只返回本人创建记录；或显式开放匿名查询。最多20筛选、3排序，每页默认50最多100条。filterMode默认all（AND），any为同级OR，空条件均表示无业务筛选；不支持嵌套分组。fields省略返回全部活动业务字段，空数组返回空values，最多100个不重复的活动业务字段key；系统元数据仍返回，筛选排序可使用未返回字段。nextCursor非空时继续查询，筛选、模式、投影、排序、身份或结构版本变化后重查首页；不是快照，不附带总数。"],
    countCloudTableRecords: ["统计当前可读的匹配记录数", "需tables.records.read及表的读取授权，own仅统计本人创建且未删除记录；或显式开放匿名查询。只接受filters和filterMode，最多20条件，默认all（AND），any为同级OR，空条件表示无业务筛选。返回精确count，不读取记录正文，无分页和排序；超出安全整数返回400 COUNT_TOO_LARGE，SQL超时返回503。与另一次查询不保证同一快照，不支持写入幂等键。"],
    existsCloudTableRecords: ["判断当前可读的匹配记录是否存在", "需tables.records.read及表的读取授权，own仅检查本人创建且未删除记录；或显式开放匿名查询。只接受filters和filterMode，最多20条件，默认all（AND），any为同级OR，空条件表示无业务筛选。返回exists布尔值，找到一条即可结束，不返回正文，无分页和排序；不提供并发去重保证，不支持写入幂等键。"],
    mutateCloudTableRecords: ["原子批量新增、修改与删除记录", "按每个操作要求tables.records.create/update/delete及表授权，匿名也须逐项开放。1至100项且全成全败；update/delete必须传各记录version，返回最小确认数组，不返回记录正文。"],
    listDeletedCloudTableRecords: ["读取记录回收站", "仅表主，需tables.manage。返回30天内删除记录；使用nextCursor继续分页。协作者的记录删除权限不包含回收站管理。"],
    createCloudTableRecord: ["新增记录", "需tables.records.create及表新增授权，或显式开放匿名新增。values按活动字段key传值，创建者由服务端设置，匿名创建者为null；只返回id与version，不代表拥有读取权限。"],
    getCloudTableRecord: ["读取指定记录", "需tables.records.read及表读取授权，或显式开放匿名查询。own范围不能读取他人或匿名记录；不在可见范围内返回404。"],
    updateCloudTableRecord: ["按版本修改记录", "需tables.records.update及表修改授权，或显式开放匿名修改。传当前记录version和要修改的values；未传字段保留原值，不允许修改创建者。冲突409需重读；只返回id与version。"],
    deleteCloudTableRecord: ["按版本删除记录", "需tables.records.delete及表删除授权，或显式开放匿名删除。传当前记录version；删除后仅表主可在30天内恢复，只返回id与version。"],
    restoreCloudTableRecord: ["恢复已删除的记录", "仅表主，需tables.manage。恢复时检查当前字段结构，不兼容返回409；并发变化返回409 VERSION_CONFLICT，只返回实际提交的id与version。此操作不支持幂等键保证。"],
  }
  const error = { description: "请求失败；通过X-Request-Id定位，503包含Retry-After。", content: { "application/json": { schema: { type: "object", required: ["requestId", "error"], properties: { requestId: { type: "string" }, error: { type: "object", required: ["code", "message"], properties: { code: { type: "string" }, message: { type: "string" } } } } } } } }
  const row = { type: "object", required: ["id", "values", "version", "creatorUserId", "createdAt", "updatedAt", "deletedAt"], properties: { id: { type: "string" }, values: { type: "object", additionalProperties: true }, version: { type: "integer", minimum: 1 }, creatorUserId: { type: ["string", "null"] }, createdAt: { type: "string", format: "date-time" }, updatedAt: { type: "string", format: "date-time" }, deletedAt: { type: ["string", "null"] } } }
  const outputField = schema(fieldSchema.extend({ archivedAt: z.string().nullable().optional() }))
  const outputMembers = schema(permissionsSchema.shape.members.element.extend({ handle: z.string().optional(), nickname: z.string().optional() }).array())
  const table = { type: "object", additionalProperties: false, required: ["id", "ownerId", "viewerId", "name", "schemaVersion", "fields", "anonymous", "permissions", "deletedAt", "createdAt"], properties: { id: { type: "string" }, ownerId: { type: "string" }, viewerId: { type: "string" }, name: { type: "string" }, schemaVersion: { type: "integer" }, fields: { type: "array", items: outputField }, anonymous: (schema(permissionsSchema).properties as Record<string, unknown>).anonymous, permissions: { type: "object", additionalProperties: { type: "string", enum: ["none", "own", "all"] } }, members: outputMembers, deletedAt: { type: ["string", "null"] }, createdAt: { type: "string", format: "date-time" } } }
  const confirmation = { type: "object", additionalProperties: false, required: ["id", "version"], properties: { id: { type: "string" }, version: { type: "integer" } } }
  const page = (item: unknown) => ({ type: "object", additionalProperties: false, required: ["data", "nextCursor"], properties: { data: { type: "array", items: item }, nextCursor: { type: ["string", "null"] } } })
  const summary = { ...table, required: table.required.filter(key => !["fields", "anonymous"].includes(key)), properties: Object.fromEntries(Object.entries(table.properties).filter(([key]) => !["fields", "anonymous", "members"].includes(key))) }
  const details = { anyOf: [table, { type: "object", additionalProperties: false, required: ["id", "schemaVersion", "fields"], properties: { id: table.properties.id, schemaVersion: table.properties.schemaVersion, fields: table.properties.fields } }] }
  const tableConfirmation = { type: "object", additionalProperties: false, required: ["id", "schemaVersion"], properties: { id: { type: "string" }, schemaVersion: { type: "integer", minimum: 1 } } }
  const log = { type: "object", additionalProperties: false, required: ["id", "ownerId", "tableId", "actorId", "apiKeyId", "requestId", "operation", "status", "durationMs", "createdAt"], properties: {
    id: { type: "string" }, ownerId: { type: "string" }, tableId: { type: ["string", "null"] }, actorId: { type: ["string", "null"] }, apiKeyId: { type: ["string", "null"] },
    requestId: { type: "string" }, operation: { type: "string" }, status: { type: "integer" }, durationMs: { type: "integer", minimum: 0 }, createdAt: { type: "string", format: "date-time" },
  } }
  const responseSchemas: Record<string, unknown> = {
    listCloudTables: page(summary), listDeletedCloudTables: page(summary), createCloudTable: tableConfirmation,
    getCloudTable: details, getCloudTableSchema: details, updateCloudTable: table,
    setCloudTablePermissions: { type: "object", additionalProperties: false, required: ["schemaVersion"], properties: { schemaVersion: { type: "integer", minimum: 1 } } },
    deleteCloudTable: tableConfirmation, restoreCloudTable: tableConfirmation,
    resolveCloudTableCollaborator: { type: "object", additionalProperties: false, required: ["id", "handle"], properties: { id: { type: "string" }, handle: { type: "string" } } },
    listCloudTableLogs: page(log), queryCloudTableRecords: page(row), listDeletedCloudTableRecords: page(row),
    getCloudTableRecord: row, createCloudTableRecord: confirmation, updateCloudTableRecord: confirmation, deleteCloudTableRecord: confirmation, restoreCloudTableRecord: confirmation,
    mutateCloudTableRecords: { type: "object", additionalProperties: false, required: ["data"], properties: { data: { type: "array", minItems: 1, maxItems: 100, items: confirmation } } },
    countCloudTableRecords: { type: "object", additionalProperties: false, required: ["count"], properties: { count: { type: "integer", minimum: 0, maximum: Number.MAX_SAFE_INTEGER } } },
    existsCloudTableRecords: { type: "object", additionalProperties: false, required: ["exists"], properties: { exists: { type: "boolean" } } },
  }
  for (const [suffix, method, operationId, body, anonymous, paged] of routes) {
    const [summary, instruction] = usage[operationId]!
    const idempotent = ["createCloudTable", "createCloudTableRecord", "updateCloudTableRecord", "deleteCloudTableRecord", "mutateCloudTableRecords"].includes(operationId)
    const parameters = [...(suffix.includes("{id}") ? [id] : []), ...(suffix.includes("{recordId}") ? [recordId] : []), ...(paged ? [cursor] : []), ...(idempotent ? [idem] : [])]
    const responseSchema = responseSchemas[operationId]
    if (!responseSchema) throw new Error(`Missing cloud-table response schema: ${operationId}`)
    paths[`/tables${suffix}`] ??= {}
    paths[`/tables${suffix}`]![method] = { operationId, summary, tags: ["云端数据表"], description: `${instruction} 开放接口仅识别用户本人的API密钥或匿名身份，忽略Cookie，不接受普通登录Token；密钥同时受scope、表资源范围及当前表授权约束，协作者不能通过tables.manage成为表主。官方Console与桌面MCP使用独立的账号通路。`, security: anonymous ? [{}, { ApiKeyBearer: [] }] : [{ ApiKeyBearer: [] }], parameters, ...(body ? { requestBody: { required: true, content: { "application/json": { schema: schema(body) } } } } : {}), responses: { [method === "post" ? "201" : "200"]: { description: "成功", content: { "application/json": { schema: responseSchema } } }, "400": error, "401": error, "403": error, "404": error, "409": error, "413": error, "503": error } }
  }
  return paths
}
