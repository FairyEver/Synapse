import "reflect-metadata"
import { afterEach, describe, expect, it } from "vitest"
import { CloudTableService } from "./cloud-table.service"
import type { CloudTableDatabase } from "./cloud-table-database"
import { cloudTableConfig } from "./cloud-table-config"

const services: CloudTableService[] = []
afterEach(() => services.splice(0).forEach(service => service.onModuleDestroy()))
function setup(count: bigint) {
  const tx = {
    $queryRaw: async (sql: { sql?: string } | TemplateStringsArray) => {
      const text = "sql" in sql ? sql.sql! : Array.from(sql as TemplateStringsArray).join("")
      if (text.includes('FROM "User"')) return [{ status: "active" }]
      if (text.includes("COUNT(*)")) return [{ count }]
      return []
    },
    cloudTable: { findUnique: async () => ({ id: "table", ownerId: "owner", anonymous: {}, members: [], deletedAt: null }) },
    user: { findUnique: async () => ({ status: "active" }) },
    cloudTableField: { findMany: async () => [] },
    cloudTableOperationLog: { create: async () => ({}) },
  }
  const db = { config: cloudTableConfig(), transaction: (work: (client: typeof tx) => unknown) => work(tx) } as unknown as CloudTableDatabase
  const service = new CloudTableService(db); services.push(service)
  return (input: unknown = {}) => service.execute({ userId: "owner", console: true }, "table", "records.count", input, { requestId: "count" })
}
describe("cloud table count boundaries", () => {
  it("rejects PostgreSQL-incompatible table IDs before owner lookup", async () => {
    const db = { config: cloudTableConfig(), transaction: async () => { throw new Error("database lookup must not run") } } as unknown as CloudTableDatabase
    const service = new CloudTableService(db); services.push(service)
    await expect(service.execute({ userId: "owner", console: true }, "bad\u0000id", "table.get", {}, { requestId: "bad-id" })).rejects.toMatchObject({ code: "INVALID_VALUE" })
  })
  it.each([0n, 9007199254740991n])("returns an exact safe integer for %s", async count => {
    await expect(setup(count)()).resolves.toEqual({ count: Number(count) })
  })
  it("rejects unsafe counts instead of rounding", async () => {
    await expect(setup(9007199254740992n)()).rejects.toMatchObject({ statusCode: 400, code: "COUNT_TOO_LARGE" })
  })
  it.each(["sort", "cursor", "limit", "fields"])("rejects query-only count parameter %s", async key => {
    await expect(setup(0n)({ [key]: key === "limit" ? 1 : [] })).rejects.toMatchObject({ code: "INVALID_REQUEST" })
  })
})
