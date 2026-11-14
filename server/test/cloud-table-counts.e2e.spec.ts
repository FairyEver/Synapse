import "reflect-metadata"
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest"
import { PrismaClient } from "@prisma/client"
import { Client } from "pg"
import { readFile } from "node:fs/promises"
import { randomUUID } from "node:crypto"
import { CloudTableDatabase } from "../src/cloud-tables/cloud-table-database"
import { CloudTableService } from "../src/cloud-tables/cloud-table.service"
import { requireLoopbackE2eDatabase } from "./e2e-database-guard.mjs"

describe("cloud table maintained counts on PostgreSQL", () => {
  let prisma: PrismaClient, db: CloudTableDatabase, service: CloudTableService
  const owner = `count-owner-${randomUUID()}`
  const request = (id: string | null, op: string, body: unknown = {}, key?: string) => service.execute({ userId: owner, console: true }, id, op, body, { requestId: randomUUID(), idempotencyKey: key }) as Promise<any>
  const count = async (id: string, trash = false) => (await request(null, trash ? "table.trash" : "table.list")).data.find((t: any) => t.id === id)?.recordCount
  beforeAll(async () => {
    process.env.DATABASE_URL = requireLoopbackE2eDatabase(process.env.CLOUD_TABLE_E2E_DATABASE_URL, "CLOUD_TABLE_E2E_DATABASE_URL")
    prisma = new PrismaClient(); db = new CloudTableDatabase(); service = new CloudTableService(db)
    await prisma.user.create({ data: { id: owner, email: `${owner}@example.test`, handle: owner, nickname: "测试", passwordHash: "test-only" } })
  })
  afterAll(async () => {
    service?.onModuleDestroy()
    if (prisma) {
      await prisma.cloudTable.deleteMany({ where: { ownerId: owner } })
      await prisma.cloudTableOperationLog.deleteMany({ where: { ownerId: owner } })
      await prisma.user.deleteMany({ where: { id: owner } })
      await prisma.$disconnect()
    }
    await db?.$disconnect()
  })
  it("keeps exact totals through batches, replay, failed writes, delete, restore and table trash", async () => {
    const t = await request(null, "table.create", { name: "计数", fields: [] })
    expect(await count(t.id)).toBe(0)
    const key = randomUUID(), body = { operations: [{ action: "create", values: {} }, { action: "create", values: {} }] }
    const created = await request(t.id, "records.batch", body, key)
    await request(t.id, "records.batch", body, key)
    expect(await count(t.id)).toBe(2)
    const row = created.data[0]
    await expect(request(t.id, "records.batch", { operations: [{ action: "create", values: {} }, { action: "delete", id: row.id, version: 99 }] })).rejects.toMatchObject({ code: "VERSION_CONFLICT" })
    expect(await count(t.id)).toBe(2)
    await request(t.id, "records.delete", { id: row.id, version: 1 })
    expect(await count(t.id)).toBe(1)
    await request(t.id, "records.restore", { id: row.id })
    expect(await count(t.id)).toBe(2)
    await request(t.id, "table.delete", { version: 1 })
    expect(await count(t.id, true)).toBe(2)
    await request(t.id, "table.restore")
    expect(await count(t.id)).toBe(2)
  })
  it("does not lose concurrent insert/delete deltas or update stats on content edits", async () => {
    const t = await request(null, "table.create", { name: "并发计数", fields: [] })
    const rows = await Promise.all(Array.from({ length: 8 }, () => request(t.id, "records.create", { values: {} })))
    expect(await count(t.id)).toBe(8)
    const stamps = () => prisma.$queryRaw<{ xmin: string }[]>`SELECT xmin::text FROM "CloudTableStats" WHERE "tableId" = ${t.id}`
    const before = await stamps()
    await request(t.id, "records.update", { id: rows[0].id, version: 1, values: {} })
    expect(await stamps()).toEqual(before)
    await Promise.all(rows.slice(1).map(row => request(t.id, "records.delete", { id: row.id, version: 1 })))
    expect(await count(t.id)).toBe(1)
    await prisma.cloudTableRecord.deleteMany({ where: { tableId: t.id, deletedAt: { not: null } } })
    expect(await count(t.id)).toBe(1)
    await prisma.cloudTableRecord.deleteMany({ where: { tableId: t.id } })
    expect(await count(t.id)).toBe(0)
  })
  it("backfills existing live records once and safely handles cascading table deletion", async () => {
    const client = new Client({ connectionString: process.env.DATABASE_URL })
    const schema = `counts_${randomUUID().replaceAll("-", "")}`
    await client.connect()
    try {
      await client.query(`CREATE SCHEMA "${schema}"; SET search_path TO "${schema}"`)
      await client.query('CREATE TABLE "CloudTable" ("id" TEXT PRIMARY KEY); CREATE TABLE "CloudTableRecord" ("id" TEXT PRIMARY KEY, "tableId" TEXT REFERENCES "CloudTable"("id") ON DELETE CASCADE, "deletedAt" TIMESTAMP)')
      await client.query(`INSERT INTO "CloudTable" VALUES ('live'), ('empty'); INSERT INTO "CloudTableRecord" VALUES ('a', 'live', NULL), ('b', 'live', NULL), ('deleted', 'live', NOW())`)
      await client.query(await readFile("prisma/migrations/20261114120000_cloud_table_record_counts/migration.sql", "utf8"))
      expect((await client.query('SELECT "recordCount"::text FROM "CloudTableStats" WHERE "tableId" = $1', ["live"])).rows).toEqual([{ recordCount: "2" }])
      await client.query('DELETE FROM "CloudTable" WHERE "id" = $1', ["live"])
      expect((await client.query('SELECT "tableId" FROM "CloudTableStats" WHERE "tableId" = $1', ["live"])).rows).toEqual([])
    } finally {
      await client.query("ROLLBACK")
      await client.query(`SET search_path TO public; DROP SCHEMA "${schema}" CASCADE`)
      await client.end()
    }
  })
  it("does not turn competing batch and single deletes into a stats/record lock timeout", async () => {
    const t = await request(null, "table.create", { name: "锁顺序", fields: [] })
    const first = await request(t.id, "records.create", { values: {} })
    const second = await request(t.id, "records.create", { values: {} })
    const batchDb = new CloudTableDatabase(), singleDb = new CloudTableDatabase()
    const batchService = new CloudTableService(batchDb), singleService = new CloudTableService(singleDb)
    let release!: () => void, firstDeleted!: () => void, singlePid = 0
    const gate = new Promise<void>(resolve => { release = resolve })
    const reached = new Promise<void>(resolve => { firstDeleted = resolve })
    const batchTransaction = batchDb.transaction.bind(batchDb), singleTransaction = singleDb.transaction.bind(singleDb)
    vi.spyOn(batchDb, "transaction").mockImplementation(work => batchTransaction(tx => work(new Proxy(tx, { get(target, key) {
      if (key !== "cloudTableRecord") return Reflect.get(target, key)
      return new Proxy(target.cloudTableRecord, { get(records, method) {
        if (method !== "updateMany") return Reflect.get(records, method)
        return async (args: Parameters<typeof records.updateMany>[0]) => {
          const result = await records.updateMany(args)
          if (args?.where?.id === first.id) { firstDeleted(); await gate }
          return result
        }
      } })
    } }))))
    vi.spyOn(singleDb, "transaction").mockImplementation(work => singleTransaction(async tx => {
      singlePid = (await tx.$queryRaw<{ pid: number }[]>`SELECT pg_backend_pid() AS pid`)[0]!.pid
      return work(tx)
    }))
    const run = (s: CloudTableService, op: string, body: unknown) => s.execute({ userId: owner, console: true }, t.id, op, body, { requestId: randomUUID() })
    let results: PromiseSettledResult<unknown>[] = []
    try {
      const batch = run(batchService, "records.batch", { operations: [{ action: "delete", id: first.id, version: 1 }, { action: "delete", id: second.id, version: 1 }] })
      const observedBatch = Promise.allSettled([batch])
      await reached
      const single = run(singleService, "records.delete", { id: second.id, version: 1 })
      const observedSingle = Promise.allSettled([single])
      let waiting = false
      for (let i = 0; i < 50 && !waiting; i++) {
        const rows = await prisma.$queryRaw<{ wait: string | null }[]>`SELECT wait_event_type AS wait FROM pg_stat_activity WHERE pid = ${singlePid}`
        waiting = rows[0]?.wait === "Lock"
        if (!waiting) await new Promise(resolve => setTimeout(resolve, 2))
      }
      release()
      results = [...await observedBatch, ...await observedSingle]
      expect(waiting).toBe(true)
      expect(results.filter(result => result.status === "fulfilled")).toHaveLength(1)
      expect(results.find(result => result.status === "rejected")).toMatchObject({ reason: { code: "NOT_FOUND" } })
      expect(await count(t.id)).toBe(0)
    } finally {
      release(); batchService.onModuleDestroy(); singleService.onModuleDestroy()
      await batchDb.$disconnect(); await singleDb.$disconnect()
    }
  })
})
