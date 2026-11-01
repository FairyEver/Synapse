import { describe, expect, it } from "vitest"
import { normalizeValues, validateFields, authorize, assertJsonBudget } from "./cloud-table-validation"

const fields = [{ key: "name", name: "姓名", type: "text" as const, required: true }, { key: "done", name: "完成", type: "boolean" as const, defaultValue: false }]
describe("cloud table validation and ACL", () => {
  it("bounds JSON depth and node work before recursive schema validation", () => {
    let nested: unknown = null
    for (let i = 0; i < 40; i++) nested = [nested]
    expect(() => assertJsonBudget(nested)).toThrowError(expect.objectContaining({ code: "JSON_TOO_COMPLEX" }))
    expect(() => assertJsonBudget(Array.from({ length: 50001 }, () => 0))).toThrowError(expect.objectContaining({ code: "JSON_TOO_COMPLEX" }))
    expect(() => assertJsonBudget({ rows: [{ name: "normal", values: [1, true, null] }] })).not.toThrow()
  })
  it("materializes defaults without coercing wrong types or accepting unknown metadata", () => {
    expect(normalizeValues(fields, { name: "Li" })).toEqual({ name: "Li", done: false })
    expect(() => normalizeValues(fields, { name: 1 })).toThrow()
    expect(() => normalizeValues(fields, { name: "Li", createdBy: "other" })).toThrow()
    expect(() => normalizeValues(fields, {})).toThrow()
  })
  it("rejects impossible dates, unsafe integers, duplicate options and oversized records", () => {
    expect(() => normalizeValues([{ key: "day", name: "日期", type: "date" }], { day: "2026-02-30" })).toThrow()
    expect(() => normalizeValues([{ key: "n", name: "数", type: "integer" }], { n: Number.MAX_SAFE_INTEGER + 1 })).toThrow()
    expect(() => validateFields([{ key: "s", name: "选项", type: "singleSelect", options: [{ key: "a", name: "A" }, { key: "a", name: "B" }] }])).toThrow()
    expect(() => normalizeValues(fields, { name: "x".repeat(65536) })).toThrow()
    expect(() => validateFields([{ key: "large", name: "大默认值", type: "text", defaultValue: "x".repeat(65536) }])).toThrow()
  })
  it("never treats anonymous records as a user's own and always preserves owner management", () => {
    const table = { ownerId: "owner", anonymous: { read: true }, members: [{ userId: "member", permissions: { read: "own" as const, create: "all" as const } }] }
    expect(authorize(table, null, "read")).toBe("all")
    expect(authorize(table, "member", "read")).toBe("own")
    expect(authorize(table, "owner", "manage")).toBe("all")
    expect(() => authorize(table, "member", "manage")).toThrow()
    expect(() => authorize(table, null, "delete")).toThrow()
  })
})
