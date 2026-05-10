import { describe, expect, it } from "vitest"
import { variableBindingSchema } from "../variable-binding"

describe("variableBindingSchema", () => {
  it("accepts valid names: letter, underscore prefix", () => {
    expect(variableBindingSchema.safeParse({ name: "myVar", source: { type: "static", value: "x" } }).success).toBe(true)
    expect(variableBindingSchema.safeParse({ name: "_private", source: { type: "static", value: "x" } }).success).toBe(true)
  })
  it("rejects names starting with digit or containing hyphens", () => {
    expect(variableBindingSchema.safeParse({ name: "1bad", source: { type: "static", value: "x" } }).success).toBe(false)
    expect(variableBindingSchema.safeParse({ name: "bad-name", source: { type: "static", value: "x" } }).success).toBe(false)
  })
  it("accepts all source types", () => {
    expect(variableBindingSchema.safeParse({ name: "a", source: { type: "param", param: "p" } }).success).toBe(true)
    expect(variableBindingSchema.safeParse({ name: "a", source: { type: "node_output", node: "n1" } }).success).toBe(true)
  })
})
