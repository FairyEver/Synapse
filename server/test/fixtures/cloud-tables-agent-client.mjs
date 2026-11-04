// 独立HTTP客户端：仅使用公开文档/OpenAPI与用户交付的密钥，不导入应用代码。
import assert from "node:assert/strict"
import { createHash, randomUUID } from "node:crypto"
import { readFile } from "node:fs/promises"

const base = new URL(process.env.SY_API_BASE_URL)
assert(["127.0.0.1", "localhost", "[::1]"].includes(base.hostname), "This destructive scenario requires the isolated loopback test API")
assert.equal(process.env.DATABASE_URL, undefined)
const documentUrl = process.env.SY_API_DOCUMENT_PATH ?? "https://synapse.d2.pub/document/open-api/api/cloud-tables"
async function loadMarkdown() {
  // 发布前验收读取本次文档，并以隔离API替换与文档构建相同的部署占位符。
  if (process.env.SY_API_DOCUMENT_PATH) return (await readFile(documentUrl, "utf8")).replaceAll("{{APP_PUBLIC_URL}}", base.origin)
  const documentResponse = await fetch(documentUrl)
  assert.equal(documentResponse.status, 200)
  const html = await documentResponse.text()
  const modulePath = [...html.matchAll(/(?:src|href)="([^"]+cloud-tables[^"]+\.js)"/g)][0]?.[1]
  assert(modulePath, "Published document must expose its Markdown page data")
  const moduleSource = await fetch(new URL(modulePath, documentUrl)).then(r => { assert.equal(r.status, 200); return r.text() })
  const literal = /JSON\.parse\('((?:[^'\\]|\\.)*)'\)/u.exec(moduleSource)?.[1]
  assert(literal, "Cannot extract published copy-Markdown data")
  // 只解码打包器的字符串转义，不执行文档站JavaScript。
  return JSON.parse(literal.replace(/\\(['\\])/gu, "$1")).copyMarkdown
}
const markdown = await loadMarkdown()
assert(markdown.includes("从零建表到管理数据"))
assert(markdown.includes("管理操作的身份边界"))
const contractUrl = markdown.match(/https?:\/\/[^\s|)`]+\/api\/open\/openapi\.json/u)?.[0]
assert(contractUrl)
const contract = await fetch(contractUrl).then(r => { assert.equal(r.status, 200); return r.json() })
const apiPrefix = contract.servers[0].url
assert.equal(apiPrefix, "/api/open/v1")
const operations = new Map(Object.entries(contract.paths).filter(([p]) => p === "/tables" || p.startsWith("/tables/")).flatMap(([path, methods]) => Object.entries(methods).map(([method, operation]) => [operation.operationId, { path, method: method.toUpperCase(), ...operation }])))
assert.equal(operations.size, 23)
const trace = [], successful = new Set()
const keys = { owner: process.env.SY_API_KEY, collaborator: process.env.SY_COLLAB_API_KEY, anonymous: undefined }
assert(keys.owner && keys.collaborator)

async function call(operationId, { params = {}, body, identity = "owner", status, code, idempotencyKey } = {}) {
  const operation = operations.get(operationId)
  assert(operation, `Undocumented operation ${operationId}`)
  const path = operation.path.replace(/\{([^}]+)\}/gu, (_, key) => { assert(params[key], `Missing ${key}`); return encodeURIComponent(params[key]) })
  const expectedStatus = status ?? (operation.method === "POST" ? 201 : 200)
  const response = await fetch(new URL(`${apiPrefix}${path}`, base), {
    method: operation.method, credentials: "omit", signal: AbortSignal.timeout(15000),
    headers: { ...(keys[identity] ? { Authorization: `Bearer ${keys[identity]}` } : {}), ...(body === undefined ? {} : { "Content-Type": "application/json" }), ...(idempotencyKey ? { "Idempotency-Key": idempotencyKey } : {}) },
    ...(body === undefined ? {} : { body: JSON.stringify(body) }),
  })
  const value = await response.json()
  trace.push({ operationId, identity, method: operation.method, path, status: response.status, ...(value.error ? { code: value.error.code } : {}), requestId: response.headers.get("x-request-id") })
  assert.equal(response.status, expectedStatus, `${operationId}: ${JSON.stringify(value)}`)
  assert(response.headers.get("x-request-id"))
  if (code) assert.equal(value.error.code, code)
  if (response.ok) successful.add(operationId)
  return value
}

// 从公开请求schema中投影允许提交的属性，不把响应的只读属性原样写回。
function allowedInput(operationId, property, value) {
  const schema = operations.get(operationId).requestBody.content["application/json"].schema.properties[property].items
  return Object.fromEntries(Object.entries(value).filter(([key]) => Object.hasOwn(schema.properties, key)))
}

try {
  const initial = await call("listCloudTables")
  assert.equal(initial.data.length, 0, "Agent starts with no existing own tables")
  const table = await call("createCloudTable", { body: { name: "Agent客户跟进", fields: [] }, idempotencyKey: randomUUID() })
  const params = { id: table.id }
  let schema = await call("getCloudTableSchema", { params })
  const ownerId = schema.ownerId
  assert.equal(schema.viewerId, ownerId)
  assert.deepEqual(schema.anonymous, {})
  assert.deepEqual(schema.fields, [])
  const fields = [{ key: "name", name: "姓名", type: "text", required: true }, { key: "score", name: "评分", type: "integer", defaultValue: 0 }, { key: "status", name: "状态", type: "singleSelect", defaultValue: "new", options: [{ key: "new", name: "待跟进" }, { key: "done", name: "已跟进" }] }, { key: "note", name: "备注", type: "text" }, { key: "date", name: "日期", type: "date" }, { key: "flag", name: "标记", type: "boolean" }]
  schema = await call("updateCloudTable", { params, body: { version: schema.schemaVersion, name: "Agent自动管理的客户", fields } })
  assert.equal(schema.fields.length, 6)
  assert.equal(schema.name, "Agent自动管理的客户")
  const member = await call("resolveCloudTableCollaborator", { params, body: { handle: process.env.SY_OTHER_HANDLE } })
  await call("setCloudTablePermissions", { params, body: { version: schema.schemaVersion, anonymous: {}, members: [{ userId: member.id, permissions: { read: "own", create: "all", update: "own", delete: "own" } }] } })
  schema = await call("getCloudTable", { params })
  assert.equal(schema.members[0].userId, member.id)

  const body = { values: { name: "张三", score: 87, note: "API录入" } }, idempotencyKey = randomUUID()
  const row = await call("createCloudTableRecord", { params, body, idempotencyKey })
  assert.deepEqual(await call("createCloudTableRecord", { params, body, idempotencyKey }), row)
  assert.deepEqual(Object.keys(row).sort(), ["id", "version"])
  const recordParams = { ...params, recordId: row.id }
  let record = await call("getCloudTableRecord", { params: recordParams })
  assert.equal(record.creatorUserId, ownerId)
  assert.equal(record.values.status, "new")
  let query = await call("queryCloudTableRecords", { params, body: { filters: [{ field: "score", op: "gte", value: 80 }], sort: [{ field: "score", direction: "desc" }], limit: 50 } })
  assert.deepEqual(query.data.map(r => r.id), [row.id])
  const updated = await call("updateCloudTableRecord", { params: recordParams, body: { version: record.version, values: { status: "done" } } })
  await call("updateCloudTableRecord", { params: recordParams, body: { version: record.version, values: { status: "new" } }, status: 409, code: "VERSION_CONFLICT" })
  record = await call("getCloudTableRecord", { params: recordParams })
  assert.equal(record.values.name, "张三"); assert.equal(record.values.status, "done")
  const batch = await call("mutateCloudTableRecords", { params, body: { operations: [{ action: "create", values: { name: "李四" } }, { action: "create", values: { name: "王五", score: 60 } }, { action: "update", id: row.id, version: updated.version, values: { score: 90 } }] }, idempotencyKey: randomUUID() })
  assert.equal(batch.data.length, 3)
  let cursor, all = []
  do {
    query = await call("queryCloudTableRecords", { params, body: { limit: 1, ...(cursor ? { cursor } : {}) } })
    all.push(...query.data); cursor = query.nextCursor
  } while (cursor)
  assert.equal(all.length, 3); assert.equal(new Set(all.map(r => r.id)).size, 3)
  assert.equal(all.find(r => r.values.name === "李四").values.score, 0)
  const match = { filters: [{ field: "score", op: "gte", value: 80 }, { field: "name", op: "eq", value: "李四" }], filterMode: "any" }
  assert.deepEqual(await call("countCloudTableRecords", { params, body: match }), { count: 2 })
  assert.deepEqual(await call("existsCloudTableRecords", { params, body: { filters: [{ field: "name", op: "eq", value: "不存在" }] } }), { exists: false })
  const projected = await call("queryCloudTableRecords", { params, body: { ...match, fields: ["name"], sort: [{ field: "score", direction: "desc" }] } })
  assert.deepEqual(projected.data.map(r => r.values), [{ name: "张三" }, { name: "李四" }])

  schema = await call("getCloudTableSchema", { params })
  const active = schema.fields.filter(f => !f.archivedAt).map(f => allowedInput("updateCloudTable", "fields", f))
  await call("updateCloudTable", { params, body: { version: schema.schemaVersion, fields: active.filter(f => f.key !== "note") } })
  assert(!Object.hasOwn((await call("getCloudTableRecord", { params: recordParams })).values, "note"))
  schema = await call("getCloudTableSchema", { params })
  await call("updateCloudTable", { params, body: { version: schema.schemaVersion, fields: active.map(f => f.key === "name" ? { ...f, name: "客户姓名" } : f) } })
  assert.equal((await call("getCloudTableRecord", { params: recordParams })).values.note, "API录入")

  schema = await call("getCloudTable", { params })
  const members = schema.members.map(m => allowedInput("setCloudTablePermissions", "members", m))
  const catalog = await call("createCloudTable", { body: { name: "公开目录", fields: [fields[0]] } })
  await call("setCloudTablePermissions", { params: { id: catalog.id }, body: { version: 1, anonymous: { read: true }, members: [] } })
  const dailySummary = { dateField: "date", selectionField: "note", flagField: "flag", catalogTableId: catalog.id, catalogLabelField: "name", timeZone: "Asia/Shanghai" }
  await call("setCloudTablePermissions", { params, body: { version: schema.schemaVersion, anonymous: { create: true }, members, dailySummary, publicCount: true } })
  const daily = await call("getCloudTableDailySummary", { params, identity: "anonymous" })
  assert.deepEqual(daily.other, { selections: 0, flagged: 0 })
  const anon = await call("createCloudTableRecord", { params, body: { values: { name: "匿名报名" } }, identity: "anonymous" })
  assert.equal((await call("getCloudTableRecord", { params: { ...params, recordId: anon.id } })).creatorUserId, null)
  assert.deepEqual(await call("getCloudTablePublicCount", { params, identity: "anonymous" }), { count: 4 })
  await call("queryCloudTableRecords", { params, body: {}, identity: "anonymous", status: 403, code: "FORBIDDEN" })
  schema = await call("getCloudTable", { params })
  assert.equal(schema.members[0].userId, member.id)
  await call("setCloudTablePermissions", { params, body: { version: schema.schemaVersion, anonymous: {}, members, dailySummary: null, publicCount: false } })

  record = await call("getCloudTableRecord", { params: recordParams })
  await call("deleteCloudTableRecord", { params: recordParams, body: { version: record.version } })
  await call("getCloudTableRecord", { params: recordParams, status: 404, code: "NOT_FOUND" })
  assert((await call("listDeletedCloudTableRecords", { params })).data.some(r => r.id === row.id))
  await call("restoreCloudTableRecord", { params: recordParams })
  assert.equal((await call("getCloudTableRecord", { params: recordParams })).values.status, "done")
  assert((await call("listCloudTableLogs", { params })).data.length > 0)

  const foreignParams = { id: process.env.SY_FOREIGN_TABLE_ID }
  await call("getCloudTable", { params: foreignParams, status: 403, code: "INSUFFICIENT_SCOPE" })
  const foreign = await call("getCloudTable", { params: foreignParams, identity: "collaborator" })
  assert.notEqual(foreign.ownerId, ownerId)
  assert.equal(foreign.viewerId, ownerId)
  assert.equal(foreign.permissions.manage, "none")
  const foreignRows = await call("queryCloudTableRecords", { params: foreignParams, identity: "collaborator", body: {} })
  assert.equal(foreignRows.data.length, 1)
  const deniedManagement = [
    ["updateCloudTable", { version: foreign.schemaVersion, name: "越权改名" }],
    ["updateCloudTable", { version: foreign.schemaVersion, fields: [] }],
    ["setCloudTablePermissions", { version: foreign.schemaVersion, anonymous: { read: true, create: true, update: true, delete: true }, members: [] }],
    ["deleteCloudTable", { version: foreign.schemaVersion }], ["restoreCloudTable"],
    ["resolveCloudTableCollaborator", { handle: process.env.SY_OTHER_HANDLE }], ["listCloudTableLogs"], ["listDeletedCloudTableRecords"],
  ]
  for (const [operationId, body] of deniedManagement) await call(operationId, { params: foreignParams, identity: "collaborator", body, status: 403, code: "FORBIDDEN" })
  await call("restoreCloudTableRecord", { params: { ...foreignParams, recordId: process.env.SY_FOREIGN_TRASH_ID }, identity: "collaborator", status: 403, code: "FORBIDDEN" })
  for (const [operationId, body] of [["updateCloudTableRecord", { version: foreignRows.data[0].version, values: { name: "越权更新" } }], ["deleteCloudTableRecord", { version: foreignRows.data[0].version }]]) await call(operationId, { params: { ...foreignParams, recordId: foreignRows.data[0].id }, identity: "collaborator", body, status: 404, code: "NOT_FOUND" })
  await call("createCloudTable", { identity: "collaborator", body: { name: "受限密钥越权建表" }, status: 403, code: "INSUFFICIENT_SCOPE" })
  const foreignAfter = await call("getCloudTable", { params: foreignParams, identity: "collaborator" })
  assert.deepEqual(foreignAfter, foreign)
  assert.deepEqual((await call("queryCloudTableRecords", { params: foreignParams, identity: "collaborator", body: {} })).data, foreignRows.data)

  schema = await call("getCloudTable", { params })
  await call("deleteCloudTable", { params, body: { version: schema.schemaVersion } })
  assert(!(await call("listCloudTables")).data.some(t => t.id === table.id))
  assert((await call("listDeletedCloudTables")).data.some(t => t.id === table.id))
  await call("restoreCloudTable", { params })
  schema = await call("getCloudTable", { params })
  assert.deepEqual(schema.anonymous, {})
  assert.equal((await call("getCloudTableRecord", { params: recordParams })).values.name, "张三")
  await call("deleteCloudTable", { params, body: { version: schema.schemaVersion } })
  assert.deepEqual([...successful].sort(), [...operations.keys()].sort())
  process.stdout.write(JSON.stringify({ passed: true, documentUrl, contractUrl, markdownSha256: createHash("sha256").update(markdown).digest("hex"), contractSha256: createHash("sha256").update(JSON.stringify(contract)).digest("hex"), ownTableId: table.id, successfulOperations: [...successful].sort(), managementRejections: deniedManagement.length + 1, trace }) + "\n")
} catch (error) {
  process.stderr.write(JSON.stringify({ passed: false, message: error.message, trace }) + "\n")
  process.exitCode = 1
}
