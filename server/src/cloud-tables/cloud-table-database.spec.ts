import { Prisma } from "@prisma/client"
import { describe, expect, it } from "vitest"
import { cloudTableDatabaseFailure } from "./cloud-table-database"

function failure(code: string, meta?: Record<string, unknown>) {
  return new Prisma.PrismaClientKnownRequestError("database failure", { code, clientVersion: "test", meta })
}

describe("cloud table database errors", () => {
  it.each([
    ["P2024", undefined, "DB_POOL_TIMEOUT"],
    ["P2028", undefined, "DB_TRANSACTION_TIMEOUT"],
    ["P2034", undefined, "DB_WRITE_CONFLICT"],
    ["P2010", { code: "57014" }, "DB_STATEMENT_TIMEOUT"],
    ["P2010", { code: "55P03" }, "DB_LOCK_TIMEOUT"],
    ["P2010", { code: "40P01" }, "DB_DEADLOCK"],
    ["P2010", { code: "40001" }, "DB_SERIALIZATION"],
  ])("maps %s/%s to %s", (code, meta, expected) => {
    expect(cloudTableDatabaseFailure(failure(code, meta))).toMatchObject({ statusCode: 503, code: expected })
  })

  it("leaves unrelated database errors for the generic error response", () => {
    expect(cloudTableDatabaseFailure(failure("P2010", { code: "23505" }))).toBeNull()
    expect(cloudTableDatabaseFailure(new Error("connection refused"))).toBeNull()
  })
})
