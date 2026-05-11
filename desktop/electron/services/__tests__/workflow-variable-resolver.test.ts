import { describe, expect, it } from "vitest"
import { resolveVariables, interpolatePrompt } from "../workflow/variable-resolver"
import type { VariableBinding } from "../../../workflow-nodes/schemas/variable-binding"

describe("resolveVariables", () => {
  it("resolves param source", () => {
    const b: VariableBinding[] = [{ name: "t", source: { type: "param", param: "topic" } }]
    expect(resolveVariables(b, { topic: "TS" }, {})).toEqual({ t: "TS" })
  })
  it("resolves node_output source", () => {
    const b: VariableBinding[] = [{ name: "r", source: { type: "node_output", node: "n1" } }]
    expect(resolveVariables(b, {}, { n1: "output" })).toEqual({ r: "output" })
  })
  it("throws when node output missing (skipped branch)", () => {
    const b: VariableBinding[] = [{ name: "x", source: { type: "node_output", node: "missing" } }]
    expect(() => resolveVariables(b, {}, {})).toThrow("missing")
  })
  it("resolves static source", () => {
    const b: VariableBinding[] = [{ name: "g", source: { type: "static", value: "Hello" } }]
    expect(resolveVariables(b, {}, {})).toEqual({ g: "Hello" })
  })
})

describe("interpolatePrompt", () => {
  it("replaces {{name}} tokens", () => {
    expect(interpolatePrompt("Hello {{name}}", { name: "world" })).toBe("Hello world")
  })
  it("leaves unresolved tokens unchanged", () => {
    expect(interpolatePrompt("{{missing}}", {})).toBe("{{missing}}")
  })
})
