import "reflect-metadata"
import { afterAll, beforeAll, describe, expect, it } from "vitest"
import { PrismaClient } from "@prisma/client"
import { randomUUID } from "node:crypto"
import { CloudTableDatabase } from "../src/cloud-tables/cloud-table-database"
import { CloudTableService, type CloudActor } from "../src/cloud-tables/cloud-table.service"
import { requireLoopbackE2eDatabase } from "./e2e-database-guard.mjs"
import { Test } from "@nestjs/testing"
import { CloudTableController } from "../src/cloud-tables/cloud-table.controller"
import { CloudTableGuard, cloudTableCors, registerCloudTableIngress, registerCloudTableBodyErrors } from "../src/cloud-tables/cloud-table-http"
import { ApiKeyService } from "../src/api-keys/api-key.service"
import { AuditLogService } from "../src/common/audit-log.service"
import { OpenApiExceptionFilter } from "../src/open-api/open-api-exception.filter"
import { createApiKeySecret, hashApiKeySecret } from "../src/api-keys/api-key-token"
import { json as jsonParser } from "express"

describe("cloud tables real PostgreSQL", () => {
  let db: CloudTableDatabase, service: CloudTableService, prisma: PrismaClient
  const owner = `ct-owner-${randomUUID()}`, member = `ct-member-${randomUUID()}`
  const actor: CloudActor = { userId: owner, console: true }
  let tableId: string
  const request = (who: CloudActor, id: string | null, op: string, body: unknown = {}, idem?: string) => service.execute(who, id, op, body, { requestId: randomUUID(), idempotencyKey: idem }) as Promise<any>
  beforeAll(async () => {
    process.env.DATABASE_URL = requireLoopbackE2eDatabase(process.env.CLOUD_TABLE_E2E_DATABASE_URL, "CLOUD_TABLE_E2E_DATABASE_URL")
    prisma = new PrismaClient(); db = new CloudTableDatabase(); service = new CloudTableService(db)
    for (const id of [owner, member]) await prisma.user.create({ data: { id, email: `${id}@example.test`, handle: id, nickname: "测试用户", passwordHash: "test-only" } })
    const table = await request(actor, null, "table.create", { name: "报名", fields: [{ key: "name", name: "姓名", type: "text", required: true }] })
    tableId = table.id
  })
  afterAll(async () => {
    service?.onModuleDestroy()
    if (db) { await db.cloudTable.deleteMany({ where: { ownerId: owner } }); await db.cloudTableOperationLog.deleteMany({ where: { ownerId: owner } }); await db.$disconnect() }
    if (prisma) { await prisma.userSession.deleteMany({ where: { userId: { in: [owner, member] } } }); await prisma.user.deleteMany({ where: { id: { in: [owner, member] } } }); await prisma.$disconnect() }
  })
  it("defaults private, grants own rows, and does not disclose other values through writes", async () => {
    await expect(request({ console: false }, tableId, "records.query")).rejects.toMatchObject({ code: "FORBIDDEN" })
    await request(actor, tableId, "permissions", { version: 1, anonymous: { create: true }, members: [{ userId: member, permissions: { create: "all", read: "own", update: "own", delete: "own" } }] })
    const created = await request({ console: false }, tableId, "records.create", { values: { name: "anonymous" } })
    expect(created).toHaveProperty("id"); expect(created).not.toHaveProperty("values")
    const mine = await request({ console: true, userId: member }, tableId, "records.create", { values: { name: "mine" } })
    const page = await request({ console: true, userId: member }, tableId, "records.query")
    expect(page.data.map((r: any) => r.id)).toEqual([mine.id])
    await expect(request({ console: true, userId: member }, tableId, "records.update", { id: created.id, version: 1, values: { name: "steal" } })).rejects.toMatchObject({ code: "NOT_FOUND" })
  })
  it("atomically rolls back batches and returns 409 for concurrent versions", async () => {
    const before = await db.cloudTableRecord.count({ where: { tableId } })
    await expect(request(actor, tableId, "records.batch", { operations: [{ action: "create", values: { name: "ok" } }, { action: "create", values: { name: 3 } }] })).rejects.toThrow()
    expect(await db.cloudTableRecord.count({ where: { tableId } })).toBe(before)
    const row = await request(actor, tableId, "records.create", { values: { name: "v1" } })
    const result = await Promise.allSettled([request(actor, tableId, "records.update", { id: row.id, version: 1, values: { name: "A" } }), request(actor, tableId, "records.update", { id: row.id, version: 1, values: { name: "B" } })])
    expect(result.filter(r => r.status === "fulfilled")).toHaveLength(1)
    expect(result.find(r => r.status === "rejected")).toMatchObject({ reason: { statusCode: 409 } })
  })
  it("deduplicates retries transactionally and rejects changed replay", async () => {
    const body = { values: { name: "once" } }, key = randomUUID()
    const a = await request(actor, tableId, "records.create", body, key)
    const b = await request(actor, tableId, "records.create", body, key)
    expect(a).toEqual(b)
    await expect(request(actor, tableId, "records.create", { values: { name: "changed" } }, key)).rejects.toMatchObject({ statusCode: 409 })
  })
  it("deduplicates table creation after an ambiguous response", async () => {
    const key = randomUUID(), body = { name: "create-once", fields: [] }
    const first = await request(actor, null, "table.create", body, key)
    const replay = await request(actor, null, "table.create", body, key)
    expect(first.id).toBe(replay.id)
    await expect(request(actor, null, "table.create", { name: "different" }, key)).rejects.toMatchObject({ statusCode: 409 })
  })
  it("preserves typed IN matches, explicit null, missing values and pagination", async () => {
    const t = await request(actor, null, "table.create", { name: "in-candidates", fields: [
      { key: "text", name: "文本", type: "text" }, { key: "n", name: "数值", type: "number" },
      { key: "flag", name: "标记", type: "boolean" }, { key: "at", name: "时间", type: "datetime" },
    ] })
    const values = [
      { text: "", n: 0, flag: false, at: "2026-11-01T00:00:00Z" },
      { text: "second", n: 2, flag: true },
      { text: null, n: null, flag: null }, {},
    ]
    const ids: string[] = []
    for (const value of values) ids.push((await request(actor, t.id, "records.create", { values: value })).id)
    for (const [field, candidates, expected] of [
      ["text", ["", null], [ids[0], ids[2], ids[3]]],
      ["n", [0, null], [ids[0], ids[2], ids[3]]],
      ["flag", [false, null], [ids[0], ids[2], ids[3]]],
      ["at", ["2026-11-01T00:00:00Z"], [ids[0]]],
    ] as const) {
      const page = await request(actor, t.id, "records.query", { filters: [{ field, op: "in", value: candidates }] })
      expect(page.data.map((row: any) => row.id).sort()).toEqual([...expected].sort())
    }
    const query = { filters: [{ field: "text", op: "in", value: ["", "second"] }], limit: 1 }
    const first = await request(actor, t.id, "records.query", query)
    const second = await request(actor, t.id, "records.query", { ...query, cursor: first.nextCursor })
    expect([first.data[0].id, second.data[0].id].sort()).toEqual([ids[0], ids[1]].sort())
    expect(second.nextCursor).toBeNull()
  })
  it("restores records and tables without re-enabling anonymous operations", async () => {
    const row = await request(actor, tableId, "records.create", { values: { name: "restore" } })
    await request(actor, tableId, "records.delete", { id: row.id, version: 1 })
    await expect(request(actor, tableId, "records.get", { id: row.id })).rejects.toMatchObject({ statusCode: 404 })
    await request(actor, tableId, "records.restore", { id: row.id })
    expect(await request(actor, tableId, "records.get", { id: row.id })).toMatchObject({ values: { name: "restore" }, version: 3 })
    const table = await request(actor, tableId, "table.get")
    await request(actor, tableId, "table.delete", { version: table.schemaVersion })
    await request(actor, tableId, "table.restore")
    expect((await request(actor, tableId, "table.get")).anonymous).toEqual({})
  })
  it("refuses to restore an active table without changing its public permissions", async () => {
    const t = await request(actor, null, "table.create", { name: "active-restore", fields: [] })
    await request(actor, t.id, "permissions", { version: 1, anonymous: { read: true }, members: [] })
    await expect(request(actor, t.id, "table.restore")).rejects.toMatchObject({ statusCode: 409, code: "NOT_DELETED" })
    expect(await request(actor, t.id, "table.get")).toMatchObject({ schemaVersion: 2, anonymous: { read: true } })
  })
  it("restores a deleted record once under concurrent requests and returns the committed version", async () => {
    const t = await request(actor, null, "table.create", { name: "restore-race", fields: [] })
    const row = await request(actor, t.id, "records.create", { values: {} })
    await request(actor, t.id, "records.delete", { id: row.id, version: 1 })
    let release!: () => void, entered!: () => void
    const ready = new Promise<void>(r => { entered = r }), gate = new Promise<void>(r => { release = r })
    const held = prisma.$transaction(async tx => { await tx.$queryRaw`SELECT "id" FROM "CloudTableRecord" WHERE "id" = ${row.id} FOR UPDATE`; entered(); await gate })
    await ready
    const pending = Promise.allSettled([request(actor, t.id, "records.restore", { id: row.id }), request(actor, t.id, "records.restore", { id: row.id })])
    try {
      for (let i = 0; i < 20; i++) {
        const [waiting] = await prisma.$queryRaw<{ count: bigint }[]>`SELECT COUNT(*) AS "count" FROM pg_stat_activity WHERE datname = current_database() AND wait_event_type = 'Lock' AND query LIKE '%CloudTableRecord%'`
        if (waiting!.count >= 2n) break
        await new Promise(r => setTimeout(r, 5))
      }
    } finally { release(); await held }
    const results = await pending
    expect(results.filter(r => r.status === "fulfilled")).toHaveLength(1)
    expect(results.find(r => r.status === "fulfilled")).toMatchObject({ value: { id: row.id, version: 3 } })
    expect((await request(actor, t.id, "records.get", { id: row.id })).version).toBe(3)
  })
  it("lists only collaborator tables with usable ACL and key scope intersection", async () => {
    const t = await request(actor, null, "table.create", { name: "revoked-list", fields: [] })
    const who = { userId: member, console: true }
    await request(actor, t.id, "permissions", { version: 1, anonymous: {}, members: [{ userId: member, permissions: { read: "none", create: "none", update: "none", delete: "none" } }] })
    expect((await request(who, null, "table.list")).data.some((item: any) => item.id === t.id)).toBe(false)
    await request(actor, t.id, "permissions", { version: 2, anonymous: {}, members: [{ userId: member, permissions: { create: "all" } }] })
    const key = await prisma.userApiKey.create({ data: { userId: member, name: "read-only", keyHash: randomUUID(), keyPrefix: "test", scopes: ["tables.records.read"], tableIds: [t.id] } })
    try {
      const reader = { userId: member, apiKeyId: key.id, console: false }
      expect((await request(who, null, "table.list")).data.some((item: any) => item.id === t.id)).toBe(true)
      expect((await request(reader, null, "table.list")).data.some((item: any) => item.id === t.id)).toBe(false)
      await request(actor, t.id, "permissions", { version: 3, anonymous: { read: true }, members: [{ userId: member, permissions: { create: "all" } }] })
      expect((await request(reader, null, "table.list")).data.some((item: any) => item.id === t.id)).toBe(true)
    } finally { await prisma.userApiKey.delete({ where: { id: key.id } }) }
  })
  it("assigns listable member tables using effective anonymous access without accepting nonmembers", async () => {
    const t = await request(actor, null, "table.create", { name: "anonymous-member-resource", fields: [] })
    const permissions = { read: "none", create: "none", update: "none", delete: "none" }
    await request(actor, t.id, "permissions", { version: 1, anonymous: { read: true }, members: [{ userId: member, permissions }] })
    const key = await prisma.userApiKey.create({ data: { userId: member, name: "resource-fallback", keyHash: randomUUID(), keyPrefix: "test", scopes: ["tables.records.read"], tableIds: [] } })
    const keys = new ApiKeyService(prisma, new AuditLogService(prisma)), resources = { mode: "selected" as const, tableIds: [t.id] }
    try {
      await expect(keys.updateTableResourcesForUser(member, key.id, resources)).resolves.toMatchObject({ tableResources: resources })
      expect(await request({ userId: member, apiKeyId: key.id, console: false }, t.id, "records.count")).toEqual({ count: 0 })
      await request(actor, t.id, "permissions", { version: 2, anonymous: {}, members: [{ userId: member, permissions }] })
      await expect(keys.updateTableResourcesForUser(member, key.id, resources)).rejects.toThrow("表资源不存在或未获授权")
      await request(actor, t.id, "permissions", { version: 3, anonymous: { read: true }, members: [] })
      await expect(keys.updateTableResourcesForUser(member, key.id, resources)).rejects.toThrow("表资源不存在或未获授权")
    } finally { await prisma.userApiKey.delete({ where: { id: key.id } }) }
  })
  it("compares timezone-equivalent system filters and honors explicit id primary order", async () => {
    const t = await request(actor, null, "table.create", { name: "system-sort", fields: [{ key: "n", name: "数值", type: "integer" }] })
    const rows = []
    for (const n of [2, 1, 3]) rows.push(await request(actor, t.id, "records.create", { values: { n } }))
    const expected = rows.map(row => row.id).sort().reverse()
    const sort = [{ field: "$id", direction: "desc" }, { field: "n", direction: "asc" }]
    const first = await request(actor, t.id, "records.query", { sort, limit: 1 })
    const next = await request(actor, t.id, "records.query", { sort, limit: 2, cursor: first.nextCursor })
    expect([...first.data, ...next.data].map(row => row.id)).toEqual(expected)
    await prisma.cloudTableRecord.updateMany({ where: { tableId: t.id }, data: { createdAt: new Date("2026-11-01T00:00:00Z") } })
    expect(await request(actor, t.id, "records.count", { filters: [{ field: "$createdAt", op: "eq", value: "2026-11-01T08:00:00+08:00" }] })).toEqual({ count: 3 })
  })
  it("returns null for new constructor fields and filters URL fragments", async () => {
    const t = await request(actor, null, "table.create", { name: "constructor", fields: [{ key: "url", name: "链接", type: "url" }] })
    const row = await request(actor, t.id, "records.create", { values: { url: "https://example.com/path" } })
    await request(actor, t.id, "table.update", { version: 1, fields: [{ key: "url", name: "链接", type: "url" }, { key: "constructor", name: "构造器", type: "text" }] })
    expect((await request(actor, t.id, "records.get", { id: row.id })).values).toEqual({ url: "https://example.com/path", constructor: null })
    const page = await request(actor, t.id, "records.query", { filters: [{ field: "url", op: "contains", value: "example.com/path" }] })
    expect(page.data).toHaveLength(1); expect(page.data[0].values.constructor).toBeNull()
  })
  it("rolls back an in-flight write and its receipt when the request is canceled before commit", async () => {
    const t = await request(actor, null, "table.create", { name: "canceled-write", fields: [] })
    let release!: () => void, entered!: () => void
    const ready = new Promise<void>(r => { entered = r }), gate = new Promise<void>(r => { release = r })
    const held = prisma.$transaction(async tx => { await tx.$queryRaw`SELECT "id" FROM "CloudTable" WHERE "id" = ${t.id} FOR UPDATE`; entered(); await gate })
    await ready
    const abort = new AbortController(), key = randomUUID()
    const result = Promise.allSettled([service.execute(actor, t.id, "records.create", { values: {} }, { requestId: randomUUID(), signal: abort.signal, idempotencyKey: key })])
    await new Promise(r => setTimeout(r, 30)); abort.abort(); release(); await held
    expect((await result)[0]).toMatchObject({ status: "rejected", reason: { code: "REQUEST_ABORTED" } })
    expect(await prisma.cloudTableRecord.count({ where: { tableId: t.id } })).toBe(0)
    expect(await prisma.cloudTableReceipt.count({ where: { tableId: t.id, key } })).toBe(0)
  })
  it("queries numeric values and nulls in stable, query-bound cursor order", async () => {
    const t = await request(actor, null, "table.create", { name: "query", fields: [{ key: "n", name: "数值", type: "number" }] })
    for (const n of [20, null, 3, 100]) await request(actor, t.id, "records.create", { values: { n } })
    const first = await request(actor, t.id, "records.query", { sort: [{ field: "n", direction: "asc" }], limit: 2 })
    expect(first.data.map((r: any) => r.values.n)).toEqual([3, 20])
    const second = await request(actor, t.id, "records.query", { sort: [{ field: "n", direction: "asc" }], limit: 2, cursor: first.nextCursor })
    expect(second.data.map((r: any) => r.values.n)).toEqual([100, null])
    await expect(request(actor, t.id, "records.query", { filters: [{ field: "n", op: "gt", value: 10 }], cursor: first.nextCursor })).rejects.toMatchObject({ code: "INVALID_CURSOR" })
    const filtered = await request(actor, t.id, "records.query", { filters: [{ field: "n", op: "gte", value: 20 }] })
    expect(filtered.data).toHaveLength(2)
    const empty = await request(actor, t.id, "records.query", { filters: [{ field: "n", op: "eq", value: null }] })
    expect(empty.data.map((r: any) => r.values.n)).toEqual([null])
  })
  it("projects only selected values while sorting and paginating on unreturned fields", async () => {
    const t = await request(actor, null, "table.create", { name: "projection", fields: [
      { key: "title", name: "标题", type: "text" }, { key: "n", name: "数字", type: "integer" }, { key: "old", name: "归档", type: "text" },
    ] })
    for (const n of [3, 1, 2]) await request(actor, t.id, "records.create", { values: { title: `title-${n}`, n, old: "hidden" } })
    const body = { fields: ["title"], sort: [{ field: "n", direction: "asc" }], limit: 1 }
    const first = await request(actor, t.id, "records.query", body)
    expect(first.data[0]).toMatchObject({ values: { title: "title-1" }, version: 1, creatorUserId: owner })
    expect(Object.keys(first.data[0].values)).toEqual(["title"])
    const next = await request(actor, t.id, "records.query", { ...body, cursor: first.nextCursor })
    expect(next.data[0].values).toEqual({ title: "title-2" })
    expect((await request(actor, t.id, "records.query", { fields: [], filters: [{ field: "n", op: "eq", value: 2 }] })).data[0].values).toEqual({})
    expect((await request(actor, t.id, "records.query", {})).data[0].values).toHaveProperty("n")
    await expect(request(actor, t.id, "records.query", { ...body, fields: ["n"], cursor: first.nextCursor })).rejects.toMatchObject({ code: "INVALID_CURSOR" })
    await expect(request(actor, t.id, "records.query", { ...body, filterMode: "any", cursor: first.nextCursor })).rejects.toMatchObject({ code: "INVALID_CURSOR" })
    await request(actor, t.id, "table.update", { version: 1, fields: [
      { key: "title", name: "标题", type: "text" }, { key: "n", name: "数字", type: "integer" },
    ] })
    await expect(request(actor, t.id, "records.query", { fields: ["old"] })).rejects.toMatchObject({ code: "INVALID_QUERY" })
    await expect(request(actor, t.id, "records.query", { ...body, cursor: first.nextCursor })).rejects.toMatchObject({ code: "INVALID_CURSOR" })
  })
  it("projects the full 100-field budget without losing JSON types or null fields", async () => {
    const fields = Array.from({ length: 100 }, (_, i) => ({ key: `f${i}`, name: `字段${i}`, type: i === 0 ? "json" : i === 1 ? "boolean" : "integer" }))
    const t = await request(actor, null, "table.create", { name: "full-projection", fields })
    expect(await request(actor, t.id, "records.count")).toEqual({ count: 0 })
    expect(await request(actor, t.id, "records.exists")).toEqual({ exists: false })
    await request(actor, t.id, "records.create", { values: { f0: { nested: [1, "text", null] }, f1: false, f2: 0 } })
    const [row] = (await request(actor, t.id, "records.query", { fields: fields.map(f => f.key) })).data
    expect(Object.keys(row.values)).toHaveLength(100)
    expect(row.values).toMatchObject({ f0: { nested: [1, "text", null] }, f1: false, f2: 0, f99: null })
  })
  it("keeps OR queries and statistics inside table, own and non-deleted boundaries", async () => {
    const t = await request(actor, null, "table.create", { name: "or", fields: [{ key: "n", name: "数字", type: "integer" }] })
    const foreign = await request(actor, null, "table.create", { name: "foreign", fields: [{ key: "n", name: "数字", type: "integer" }] })
    await request(actor, foreign.id, "records.create", { values: { n: 1 } })
    await request(actor, t.id, "permissions", { version: 1, anonymous: { create: true }, members: [{ userId: member, permissions: { read: "own", create: "all" } }] })
    const who = { userId: member, console: true }
    for (const n of [1, 2, 3]) await request(who, t.id, "records.create", { values: { n } })
    const removed = await request(who, t.id, "records.create", { values: { n: 1 } })
    await request(actor, t.id, "records.delete", { id: removed.id, version: 1 })
    await request(actor, t.id, "records.create", { values: { n: 1 } })
    await request({ console: false }, t.id, "records.create", { values: { n: 1 } })
    const filters = [{ field: "n", op: "eq", value: 1 }, { field: "n", op: "eq", value: 2 }]
    expect((await request(who, t.id, "records.query", { filters })).data).toEqual([])
    const body = { filters, filterMode: "any" }
    const page = await request(who, t.id, "records.query", { ...body, fields: [], sort: [{ field: "n", direction: "asc" }], limit: 1 })
    const next = await request(who, t.id, "records.query", { ...body, fields: [], sort: [{ field: "n", direction: "asc" }], limit: 1, cursor: page.nextCursor })
    expect(page.data).toHaveLength(1); expect(next.data).toHaveLength(1)
    expect(next.data[0].id).not.toBe(page.data[0].id); expect(next.nextCursor).toBeNull()
    expect(await request(who, t.id, "records.count", body)).toEqual({ count: 2 })
    expect(await request(who, t.id, "records.exists", body)).toEqual({ exists: true })
    expect(await request(who, t.id, "records.count", { filters })).toEqual({ count: 0 })
    expect(await request(who, t.id, "records.exists", { filters })).toEqual({ exists: false })
    for (const filterMode of ["all", "any"]) expect(await request(who, t.id, "records.count", { filterMode })).toEqual({ count: 3 })
    for (const op of ["records.count", "records.exists"]) {
      await expect(request({ console: false }, t.id, op)).rejects.toMatchObject({ code: "FORBIDDEN" })
      await expect(request(who, t.id, op, { filters: [{ field: "missing", op: "eq", value: 1 }] })).rejects.toMatchObject({ code: "INVALID_QUERY" })
      for (const extra of [{ limit: 1 }, { fields: [] }, { cursor: "bad" }, { sort: [] }]) await expect(request(who, t.id, op, extra)).rejects.toMatchObject({ code: "INVALID_REQUEST" })
    }
  })
  it("rejects incompatible field changes and restores archived field values", async () => {
    const t = await request(actor, null, "table.create", { name: "schema", fields: [{ key: "x", name: "文字", type: "text" }] })
    const r = await request(actor, t.id, "records.create", { values: { x: "preserved" } })
    await expect(request(actor, t.id, "table.update", { version: 1, fields: [{ key: "x", name: "数值", type: "number" }] })).rejects.toMatchObject({ statusCode: 409 })
    await request(actor, t.id, "table.update", { version: 1, fields: [] })
    expect((await request(actor, t.id, "records.get", { id: r.id })).values).toEqual({})
    await request(actor, t.id, "table.update", { version: 2, fields: [{ key: "x", name: "改名", type: "text" }] })
    expect((await request(actor, t.id, "records.get", { id: r.id })).values.x).toBe("preserved")
  })
  it("rejects restoring a required archived field when newer rows have no value", async () => {
    const field = { key: "required", name: "必填", type: "text", required: true }
    const t = await request(actor, null, "table.create", { name: "required-restore", fields: [field] })
    await request(actor, t.id, "records.create", { values: { required: "old" } })
    await request(actor, t.id, "table.update", { version: 1, fields: [] })
    await request(actor, t.id, "records.create", { values: {} })
    await expect(request(actor, t.id, "table.update", { version: 2, fields: [field] })).rejects.toMatchObject({ statusCode: 409, code: "INCOMPATIBLE_SCHEMA" })
    await request(actor, t.id, "table.update", { version: 2, fields: [{ ...field, required: false }] })
  })
  it("continues keyset pagination after a maximum-sized text value and deletion of the cursor row", async () => {
    const t = await request(actor, null, "table.create", { name: "long-cursor", fields: [{ key: "text", name: "文本", type: "text" }] })
    const a = await request(actor, t.id, "records.create", { values: { text: "a".repeat(60000) } })
    const b = await request(actor, t.id, "records.create", { values: { text: "b".repeat(60000) } })
    const first = await request(actor, t.id, "records.query", { sort: [{ field: "text", direction: "asc" }], limit: 1 })
    expect(first.nextCursor.length).toBeGreaterThan(16384)
    await request(actor, t.id, "records.delete", { id: a.id, version: 1 })
    const next = await request(actor, t.id, "records.query", { sort: [{ field: "text", direction: "asc" }], limit: 1, cursor: first.nextCursor })
    expect(next.data.map((r: any) => r.id)).toEqual([b.id])
  })
  it("bounds retained field definitions and returns lightweight table summaries", async () => {
    const t = await request(actor, null, "table.create", { name: "metadata", fields: [] })
    for (let i = 0; i < 20; i++) await request(actor, t.id, "table.update", { version: i + 1, fields: [{ key: `f${i}`, name: "默认值", type: "text", defaultValue: "x".repeat(50000) }] })
    await expect(request(actor, t.id, "table.update", { version: 21, fields: [{ key: "overflow", name: "超出", type: "text", defaultValue: "x".repeat(50000) }] })).rejects.toMatchObject({ code: "SCHEMA_TOO_LARGE" })
    const summaries = await request(actor, null, "table.list")
    expect(summaries.data.find((r: any) => r.id === t.id)).not.toHaveProperty("fields")
    expect(summaries.data.find((r: any) => r.id === t.id)).not.toHaveProperty("members")
  })
  it("checks key resources, current scopes and revocation for every operation", async () => {
    const key = await prisma.userApiKey.create({ data: { userId: owner, name: "restricted", keyHash: randomUUID(), keyPrefix: "test", scopes: ["tables.records.read"], tableIds: [tableId] } })
    const who = { userId: owner, apiKeyId: key.id, console: false }
    await request(who, tableId, "records.query")
    await expect(request(who, tableId, "records.create", { values: { name: "forbidden" } })).rejects.toMatchObject({ code: "INSUFFICIENT_SCOPE" })
    await expect(request(who, null, "table.create", { name: "forbidden" })).rejects.toMatchObject({ statusCode: 403 })
    await prisma.userApiKey.update({ where: { id: key.id }, data: { revokedAt: new Date() } })
    await expect(request(who, tableId, "records.query")).rejects.toMatchObject({ statusCode: 401 })
    await prisma.userApiKey.delete({ where: { id: key.id } })
  })
  it("ignores Cookie identity over HTTP, rejects invalid keys and supports credentialless CORS", async () => {
    const t = await request(actor, null, "table.create", { name: "http", fields: [{ key: "x", name: "X", type: "text" }] })
    await request(actor, t.id, "permissions", { version: 1, anonymous: { create: true }, members: [] })
    const keys = new ApiKeyService(db as never, new AuditLogService(db as never))
    const httpService = new CloudTableService(db)
    const guard = new CloudTableGuard(httpService, keys, { canActivate: async () => false } as never)
    const filter = new OpenApiExceptionFilter({ error: () => undefined } as never)
    const module = await Test.createTestingModule({ controllers: [CloudTableController], providers: [{ provide: CloudTableService, useValue: httpService }, { provide: CloudTableGuard, useValue: guard }, { provide: OpenApiExceptionFilter, useValue: filter }] }).overrideGuard(CloudTableGuard).useValue(guard).overrideFilter(OpenApiExceptionFilter).useValue(filter).compile()
    const app = module.createNestApplication({ logger: false, bodyParser: false }); registerCloudTableIngress(app as never); app.use(jsonParser({ limit: "1mb" })); registerCloudTableBodyErrors(app as never)
    app.enableCors((req, cb) => cb(null, cloudTableCors(req.url ?? "") ?? { origin: false }))
    await app.listen(0, "127.0.0.1")
    try {
      const base = await app.getUrl(), path = `${base}/api/open/v1/tables/${t.id}/records`
      const noRead = await fetch(`${path}/query`, { method: "POST", headers: { "Content-Type": "application/json", Cookie: "synapse_user_session=pretend-owner" }, body: "{}" })
      expect(noRead.status).toBe(403)
      const invalid = await fetch(path, { method: "POST", headers: { "Content-Type": "application/json", Authorization: "Bearer invalid" }, body: JSON.stringify({ values: { x: "no" } }) })
      expect(invalid.status).toBe(401)
      const missing = await fetch(`${base}/api/open/v1/tables/not-found/records/query`, { method: "POST", headers: { "Content-Type": "application/json", Authorization: "Bearer invalid" }, body: "{}" })
      expect(missing.status).toBe(401)
      const oversized = await fetch(path, { method: "POST", headers: { "Content-Type": "application/json", Origin: "https://external.example" }, body: JSON.stringify({ values: { x: "x".repeat(1048576) } }) })
      expect(oversized.status).toBe(413); expect(oversized.headers.get("access-control-allow-origin")).toBe("*")
      expect(await oversized.json()).toHaveProperty("requestId", oversized.headers.get("x-request-id"))
      const malformed = await fetch(path, { method: "POST", headers: { "Content-Type": "application/json" }, body: '{"private":"do-not-log"' })
      expect(malformed.status).toBe(400); expect(JSON.stringify(await malformed.json())).not.toContain("do-not-log")
      const insert = await fetch(path, { method: "POST", headers: { "Content-Type": "application/json", Cookie: "synapse_user_session=pretend-owner", Origin: "https://external.example" }, body: JSON.stringify({ values: { x: "anon" } }) })
      expect(insert.status).toBe(201); expect(insert.headers.get("access-control-allow-origin")).toBe("*"); expect(insert.headers.get("access-control-allow-credentials")).toBeNull()
      const inserted = await insert.json() as { id: string }
      expect((await db.cloudTableRecord.findUniqueOrThrow({ where: { id: inserted.id } })).creatorUserId).toBeNull()
      const secret = createApiKeySecret(), key = await prisma.userApiKey.create({ data: { userId: owner, name: "http", keyHash: hashApiKeySecret(secret), keyPrefix: secret.slice(0, 15), scopes: ["tables.records.read"], tableIds: [t.id] } })
      try { const response = await fetch(`${path}/query`, { method: "POST", headers: { "Content-Type": "application/json", Authorization: `Bearer ${secret}` }, body: "{}" }); expect(response.status).toBe(201); expect((await response.json() as { data: unknown[] }).data).toHaveLength(1) } finally { await prisma.userApiKey.delete({ where: { id: key.id } }) }
    } finally { await app.close() }
  })
  it("rechecks a revoked key after waiting in its table owner's queue", async () => {
    const key = await prisma.userApiKey.create({ data: { userId: owner, name: "queued", keyHash: randomUUID(), keyPrefix: "test", scopes: ["tables.records.read"], tableIds: [tableId] } })
    let release!: () => void
    const gate = new Promise<void>(r => { release = r })
    const held = [service.scheduler.run(owner, 0, () => gate), service.scheduler.run(owner, 0, () => gate)]
    const queued = request({ userId: owner, apiKeyId: key.id, console: false }, tableId, "records.query")
    const outcome = Promise.allSettled([queued])
    await new Promise(r => setTimeout(r, 30))
    await prisma.userApiKey.update({ where: { id: key.id }, data: { revokedAt: new Date() } })
    release(); await Promise.all(held)
    expect((await outcome)[0]).toMatchObject({ status: "rejected", reason: { statusCode: 401 } })
    await prisma.userApiKey.delete({ where: { id: key.id } })
  })
  it("boots the production module graph and completes Console login, key creation and private API access", async () => {
    const { createTestApp } = await import("../src/test/test-app")
    const { hashPassword } = await import("../src/auth/password")
    const password = randomUUID()
    await prisma.user.update({ where: { id: owner }, data: { passwordHash: await hashPassword(password) } })
    const app = await createTestApp(); await app.listen(0, "127.0.0.1")
    try {
      const base = await app.getUrl()
      const login = await fetch(`${base}/api/console/login`, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ email: `${owner}@example.test`, password }) })
      expect(login.status).toBe(201)
      const cookie = login.headers.getSetCookie().map(v => v.split(";")[0]).join("; ")
      const tables = await fetch(`${base}/api/console/tables`, { headers: { Cookie: cookie } })
      expect(tables.status).toBe(200); expect((await tables.json() as { data: { id: string }[] }).data.some(t => t.id === tableId)).toBe(true)
      const created = await fetch(`${base}/api/console/api-keys`, { method: "POST", headers: { Cookie: cookie, "Content-Type": "application/json" }, body: JSON.stringify({ name: "cloud-e2e", scopes: ["tables.records.read"], tableResources: { mode: "selected", tableIds: [tableId] } }) })
      expect(created.status).toBe(201)
      const key = await created.json() as { secret: string; apiKey: { id: string } }
      const query = await fetch(`${base}/api/open/v1/tables/${tableId}/records/query`, { method: "POST", headers: { Authorization: `Bearer ${key.secret}`, "Content-Type": "application/json" }, body: "{}" })
      expect(query.status).toBe(201)
      const revoke = await fetch(`${base}/api/console/api-keys/${key.apiKey.id}`, { method: "DELETE", headers: { Cookie: cookie } })
      expect(revoke.status).toBe(200)
      const denied = await fetch(`${base}/api/open/v1/tables/${tableId}/records/query`, { method: "POST", headers: { Authorization: `Bearer ${key.secret}`, "Content-Type": "application/json" }, body: "{}" })
      expect(denied.status).toBe(401)
    } finally { await app.close() }
  }, 30000)
  it("serializes schema changes against record writes without committing incompatible values", async () => {
    const t = await request(actor, null, "table.create", { name: "race", fields: [{ key: "x", name: "X", type: "text" }] })
    const outcomes = await Promise.allSettled([
      request(actor, t.id, "records.create", { values: { x: "text" } }),
      request(actor, t.id, "table.update", { version: 1, fields: [{ key: "x", name: "X", type: "integer" }] }),
    ])
    expect(outcomes.filter(o => o.status === "fulfilled")).toHaveLength(1)
    const current = await request(actor, t.id, "table.get"), rows = await request(actor, t.id, "records.query")
    expect(current.fields[0].type === "text" ? rows.data[0].values.x : rows.data.length).toBe(current.fields[0].type === "text" ? "text" : 0)
  })
  it("actually cancels SQL and lock waits and leaves the next transaction usable", async () => {
    await expect(db.transaction(tx => tx.$queryRaw`SELECT 1 FROM pg_sleep(3)`)).rejects.toMatchObject({ statusCode: 503 })
    expect(await db.transaction(tx => tx.$queryRaw`SELECT 1 AS "ok"`)).toEqual([{ ok: 1 }])
    let release!: () => void, entered!: () => void
    const ready = new Promise<void>(r => { entered = r }), gate = new Promise<void>(r => { release = r })
    const held = prisma.$transaction(async tx => { await tx.$queryRaw`SELECT "id" FROM "CloudTable" WHERE "id" = ${tableId} FOR UPDATE`; entered(); await gate })
    await ready
    try { await expect(request(actor, tableId, "records.query")).rejects.toMatchObject({ statusCode: 503 }) } finally { release(); await held }
    await request(actor, tableId, "records.query")
  })
  it("purges expired trash in bounded maintenance transactions", async () => {
    const row = await request(actor, tableId, "records.create", { values: { name: "expired" } })
    await db.cloudTableRecord.update({ where: { id: row.id }, data: { deletedAt: new Date(Date.now() - 40 * 86400000) } })
    await service.cleanup()
    expect(await db.cloudTableRecord.findUnique({ where: { id: row.id } })).toBeNull()
  })
  it("catches up expired logs and receipts beyond one cleanup batch", async () => {
    const old = new Date(Date.now() - 40 * 86400000)
    await prisma.cloudTableOperationLog.createMany({ data: Array.from({ length: 1205 }, () => ({ ownerId: owner, tableId, requestId: randomUUID(), operation: "records.query", status: 200, durationMs: 1, createdAt: old })) })
    await prisma.cloudTableReceipt.createMany({ data: Array.from({ length: 1205 }, (_, i) => ({ tableId, namespace: `expired:${tableId}:${i}`, key: randomUUID(), fingerprint: "0".repeat(64), result: {}, createdAt: old })) })
    await service.cleanup()
    expect(await prisma.cloudTableOperationLog.count({ where: { ownerId: owner, createdAt: { lt: new Date(Date.now() - 30 * 86400000) } } })).toBe(0)
    expect(await prisma.cloudTableReceipt.count({ where: { tableId, createdAt: { lt: new Date(Date.now() - 86400000) } } })).toBe(0)
  })
  it("keeps normal owners and the core pool responsive under anonymous and multi-key batch bursts", async () => {
    const other = `ct-other-${randomUUID()}`
    await prisma.user.create({ data: { id: other, email: `${other}@example.test`, handle: other, nickname: "压力测试", passwordHash: "test-only" } })
    const hot = await request(actor, null, "table.create", { name: "hot", fields: [{ key: "n", name: "N", type: "integer" }] })
    await request(actor, hot.id, "permissions", { version: 1, anonymous: { create: true }, members: [] })
    const normalActors = [{ userId: member, console: true }, { userId: other, console: true }]
    const normalTables = await Promise.all(normalActors.map(a => request(a, null, "table.create", { name: "normal", fields: [{ key: "n", name: "N", type: "integer" }] })))
    const keyIds: string[] = []
    for (let i = 0; i < 2; i++) keyIds.push((await prisma.userApiKey.create({ data: { userId: owner, name: "burst", keyHash: randomUUID(), keyPrefix: "test", scopes: ["tables.records.create"], tableIds: [hot.id] } })).id)
    try {
      for (const t of normalTables) await prisma.$executeRaw`INSERT INTO "CloudTableRecord" ("id", "tableId", "values", "createdAt", "updatedAt") SELECT ${t.id} || ':' || g, ${t.id}, jsonb_build_object('n', g), CURRENT_TIMESTAMP - g * interval '1 second', CURRENT_TIMESTAMP FROM generate_series(1,20000) g`
      const sample = async () => {
        const times: number[] = [], core: number[] = []
        for (let i = 0; i < 20; i++) {
          await Promise.all(normalTables.map(async (t, j) => { const start = performance.now(); const result = await request(normalActors[j]!, t.id, "records.query", { limit: 50 }); expect(result.data).toHaveLength(50); times.push(performance.now() - start) }))
          const start = performance.now(); await prisma.$queryRaw`SELECT 1`; core.push(performance.now() - start)
        }
        return { times, core }
      }
      await sample() // warm indexes and connections before measuring
      const baseline = await sample()
      const operations = Array.from({ length: 100 }, (_, n) => ({ action: "create", values: { n } }))
      const bursts = Promise.allSettled(Array.from({ length: 64 }, (_, i) => request(i % 3 === 0 ? { console: false } : { userId: owner, apiKeyId: keyIds[i % 2]!, console: false }, hot.id, "records.batch", { operations })))
      const loaded = await sample(), outcomes = await bursts
      const p95 = (values: number[]) => values.toSorted((a,b) => a-b)[Math.ceil(values.length * .95) - 1]!
      const report = { baselineP95Ms: p95(baseline.times), loadedP95Ms: p95(loaded.times), normalSuccess: loaded.times.length / 40, coreP95Ms: p95(loaded.core), burstSucceeded: outcomes.filter(o => o.status === "fulfilled").length, burstBusy: outcomes.filter(o => o.status === "rejected" && o.reason?.statusCode === 503).length }
      process.stdout.write(`Cloud table load evidence: ${JSON.stringify(report)}\n`)
      expect(report.normalSuccess).toBe(1)
      expect(report.loadedP95Ms).toBeLessThanOrEqual(report.baselineP95Ms * 2)
      expect(report.coreP95Ms).toBeLessThan(500)
      expect(report.burstSucceeded).toBeGreaterThan(0)
      expect(report.burstBusy).toBeGreaterThan(0)
    } finally {
      await prisma.userApiKey.deleteMany({ where: { id: { in: keyIds } } })
      await prisma.cloudTable.deleteMany({ where: { ownerId: { in: [member, other] } } })
      await prisma.cloudTableOperationLog.deleteMany({ where: { ownerId: { in: [member, other] } } })
      await prisma.user.delete({ where: { id: other } })
    }
  }, 30000)
})
