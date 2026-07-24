import { describe, expect, it } from "vitest"

import {
  buildJsonInput,
  parseScriptJsonText,
  parseScriptPathText,
  readJsonPath,
  scriptBindingNameSchema,
} from "../input"

describe("script input contract", () => {
  it("uses null-prototype records and rejects ambiguous binding names", () => {
    const input = buildJsonInput([{ name: "value", value: 1 }])

    expect(Object.getPrototypeOf(input)).toBeNull()
    expect(input).toEqual({ value: 1 })
    expect(scriptBindingNameSchema.safeParse("__proto__").success).toBe(false)
    expect(scriptBindingNameSchema.safeParse("constructor").success).toBe(false)
  })

  it("keeps dotted object keys distinct from numeric array path segments", () => {
    expect(readJsonPath({ "user.id": 7 }, ["user.id"])).toBe(7)
    expect(readJsonPath({ items: ["zero", "one"] }, ["items", 1])).toBe("one")
    expect(() => readJsonPath({ items: ["zero"] }, ["items", "0"])).toThrow()
  })

  it("keeps invalid JSON drafts editable without accepting invalid values", () => {
    expect(parseScriptJsonText("{")).toEqual({ ok: false })
    expect(parseScriptJsonText('{"ok":true}')).toEqual({ ok: true, value: { ok: true } })
    expect(parseScriptPathText('["items",1]')).toEqual({ ok: true, value: ["items", 1] })
    expect(parseScriptPathText('["items",-1]')).toEqual({ ok: false })
  })
})
