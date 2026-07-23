import { describe, expect, it } from "vitest"
import { normalizeHtmlGenerationInput, validateHtmlGenerationOutput } from "../normalization"

describe("HTML Generator normalization", () => {
  it("detaches a strict JSON object and does not preserve repeated-reference identity", () => {
    const shared = { title: "hello" }
    const result = normalizeHtmlGenerationInput({ template: "<%= data.left.title %>", data: { left: shared, right: shared } })

    expect(result.data).toEqual({ left: { title: "hello" }, right: { title: "hello" } })
    expect(result.data.left).not.toBe(result.data.right)
    expect(result.inputBytes).toBe(Buffer.byteLength(JSON.stringify({ template: result.template, data: result.data }), "utf8"))
  })

  it.each([
    ["cycle", () => { const value: Record<string, unknown> = {}; value.self = value; return value }],
    ["date", () => ({ value: new Date() })],
    ["undefined", () => ({ value: undefined })],
    ["bigint", () => ({ value: BigInt(1) })],
    ["sparse array", () => ({ value: new Array(1) })],
    ["array property", () => { const value: unknown[] = []; Object.defineProperty(value, "extra", { value: 1, enumerable: true }); return { value } }],
    ["accessor", () => { const value = {}; Object.defineProperty(value, "secret", { get: () => "x", enumerable: true }); return value }],
  ])("rejects non-JSON %s data without coercion", (_name, makeData) => {
    expect(() => normalizeHtmlGenerationInput({ template: "ok", data: makeData() })).toThrow(expect.objectContaining({ code: "INVALID_DATA" }))
  })

  it("rejects lone surrogates in template, data keys, data values, and output", () => {
    const loneSurrogate = String.fromCharCode(0xd800)
    expect(() => normalizeHtmlGenerationInput({ template: loneSurrogate, data: {} })).toThrow(expect.objectContaining({ code: "INVALID_TEMPLATE" }))
    expect(() => normalizeHtmlGenerationInput({ template: "ok", data: { value: loneSurrogate } })).toThrow(expect.objectContaining({ code: "INVALID_DATA" }))
    expect(() => normalizeHtmlGenerationInput({ template: "ok", data: { [loneSurrogate]: "x" } })).toThrow(expect.objectContaining({ code: "INVALID_DATA" }))
    expect(() => validateHtmlGenerationOutput(loneSurrogate, 3)).toThrow(expect.objectContaining({ code: "RENDER_FAILED" }))
  })

  it("distinguishes template, data, combined input, and output byte limits", () => {
    expect(() => normalizeHtmlGenerationInput({ template: "x".repeat(256 * 1024 + 1), data: {} }))
      .toThrow(expect.objectContaining({ code: "TEMPLATE_TOO_LARGE" }))
    expect(() => normalizeHtmlGenerationInput({ template: "x", data: { value: "x".repeat(512 * 1024) } }))
      .toThrow(expect.objectContaining({ code: "DATA_TOO_LARGE" }))
    expect(() => validateHtmlGenerationOutput("x".repeat(5 * 1024 * 1024 + 1)))
      .toThrow(expect.objectContaining({ code: "OUTPUT_TOO_LARGE" }))
  })
})
