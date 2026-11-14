import "reflect-metadata"
import { afterEach, describe, expect, it } from "vitest"
import { CloudTableService, type CloudActor } from "./cloud-table.service"
import type { CloudTableDatabase } from "./cloud-table-database"
import { cloudTableConfig } from "./cloud-table-config"

const services: CloudTableService[] = []
afterEach(() => services.splice(0).forEach(service => service.onModuleDestroy()))
function list({ range = "all", count = 12345n, scopes, empty = false }: { range?: "all" | "own" | "none"; count?: bigint; scopes?: string[]; empty?: boolean } = {}) {
  const actor: CloudActor = { userId: "member", console: !scopes, ...(scopes ? { apiKeyId: "key" } : {}) }
  const tx = {
    $queryRaw: async (sql: TemplateStringsArray) => {
      const text = Array.from(sql).join("")
      if (text.includes('FROM "UserApiKey"')) return [{ userId: "member", scopes, revokedAt: null, tableAccessMode: "selected", tableIds: ["table"] }]
      if (text.includes('FROM "User"')) return [{ status: "active" }]
      throw new Error("The table directory must not scan records")
    },
    cloudTable: { findMany: async () => [{ id: "table", ownerId: "owner", name: "表", schemaVersion: 1, anonymous: {}, members: [{ userId: "member", permissions: { read: range, create: "all" } }], createdAt: new Date(0), updatedAt: new Date(0), deletedAt: null, stats: empty ? null : { recordCount: count } }] },
    cloudTableOperationLog: { create: async () => ({}) },
  }
  const db = { config: cloudTableConfig(), transaction: (work: (client: typeof tx) => unknown) => work(tx) } as unknown as CloudTableDatabase
  const service = new CloudTableService(db); services.push(service)
  return service.execute(actor, null, "table.list", {}, { requestId: "list" })
}
describe("cloud table directory counts", () => {
  it("returns maintained counts without querying records or exposing storage metadata", async () => {
    const result = await list() as { data: Record<string, unknown>[] }
    expect(result.data[0]).toMatchObject({ id: "table", recordCount: 12345 })
    expect(result.data[0]).not.toHaveProperty("stats")
    expect(result.data[0]).not.toHaveProperty("fields")
  })
  it("returns zero for a new empty table without a stats row", async () => {
    expect(await list({ empty: true })).toMatchObject({ data: [{ recordCount: 0 }] })
  })
  it.each(["own", "none"] as const)("hides whole-table totals from %s readers", async range => {
    expect(await list({ range })).toMatchObject({ data: [{ recordCount: null }] })
  })
  it("does not expose totals through a key without the read scope", async () => {
    expect(await list({ scopes: ["tables.records.create"] })).toMatchObject({ data: [{ recordCount: null }] })
  })
  it("rejects totals that cannot be represented exactly", async () => {
    await expect(list({ count: 9007199254740992n })).rejects.toMatchObject({ code: "COUNT_TOO_LARGE" })
  })
})
