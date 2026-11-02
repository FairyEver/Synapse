import { createHash, createHmac } from "node:crypto"
import { describe, expect, it } from "vitest"
import type { CloudField } from "@synapse/shared"
import { querySchema } from "./cloud-table-contract"
import { queryPlan, stableJson } from "./cloud-table-query"

const fields: CloudField[] = [
  { key: "title", name: "标题", type: "text" },
  { key: "score", name: "分数", type: "number" },
  { key: "old", name: "归档", type: "text", archivedAt: "2026-11-01T00:00:00Z" },
]
const plan = (input: unknown) => queryPlan("table", fields, querySchema.parse(input), "actor", 1, "secret")

describe("cloud table read query", () => {
  it("accepts optional projections and same-level OR while preserving default requests", () => {
    expect(querySchema.parse({})).toMatchObject({ filters: [], filterMode: "all", sort: [], limit: 50 })
    expect(querySchema.parse({ fields: [], filterMode: "any" })).toMatchObject({ fields: [], filterMode: "any" })
    expect(querySchema.safeParse({ fields: ["title", "title"] }).success).toBe(false)
    expect(querySchema.safeParse({ fields: Array.from({ length: 101 }, (_, i) => `f${i}`) }).success).toBe(false)
    expect(querySchema.safeParse({ filterMode: "or" }).success).toBe(false)
  })
  it.each(["old", "missing", "$id"])("rejects non-active business projection field %s", field => {
    expect(() => plan({ fields: [field] })).toThrow()
  })
  it("keeps pre-upgrade default cursors valid and binds explicit projection and mode", () => {
    const binding = createHash("sha256").update(stableJson({ tableId: "table", identity: "actor", schemaVersion: 1, filters: [], sort: [{ field: "$createdAt", direction: "asc" }] })).digest("hex")
    const data = Buffer.from(JSON.stringify({ binding, values: ["2026-11-01T00:00:00Z", "row"] })).toString("base64url")
    const cursor = `${data}.${createHmac("sha256", "secret").update(data).digest("base64url")}`
    expect(() => plan({ cursor })).not.toThrow()
    expect(() => plan({ cursor, filterMode: "all" })).not.toThrow()
    expect(() => plan({ cursor, filterMode: "any" })).toThrow()
    expect(() => plan({ cursor, fields: [] })).toThrow()
    const projected = plan({ fields: ["title"], filterMode: "any" }).encode(["2026-11-01T00:00:00Z", "row"])
    expect(() => plan({ fields: ["title"], filterMode: "any", cursor: projected })).not.toThrow()
    expect(() => plan({ fields: ["score"], filterMode: "any", cursor: projected })).toThrow()
    expect(() => plan({ fields: ["title"], filterMode: "all", cursor: projected })).toThrow()
  })
})
