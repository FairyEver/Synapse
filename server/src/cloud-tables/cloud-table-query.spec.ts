import { createHash, createHmac } from "node:crypto"
import { describe, expect, it } from "vitest"
import type { CloudField } from "@synapse/shared"
import { querySchema } from "./cloud-table-contract"
import { filterPlan, queryPlan, stableJson } from "./cloud-table-query"

const fields: CloudField[] = [
  { key: "title", name: "标题", type: "text" },
  { key: "score", name: "分数", type: "number" },
  { key: "old", name: "归档", type: "text", archivedAt: "2026-11-01T00:00:00Z" },
]
const plan = (input: unknown) => queryPlan("table", fields, querySchema.parse(input), "actor", 1, "secret")

describe("cloud table read query", () => {
  it("combines non-null business IN candidates into one strict indexed search", () => {
    const result = plan({ filters: [{ field: "title", op: "in", value: ["first", "second"] }] })
    expect(result.filter.sql.match(/@\?/g)).toHaveLength(1)
    expect(result.filter.values).toEqual(['strict $."title" ? (@ == "first" || @ == "second")'])
  })
  it.each([
    [{ key: "value", name: "值", type: "text" }, "", '{"value":""}'],
    [{ key: "value", name: "值", type: "number" }, 0, '{"value":0}'],
    [{ key: "value", name: "值", type: "boolean" }, false, '{"value":false}'],
  ] as const)("preserves falsy business IN candidates for %j", (field, value, expected) => {
    const result = filterPlan([field], querySchema.parse({ filters: [{ field: "value", op: "in", value: [value, null] }] }))
    expect(result.sql).toContain('@>')
    expect(result.sql).toContain('IS NOT DISTINCT FROM')
    expect(result.values).toEqual([expected, "value", null])
  })
  it("normalizes business datetime IN candidates without changing system timestamp comparisons", () => {
    const field: CloudField = { key: "date", name: "日期", type: "datetime" }
    const result = filterPlan([field], querySchema.parse({ filters: [{ field: "date", op: "in", value: ["2026-11-01T00:00:00Z"] }] }))
    expect(result.values).toEqual(['strict $."date" ? (@ == "2026-11-01T00:00:00.000Z")'])
    const system = plan({ filters: [{ field: "$createdAt", op: "in", value: ["2026-11-01T08:00:00+08:00"] }] })
    expect(system.filter.sql).not.toContain('@>')
    expect(system.filter.values).toEqual(["2026-11-01T00:00:00.000Z"])
  })
  it("still validates every IN candidate before generating a containment predicate", () => {
    expect(() => plan({ filters: [{ field: "score", op: "in", value: [1, "invalid"] }] })).toThrow()
  })
  it("escapes IN candidate text inside the bound search expression", () => {
    const candidate = 'quote" || @ == "injected\\value'
    const result = plan({ filters: [{ field: "title", op: "in", value: [candidate] }] })
    expect(result.filter.values).toEqual(['strict $."title" ? (@ == "quote\\\" || @ == \\\"injected\\\\value")'])
  })
  it("keeps the 1-to-100 IN candidate bound", () => {
    expect(() => plan({ filters: [{ field: "title", op: "in", value: Array.from({ length: 100 }, (_, i) => String(i)) }] })).not.toThrow()
    for (const value of [[], Array.from({ length: 101 }, (_, i) => String(i))]) {
      expect(() => plan({ filters: [{ field: "title", op: "in", value }] })).toThrow()
    }
  })
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
  it("normalizes system timestamps to UTC before comparing PostgreSQL timestamps", () => {
    const result = plan({ filters: [{ field: "$createdAt", op: "eq", value: "2026-11-01T08:00:00+08:00" }] })
    expect(result.filter.values).toContain("2026-11-01T00:00:00.000Z")
    expect(result.filter.values).not.toContain("2026-11-01T08:00:00+08:00")
  })
  it.each(["1", "2026-02-30T00:00:00Z", "0000-01-01T00:00:00Z", "2026-11-01T00:00:00.0001Z"])("rejects invalid system timestamp %s as a query error", value => {
    expect(() => plan({ filters: [{ field: "$updatedAt", op: "eq", value }] })).toThrowError(expect.objectContaining({ code: "INVALID_QUERY" }))
  })
  it("accepts literal URL fragments for contains without requiring a complete URL", () => {
    expect(() => queryPlan("table", [{ key: "url", name: "链接", type: "url" }], querySchema.parse({ filters: [{ field: "url", op: "contains", value: "example.com/path" }] }), "actor", 1, "secret")).not.toThrow()
  })
  it("preserves explicitly requested id priority and invalidates old reordered cursors", () => {
    const sort = [{ field: "$id", direction: "desc" }, { field: "score", direction: "asc" }]
    const result = plan({ sort })
    expect(result.order.sql.indexOf('r."id" DESC')).toBeLessThan(result.order.sql.indexOf("::numeric ASC"))
    const binding = createHash("sha256").update(stableJson({ tableId: "table", identity: "actor", schemaVersion: 1, filters: [], sort })).digest("hex")
    const data = Buffer.from(JSON.stringify({ binding, values: [10, "row"] })).toString("base64url")
    const cursor = `${data}.${createHmac("sha256", "secret").update(data).digest("base64url")}`
    expect(() => plan({ sort, cursor })).toThrowError(expect.objectContaining({ code: "INVALID_CURSOR" }))
  })
})
