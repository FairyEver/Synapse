import "reflect-metadata"
import type { INestApplication } from "@nestjs/common"
import { PrismaClient } from "@prisma/client"
import { randomUUID } from "node:crypto"
import { afterAll, beforeAll, describe, expect, it } from "vitest"
import { hashPassword } from "../src/auth/password"
import { cloudTableOpenApiPaths } from "../src/cloud-tables/cloud-table-openapi"
import { createTestApp } from "../src/test/test-app"
import { requireLoopbackE2eDatabase } from "./e2e-database-guard.mjs"

const scopes = ["tables.manage", "tables.records.read", "tables.records.create", "tables.records.update", "tables.records.delete"]
const fields = [
  { key: "text", name: "文本", type: "text", required: true },
  { key: "integer", name: "整数", type: "integer", defaultValue: 7 },
  { key: "number", name: "小数", type: "number" },
  { key: "boolean", name: "布尔", type: "boolean" },
  { key: "date", name: "日期", type: "date" },
  { key: "datetime", name: "时间", type: "datetime" },
  { key: "single", name: "单选", type: "singleSelect", options: [{ key: "a", name: "甲" }, { key: "b", name: "乙" }] },
  { key: "multi", name: "多选", type: "multiSelect", options: [{ key: "a", name: "甲" }, { key: "b", name: "乙" }] },
  { key: "url", name: "链接", type: "url" },
  { key: "json", name: "JSON", type: "json" },
]
const values = { text: "接口测试", integer: 12, number: 1.25, boolean: false, date: "2024-02-29", datetime: "2026-11-01T00:00:00Z", single: "a", multi: ["a", "b"], url: "https://example.test/path?q=1", json: { nested: [true, 2, null, { name: "测试" }] } }
type Headers = Record<string, string>

