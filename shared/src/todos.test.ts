import { describe, expect, it } from "vitest"
import { countTodoCodePoints, isValidTodoText, parseTodoInstant, parseTodoReference } from "./todos.js"

describe("todo wire primitives", () => {
  it("counts non-BMP text by Unicode code points", () => {
    expect(countTodoCodePoints("😀".repeat(200))).toBe(200)
    expect(countTodoCodePoints("a\u0301")).toBe(2)
  })
  it("rejects malformed Unicode and PostgreSQL NUL text", () => {
    expect(isValidTodoText("\ud800")).toBe(false)
    expect(isValidTodoText("\udc00")).toBe(false)
    expect(isValidTodoText("a\0b")).toBe(false)
    expect(isValidTodoText("😀")).toBe(true)
  })
  it("preserves an instant across explicit timezone offsets", () => {
    expect(parseTodoInstant("2026-10-12T09:00:00+08:00")?.toISOString()).toBe("2026-10-12T01:00:00.000Z")
    expect(parseTodoInstant("2026-10-11T18:00:00-07:00")?.toISOString()).toBe("2026-10-12T01:00:00.000Z")
  })
  it.each(["2026-02-30T01:00:00Z", "2026-10-12T09:00:01Z", "2026-10-12T09:00:00.001Z", "2026-10-12T09:00:00", "2026-10-12T24:00:00Z"])("rejects an invalid or imprecise instant: %s", (value) => {
    expect(parseTodoInstant(value)).toBeNull()
  })
  it("accepts one read-only todo reference", () => {
    expect(parseTodoReference("synapse://todos/abc_123-xyz")).toBe("abc_123-xyz")
  })
  it.each(["synapse://todos/a?completed=true", "synapse://todos/a#b", "synapse://todos/a/b", "synapse://todos/a%2Fb", "synapse://todos/%61", "synapse://other/a", "synapse://todos/"])("rejects ambiguous reference: %s", (value) => {
    expect(parseTodoReference(value)).toBeNull()
  })
})