describe("cloud table complete real HTTP contract", () => {
  let app: INestApplication, prisma: PrismaClient, base: string
  let ownerCookie: Headers, memberCookie: Headers, ownerKey: Headers
  const owner = `ct-http-owner-${randomUUID()}`, member = `ct-http-member-${randomUUID()}`
  const password = randomUUID()
  const userIds = [owner, member]
  const covered = new Map<string, Set<string>>()
  let httpRequests = 0

  async function call(method: string, path: string, auth: Headers = {}, body?: unknown, status = method === "POST" ? 201 : 200, extra: Headers = {}) {
    const response = await fetch(`${base}${path}`, { method, headers: { ...auth, ...(body === undefined ? {} : { "Content-Type": "application/json" }), ...extra }, ...(body === undefined ? {} : { body: JSON.stringify(body) }), signal: AbortSignal.timeout(15000) })
    httpRequests++
    const result = await response.json()
    expect(response.status, `${method} ${path}: ${JSON.stringify(result)}`).toBe(status)
    if (path.startsWith("/api/open/v1/tables") || path.startsWith("/api/console/tables")) {
      expect(response.headers.get("cache-control")).toBe("no-store")
      expect(response.headers.get("x-request-id")).toBeTruthy()
      if (status >= 400) expect(result).toMatchObject({ requestId: response.headers.get("x-request-id"), error: { code: expect.any(String), message: expect.any(String) } })
      else {
        const prefix = path.startsWith("/api/open/") ? "/api/open/v1" : "/api/console"
        const template = path.split("?")[0]!.slice(prefix.length).replace(/\/tables\/[^/]+/u, part => part === "/tables/trash" ? part : "/tables/{id}").replace(/\/records\/[^/]+/u, part => ["/records/query", "/records/count", "/records/exists", "/records/batch", "/records/trash"].includes(part) ? part : "/records/{recordId}")
        const set = covered.get(prefix) ?? new Set<string>(); set.add(`${method.toLowerCase()} ${template}`); covered.set(prefix, set)
      }
    }
    return result
  }
  async function denied(method: string, path: string, auth: Headers, body: unknown, status: number, code: string) {
    const result = await call(method, path, auth, body, status)
    expect(result.error.code).toBe(code)
  }
  async function key(cookie: Headers, resources: unknown, keyScopes = scopes) {
    return call("POST", "/api/console/api-keys", cookie, { name: "云表HTTP验收", scopes: keyScopes, ...(resources ? { tableResources: resources } : {}) })
  }

  beforeAll(async () => {
    process.env.DATABASE_URL = requireLoopbackE2eDatabase(process.env.CLOUD_TABLE_E2E_DATABASE_URL, "CLOUD_TABLE_E2E_DATABASE_URL")
    prisma = new PrismaClient()
    const passwordHash = await hashPassword(password)
    for (const id of userIds) await prisma.user.create({ data: { id, email: `${id}@example.test`, handle: id, nickname: "HTTP测试", passwordHash } })
    app = await createTestApp(); await app.listen(0, "127.0.0.1"); base = await app.getUrl()
    const login = async (id: string) => {
      const response = await fetch(`${base}/api/console/login`, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ email: `${id}@example.test`, password }) })
      expect(response.status).toBe(201)
      return { Cookie: response.headers.getSetCookie().map(v => v.split(";")[0]).join("; ") }
    }
    ownerCookie = await login(owner); memberCookie = await login(member)
    const created = await key(ownerCookie, { mode: "all_owned", tableIds: [] })
    ownerKey = { Authorization: `Bearer ${created.secret}` }
  }, 30000)

  afterAll(async () => {
    await app?.close()
    if (prisma) {
      await prisma.cloudTable.deleteMany({ where: { ownerId: { in: userIds } } })
      await prisma.cloudTableOperationLog.deleteMany({ where: { ownerId: { in: userIds } } })
      await prisma.userSession.deleteMany({ where: { userId: { in: userIds } } })
      await prisma.user.deleteMany({ where: { id: { in: userIds } } }); await prisma.$disconnect()
    }
    process.stdout.write(`Cloud table HTTP evidence: ${JSON.stringify({ httpRequests, successfulRoutes: Object.fromEntries([...covered].map(([p, routes]) => [p, [...routes].sort()])) })}\n`)
  })

  it.each(["open", "console"])("executes all 21 %s routes with persisted round trips", async mode => {
    const root = mode === "open" ? "/api/open/v1/tables" : "/api/console/tables", auth = mode === "open" ? ownerKey : ownerCookie
    const created = await call("POST", root, auth, { name: `完整流程-${mode}`, fields }, 201, { "Idempotency-Key": randomUUID() })
    const path = `${root}/${created.id}`
    expect((await call("GET", root, auth)).data.some((t: { id: string }) => t.id === created.id)).toBe(true)
    expect(await call("GET", path, auth)).toMatchObject({ schemaVersion: 1, anonymous: {}, ownerId: owner })
    expect((await call("GET", `${path}/schema`, auth)).fields).toHaveLength(10)
    expect(await call("POST", `${path}/collaborators/resolve`, auth, { handle: member })).toEqual({ id: member, handle: member })
    await call("PATCH", `${path}/permissions`, auth, { version: 1, anonymous: { create: true }, members: [] })
    const changedFields = fields.map(f => f.key === "integer" ? { ...f, name: "改名后的整数", defaultValue: 9 } : f)
    const changed = await call("PATCH", path, auth, { version: 2, name: "重命名", fields: changedFields })
    expect(changed.schemaVersion).toBe(3)
    await denied("PATCH", path, auth, { version: 2, name: "过期修改" }, 409, "VERSION_CONFLICT")
    const record = await call("POST", `${path}/records`, auth, { values })
    expect(Object.keys(record).sort()).toEqual(["id", "version"])
    const row = `${path}/records/${record.id}`
    expect(await call("GET", row, auth)).toMatchObject({ creatorUserId: owner, values: { ...values, datetime: "2026-11-01T00:00:00.000Z" }, version: 1 })
    const defaulted = await call("POST", `${path}/records`, auth, { values: { text: "默认值" } })
    expect((await call("GET", `${path}/records/${defaulted.id}`, auth)).values.integer).toBe(9)
    await call("PATCH", row, auth, { version: 1, values: { text: "更新" } })
    await denied("PATCH", row, auth, { version: 1, values: { text: "冲突" } }, 409, "VERSION_CONFLICT")
    const batch = await call("POST", `${path}/records/batch`, auth, { operations: [{ action: "create", values: { text: "批量" } }, { action: "update", id: record.id, version: 2, values: { number: 2.5 } }, { action: "delete", id: defaulted.id, version: 1 }] })
    expect(batch.data).toHaveLength(3)
    for (const confirmation of batch.data) expect(Object.keys(confirmation).sort()).toEqual(["id", "version"])
    expect((await call("GET", row, auth)).values).toMatchObject({ text: "更新", number: 2.5, integer: 12 })
    const page = await call("POST", `${path}/records/query`, auth, { limit: 1, sort: [{ field: "text", direction: "asc" }] })
    expect(page.data).toHaveLength(1); expect(page.nextCursor).toBeTruthy()
    const next = await call("POST", `${path}/records/query`, auth, { limit: 1, sort: [{ field: "text", direction: "asc" }], cursor: page.nextCursor })
    expect(next.data).toHaveLength(1); expect(next.data[0].id).not.toBe(page.data[0].id); expect(next.nextCursor).toBeNull()
    expect(await call("POST", `${path}/records/count`, auth, {})).toEqual({ count: 2 })
    expect(await call("POST", `${path}/records/exists`, auth, { filters: [{ field: "text", op: "eq", value: "missing" }] })).toEqual({ exists: false })
    await call("DELETE", row, auth, { version: 3 })
    await denied("GET", row, auth, undefined, 404, "NOT_FOUND")
    expect((await call("GET", `${path}/records/trash`, auth)).data.map((r: { id: string }) => r.id)).toEqual(expect.arrayContaining([record.id, defaulted.id]))
    expect(await call("POST", `${row}/restore`, auth)).toEqual({ id: record.id, version: 5 })
    expect((await call("GET", row, auth)).values.text).toBe("更新")
    const logs = await call("GET", `${path}/logs`, auth)
    expect(logs.data.length).toBeGreaterThan(0)
    for (const log of logs.data) {
      expect(Object.keys(log).sort()).toEqual(["id", "ownerId", "tableId", "actorId", "apiKeyId", "requestId", "operation", "status", "durationMs", "createdAt"].sort())
      expect(JSON.stringify(log)).not.toContain("Bearer ")
    }
    await call("DELETE", path, auth, { version: 3 })
    await denied("GET", path, auth, undefined, 404, "NOT_FOUND")
    expect((await call("GET", root, auth)).data.some((t: { id: string }) => t.id === created.id)).toBe(false)
    expect((await call("GET", `${root}/trash`, auth)).data.some((t: { id: string }) => t.id === created.id)).toBe(true)
    await call("POST", `${path}/restore`, auth)
    expect(await call("GET", path, auth)).toMatchObject({ anonymous: {}, schemaVersion: 5 })
    expect((await call("GET", row, auth)).values.text).toBe("更新")
    const expected = Object.entries(cloudTableOpenApiPaths()).flatMap(([p, methods]) => Object.keys(methods).map(m => `${m} ${p}`)).sort()
    expect(expected).toHaveLength(21)
    expect([...covered.get(mode === "open" ? "/api/open/v1" : "/api/console")!].sort()).toEqual(expected)
  })

  it("applies read scopes, table resources, own ACL and anonymous access to new reads", async () => {
    const root = "/api/open/v1/tables", t = await call("POST", root, ownerKey, { name: "读取增强", fields: [{ key: "text", name: "文本", type: "text" }] }), path = `${root}/${t.id}`
    await call("POST", `${path}/records`, ownerKey, { values: { text: "owner" } })
    for (const suffix of ["count", "exists"]) await denied("POST", `${path}/records/${suffix}`, ownerCookie, {}, 403, "FORBIDDEN")
    const write = await key(ownerCookie, { mode: "selected", tableIds: [t.id] }, ["tables.records.create"])
    const writeAuth = { Authorization: `Bearer ${write.secret}` }
    for (const suffix of ["query", "count", "exists"]) await denied("POST", `${path}/records/${suffix}`, writeAuth, {}, 403, "INSUFFICIENT_SCOPE")
    const none = await key(ownerCookie, { mode: "selected", tableIds: [] }, ["tables.records.read"])
    for (const suffix of ["count", "exists"]) await denied("POST", `${path}/records/${suffix}`, { Authorization: `Bearer ${none.secret}` }, {}, 403, "INSUFFICIENT_SCOPE")
    await call("PATCH", `${path}/permissions`, ownerKey, { version: 1, anonymous: {}, members: [{ userId: member, permissions: { read: "own", create: "all" } }] })
    const issued = await key(memberCookie, { mode: "selected", tableIds: [t.id] }), auth = { Authorization: `Bearer ${issued.secret}` }
    await call("POST", `${path}/records`, auth, { values: { text: "member" } })
    const filters = [{ field: "text", op: "eq", value: "owner" }, { field: "text", op: "eq", value: "member" }], body = { filters, filterMode: "any" }
    expect((await call("POST", `${path}/records/query`, auth, { ...body, fields: [] })).data.map((r: { values: unknown }) => r.values)).toEqual([{}])
    expect(await call("POST", `${path}/records/count`, auth, body)).toEqual({ count: 1 })
    expect(await call("POST", `${path}/records/exists`, auth, { filters: filters.slice(0, 1) })).toEqual({ exists: false })
    await call("PATCH", `${path}/permissions`, ownerKey, { version: 2, anonymous: {}, members: [] })
    for (const suffix of ["count", "exists"]) await denied("POST", `${path}/records/${suffix}`, auth, {}, 403, "FORBIDDEN")
    await call("PATCH", `${path}/permissions`, ownerKey, { version: 3, anonymous: { read: true }, members: [] })
    expect(await call("POST", `${path}/records/count`, {}, body)).toEqual({ count: 2 })
    expect(await call("POST", `${path}/records/exists`, {}, body)).toEqual({ exists: true })
    await denied("POST", `${path}/records/count`, { Authorization: "Bearer invalid-key" }, {}, 401, "INVALID_API_KEY")
    await call("DELETE", `/api/console/api-keys/${issued.apiKey.id}`, memberCookie)
    for (const suffix of ["count", "exists"]) await denied("POST", `${path}/records/${suffix}`, auth, {}, 401, "INVALID_API_KEY")
  })

  it("enforces collaborator own-row permissions, owner-only management and immediate ACL/key changes", async () => {
    const root = "/api/open/v1/tables", table = await call("POST", root, ownerKey, { name: "权限矩阵", fields: [{ key: "text", name: "文本", type: "text" }] }), path = `${root}/${table.id}`
    const ownerRow = await call("POST", `${path}/records`, ownerKey, { values: { text: "owner" } })
    await denied("POST", `${path}/records/query`, memberCookie, {}, 403, "FORBIDDEN")
    await call("PATCH", `${path}/permissions`, ownerKey, { version: 1, anonymous: {}, members: [{ userId: member, permissions: { read: "own", create: "all", update: "own", delete: "own" } }] })
    const issued = await key(memberCookie, { mode: "selected", tableIds: [table.id] }), memberKey = { Authorization: `Bearer ${issued.secret}` }
    const mine = await call("POST", `${path}/records`, memberKey, { values: { text: "member" } })
    for (const auth of [memberKey, memberCookie]) {
      const p = auth === memberCookie ? path.replace("/api/open/v1", "/api/console") : path
      expect((await call("POST", `${p}/records/query`, auth, {})).data.map((r: { id: string }) => r.id)).toEqual([mine.id])
      await denied("GET", `${p}/records/${ownerRow.id}`, auth, undefined, 404, "NOT_FOUND")
      await denied("PATCH", `${p}/records/${ownerRow.id}`, auth, { version: 1, values: { text: "attack" } }, 404, "NOT_FOUND")
      await denied("DELETE", `${p}/records/${ownerRow.id}`, auth, { version: 1 }, 404, "NOT_FOUND")
      for (const [method, suffix, body] of [["PATCH", "", { version: 2, name: "attack" }], ["PATCH", "/permissions", { version: 2, anonymous: {}, members: [] }], ["DELETE", "", { version: 2 }], ["POST", "/restore", undefined], ["POST", "/collaborators/resolve", { handle: owner }], ["GET", "/logs", undefined], ["GET", "/records/trash", undefined], ["POST", `/records/${ownerRow.id}/restore`, undefined]] as const) {
        await denied(method, `${p}${suffix}`, auth, body, 403, "FORBIDDEN")
      }
    }
    await denied("POST", `${path}/records`, memberKey, { values: { text: "forged" }, creatorUserId: owner }, 400, "INVALID_REQUEST")
    await denied("PATCH", `${path}/records/${mine.id}`, memberKey, { version: 1, values: { text: "forged" }, creatorUserId: owner }, 400, "INVALID_REQUEST")
    await call("PATCH", `${path}/records/${mine.id}`, memberKey, { version: 1, values: { text: "own update" } })
    expect((await call("GET", `${path}/records/${mine.id}`, ownerKey)).creatorUserId).toBe(member)
    await call("DELETE", `${path}/records/${mine.id}`, memberKey, { version: 2 })
    await denied("POST", `${path}/records/${mine.id}/restore`, memberKey, undefined, 403, "FORBIDDEN")
    await call("PATCH", `${path}/permissions`, ownerKey, { version: 2, anonymous: {}, members: [{ userId: member, permissions: { read: "all", update: "all", delete: "all" } }] })
    expect((await call("GET", `${path}/records/${ownerRow.id}`, memberKey)).values.text).toBe("owner")
    await call("PATCH", `${path}/records/${ownerRow.id}`, memberKey, { version: 1, values: { text: "all update" } })
    await call("PATCH", `${path}/permissions`, ownerKey, { version: 3, anonymous: {}, members: [] })
    await denied("POST", `${path}/records/query`, memberKey, {}, 403, "FORBIDDEN")
    await denied("DELETE", `${path}/records/${ownerRow.id}`, memberKey, { version: 2 }, 403, "FORBIDDEN")
    await call("DELETE", `/api/console/api-keys/${issued.apiKey.id}`, memberCookie)
    await denied("GET", path, memberKey, undefined, 401, "INVALID_API_KEY")
  })

  it("requires both key scopes and selected resources, and never upgrades ordinary login credentials", async () => {
    const root = "/api/open/v1/tables", a = await call("POST", root, ownerKey, { name: "A" }), b = await call("POST", root, ownerKey, { name: "B" })
    const issued = await key(ownerCookie, undefined, ["tables.records.read"]), auth = { Authorization: `Bearer ${issued.secret}` }, keyPath = `/api/console/api-keys/${issued.apiKey.id}`
    expect(issued.apiKey.tableResources).toEqual({ mode: "selected", tableIds: [] })
    await denied("GET", `${root}/${a.id}`, auth, undefined, 403, "INSUFFICIENT_SCOPE")
    await call("PATCH", keyPath, ownerCookie, { tableResources: { mode: "selected", tableIds: [a.id] } })
    await call("GET", `${root}/${a.id}/schema`, auth)
    expect((await call("GET", root, auth)).data.map((t: { id: string }) => t.id)).toEqual([a.id])
    await denied("GET", `${root}/${b.id}`, auth, undefined, 403, "INSUFFICIENT_SCOPE")
    const foreign = await call("POST", "/api/console/tables", memberCookie, { name: "其他用户私有表" })
    await denied("GET", `${root}/${foreign.id}`, ownerKey, undefined, 403, "INSUFFICIENT_SCOPE")
    await denied("GET", `/api/console/tables/${foreign.id}`, ownerCookie, undefined, 403, "FORBIDDEN")
    await call("PATCH", keyPath, ownerCookie, { tableResources: { mode: "selected", tableIds: [foreign.id] } }, 400)
    for (const [method, suffix, body] of [["POST", "/records", { values: {} }], ["PATCH", "/records/missing", { version: 1, values: {} }], ["DELETE", "/records/missing", { version: 1 }], ["PATCH", "", { version: 1, name: "forbidden" }]] as const) await denied(method, `${root}/${a.id}${suffix}`, auth, body, 403, "INSUFFICIENT_SCOPE")
    await call("PATCH", keyPath, ownerCookie, { scopes })
    await denied("POST", root, auth, { name: "selected cannot create" }, 403, "INSUFFICIENT_SCOPE")
    await call("PATCH", keyPath, ownerCookie, { tableResources: { mode: "all_owned", tableIds: [] } })
    await call("POST", root, auth, { name: "now allowed" })
    await call("PATCH", keyPath, ownerCookie, { scopes: ["tables.records.read"] })
    await denied("POST", root, auth, { name: "read-only cannot create" }, 403, "INSUFFICIENT_SCOPE")
    const login = await call("POST", "/api/auth/login", {}, { email: `${owner}@example.test`, password })
    expect(login.accessToken).toEqual(expect.any(String))
    await denied("GET", `${root}/${a.id}`, { Authorization: `Bearer ${login.accessToken}` }, undefined, 401, "INVALID_API_KEY")
    // Console Cookie is valid for Console, but grants no Open API identity.
    await denied("GET", root, ownerCookie, undefined, 401, "INVALID_API_KEY")
    await call("DELETE", keyPath, ownerCookie)
    await denied("GET", `${root}/${a.id}`, auth, undefined, 401, "INVALID_API_KEY")
  })

  it("opens anonymous actions independently and ignores a valid owner Cookie on writes", async () => {
    const root = "/api/open/v1/tables", t = await call("POST", root, ownerKey, { name: "匿名操作", fields: [{ key: "text", name: "文本", type: "text" }] }), path = `${root}/${t.id}`
    await denied("GET", `${path}/schema`, {}, undefined, 403, "FORBIDDEN")
    await call("PATCH", `${path}/permissions`, ownerKey, { version: 1, anonymous: { create: true }, members: [] })
    const schema = await call("GET", `${path}/schema`)
    expect(Object.keys(schema).sort()).toEqual(["id", "schemaVersion", "fields"].sort())
    const r = await call("POST", `${path}/records`, ownerCookie, { values: { text: "anonymous" } })
    expect((await call("GET", `${path}/records/${r.id}`, ownerKey)).creatorUserId).toBeNull()
    await denied("GET", `${path}/records/${r.id}`, ownerCookie, undefined, 403, "FORBIDDEN")
    await denied("POST", `${path}/records/query`, ownerCookie, {}, 403, "FORBIDDEN")
    await denied("PATCH", `${path}/records/${r.id}`, {}, { version: 1, values: {} }, 403, "FORBIDDEN")
    await denied("DELETE", `${path}/records/${r.id}`, {}, { version: 1 }, 403, "FORBIDDEN")
    await denied("POST", `${path}/records`, { Authorization: "Bearer invalid-key", ...ownerCookie }, { values: {} }, 401, "INVALID_API_KEY")
    await call("PATCH", `${path}/permissions`, ownerKey, { version: 2, anonymous: { read: true, update: true, delete: true }, members: [] })
    await denied("POST", `${path}/records`, {}, { values: {} }, 403, "FORBIDDEN")
    await call("GET", `${path}/records/${r.id}`)
    await call("PATCH", `${path}/records/${r.id}`, {}, { version: 1, values: { text: "anonymous edit" } })
    await call("DELETE", `${path}/records/${r.id}`, {}, { version: 2 })
    await denied("GET", `${path}/records/trash`, {}, undefined, 403, "FORBIDDEN")
    await denied("POST", `${path}/records/${r.id}/restore`, {}, undefined, 403, "FORBIDDEN")
  })

  it("returns authentication errors for every Console route without a valid session", async () => {
    for (const [path, methods] of Object.entries(cloudTableOpenApiPaths())) for (const method of Object.keys(methods)) {
      const url = `/api/console${path.replace("{id}", "unknown-table").replace("{recordId}", "unknown-record")}`
      await denied(method.toUpperCase(), url, {}, method === "get" ? undefined : {}, 401, "UNAUTHENTICATED")
      await denied(method.toUpperCase(), url, { Cookie: "synapse_user_session=expired-test-session" }, method === "get" ? undefined : {}, 401, "UNAUTHENTICATED")
    }
  })

  it("rejects invalid field values and bounded queries, and rolls back failed HTTP batches", async () => {
    const root = "/api/open/v1/tables", t = await call("POST", root, ownerKey, { name: "校验边界", fields }), path = `${root}/${t.id}`
    for (const invalid of [{ text: 1 }, { integer: 1.5 }, { number: "1" }, { boolean: 1 }, { date: "2026-02-30" }, { datetime: "2026-02-30T00:00:00Z" }, { single: "unknown" }, { multi: ["a", "a"] }, { url: "javascript:alert(1)" }]) await denied("POST", `${path}/records`, ownerKey, { values: { ...values, ...invalid } }, 400, "INVALID_VALUE")
    await denied("POST", `${path}/records`, ownerKey, { values: {} }, 400, "INVALID_VALUE")
    await denied("POST", `${path}/records`, ownerKey, { values: { ...values, unknown: 1 } }, 400, "UNKNOWN_FIELD")
    await denied("POST", `${path}/records`, ownerKey, { values: { text: "x".repeat(65536) } }, 413, "RECORD_TOO_LARGE")
    await denied("POST", root, ownerKey, { name: "too many fields", fields: Array.from({ length: 101 }, (_, i) => ({ key: `f${i}`, name: "字段", type: "text" })) }, 400, "INVALID_REQUEST")
    for (const query of [{ limit: 101 }, { filters: Array.from({ length: 21 }, () => ({ field: "text", op: "eq", value: "x" })) }, { sort: ["text", "integer", "number", "date"].map(field => ({ field, direction: "asc" })) }]) await denied("POST", `${path}/records/query`, ownerKey, query, 400, "INVALID_REQUEST")
    await denied("POST", `${path}/records/query`, ownerKey, { filters: [{ field: "text; DROP TABLE x", op: "eq", value: "x" }] }, 400, "INVALID_QUERY")
    await denied("POST", `${path}/records/batch`, ownerKey, { operations: Array.from({ length: 101 }, () => ({ action: "create", values: { text: "x" } })) }, 400, "INVALID_REQUEST")
    const r = await call("POST", `${path}/records`, ownerKey, { values: { text: "original" } })
    await denied("POST", `${path}/records/batch`, ownerKey, { operations: [{ action: "update", id: r.id, version: 1, values: { text: "must rollback" } }, { action: "create", values: { text: 4 } }] }, 400, "INVALID_VALUE")
    expect((await call("GET", `${path}/records/${r.id}`, ownerKey)).values.text).toBe("original")
    expect((await call("POST", `${path}/records/query`, ownerKey, {})).data).toHaveLength(1)
    const idem = { "Idempotency-Key": randomUUID() }, body = { values: { text: "once" } }
    const first = await call("POST", `${path}/records`, ownerKey, body, 201, idem)
    expect(await call("POST", `${path}/records`, ownerKey, body, 201, idem)).toEqual(first)
    const conflict = await call("POST", `${path}/records`, ownerKey, { values: { text: "changed" } }, 409, idem)
    expect(conflict.error.code).toBe("IDEMPOTENCY_CONFLICT")
    expect((await call("POST", `${path}/records/query`, ownerKey, {})).data).toHaveLength(2)
  })

  it("executes all eight filter operators in PostgreSQL and binds cursors to table, identity, query and schema", async () => {
    const root = "/api/open/v1/tables", t = await call("POST", root, ownerKey, { name: "筛选分页", fields: [{ key: "n", name: "数值", type: "integer" }, { key: "text", name: "文本", type: "text" }, { key: "flag", name: "标记", type: "boolean" }] }), path = `${root}/${t.id}`
    const data = [{ n: 1, text: "O'Reilly%_", flag: false }, { n: 2, text: "normal", flag: true }, { n: 3, text: "normal", flag: true }, { n: null, text: "empty", flag: null }]
    const batch = await call("POST", `${path}/records/batch`, ownerKey, { operations: data.map(values => ({ action: "create", values })) })
    const cases = [
      { field: "n", op: "eq", value: 2, expected: [1] },
      { field: "n", op: "ne", value: 2, expected: [0, 2, 3] },
      { field: "n", op: "gt", value: 2, expected: [2] },
      { field: "n", op: "gte", value: 2, expected: [1, 2] },
      { field: "n", op: "lt", value: 2, expected: [0] },
      { field: "n", op: "lte", value: 2, expected: [0, 1] },
      { field: "n", op: "in", value: [1, null], expected: [0, 3] },
      { field: "text", op: "contains", value: "'%_", expected: [] },
      { field: "text", op: "contains", value: "Reilly%_", expected: [0] },
      { field: "text", op: "eq", value: "' OR TRUE; --", expected: [] },
      { field: "n", op: "eq", value: null, expected: [3] },
      { field: "flag", op: "eq", value: false, expected: [0] },
      { field: "$creatorUserId", op: "eq", value: owner, expected: [0, 1, 2, 3] },
    ]
    for (const { expected, ...filter } of cases) {
      const result = await call("POST", `${path}/records/query`, ownerKey, { filters: [filter], sort: [{ field: "n", direction: "asc" }] })
      expect(result.data.map((r: { id: string }) => r.id)).toEqual(expected.map(i => batch.data[i].id))
    }
    const query = { limit: 1, filters: [{ field: "flag", op: "eq", value: true }], sort: [{ field: "text", direction: "asc" }, { field: "n", direction: "desc" }, { field: "$createdAt", direction: "asc" }] }
    const first = await call("POST", `${path}/records/query`, ownerKey, query)
    expect(first.data[0].values.n).toBe(3)
    const second = await call("POST", `${path}/records/query`, ownerKey, { ...query, cursor: first.nextCursor })
    expect(second.data[0].values.n).toBe(2); expect(second.nextCursor).toBeNull()
    await denied("POST", `${path}/records/query`, ownerKey, { ...query, filters: [], cursor: first.nextCursor }, 400, "INVALID_CURSOR")
    await denied("POST", `${path}/records/query`, ownerKey, { ...query, cursor: "tampered" }, 400, "INVALID_CURSOR")
    await denied("POST", `${path.replace("/api/open/v1", "/api/console")}/records/query`, ownerCookie, { ...query, cursor: first.nextCursor }, 400, "INVALID_CURSOR")
    const other = await call("POST", root, ownerKey, { name: "另一个表", fields: [{ key: "n", name: "数值", type: "integer" }, { key: "text", name: "文本", type: "text" }, { key: "flag", name: "标记", type: "boolean" }] })
    await denied("POST", `${root}/${other.id}/records/query`, ownerKey, { ...query, cursor: first.nextCursor }, 400, "INVALID_CURSOR")
    await call("PATCH", path, ownerKey, { version: 1, name: "结构版本变化" })
    await denied("POST", `${path}/records/query`, ownerKey, { ...query, cursor: first.nextCursor }, 400, "INVALID_CURSOR")
    await denied("GET", `${root}/${other.id}/records/${batch.data[0].id}`, ownerKey, undefined, 404, "NOT_FOUND")
    await denied("PATCH", `${root}/${other.id}/records/${batch.data[0].id}`, ownerKey, { version: 1, values: {} }, 404, "NOT_FOUND")
    await denied("DELETE", `${root}/${other.id}/records/${batch.data[0].id}`, ownerKey, { version: 1 }, 404, "NOT_FOUND")
  })

  it("replays update, delete and batch acknowledgements and commits concurrent same-key writes once", async () => {
    const root = "/api/open/v1/tables", t = await call("POST", root, ownerKey, { name: "HTTP幂等", fields: [{ key: "n", name: "数", type: "integer" }] }), path = `${root}/${t.id}`
    const createKey = { "Idempotency-Key": randomUUID() }, createBody = { values: { n: 1 } }
    const [a, b] = await Promise.all([call("POST", `${path}/records`, ownerKey, createBody, 201, createKey), call("POST", `${path}/records`, ownerKey, createBody, 201, createKey)])
    expect(a).toEqual(b)
    const row = `${path}/records/${a.id}`, updateKey = { "Idempotency-Key": randomUUID() }, update = { version: 1, values: { n: 2 } }
    const changed = await call("PATCH", row, ownerKey, update, 200, updateKey)
    expect(await call("PATCH", row, ownerKey, update, 200, updateKey)).toEqual(changed)
    expect((await call("GET", row, ownerKey)).version).toBe(2)
    const deleteKey = { "Idempotency-Key": randomUUID() }
    const removed = await call("DELETE", row, ownerKey, { version: 2 }, 200, deleteKey)
    expect(await call("DELETE", row, ownerKey, { version: 2 }, 200, deleteKey)).toEqual(removed)
    const batchKey = { "Idempotency-Key": randomUUID() }, body = { operations: [{ action: "create", values: { n: 3 } }, { action: "create", values: { n: 4 } }] }
    const batch = await call("POST", `${path}/records/batch`, ownerKey, body, 201, batchKey)
    expect(await call("POST", `${path}/records/batch`, ownerKey, body, 201, batchKey)).toEqual(batch)
    const failedKey = { "Idempotency-Key": randomUUID() }
    await call("POST", `${path}/records/batch`, ownerKey, { operations: [{ action: "create", values: { n: 5 } }, { action: "create", values: { n: "invalid" } }] }, 400, failedKey)
    // A rolled-back attempt must not reserve the key or leave its first row behind.
    await call("POST", `${path}/records/batch`, ownerKey, { operations: [{ action: "create", values: { n: 6 } }] }, 201, failedKey)
    const result = await call("POST", `${path}/records/query`, ownerKey, { sort: [{ field: "n", direction: "asc" }] })
    expect(result.data.map((r: { values: { n: number } }) => r.values.n)).toEqual([3, 4, 6])
    expect((await call("GET", `${path}/records/trash`, ownerKey)).data.map((r: { id: string }) => r.id)).toEqual([a.id])
  })
})
