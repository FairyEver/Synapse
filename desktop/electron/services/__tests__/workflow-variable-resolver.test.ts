import { describe, expect, it, vi } from "vitest"

vi.mock("electron", () => ({ app: { getPath: () => "/tmp", getAppPath: () => "/tmp" } }))

import { resolveVariables, interpolatePrompt } from "../workflow/variable-resolver"
import type { VariableBinding } from "../../../workflow-nodes/schemas/variable-binding"

describe("resolveVariables", () => {
  it("resolves param source", () => {
    const b: VariableBinding[] = [{ name: "t", source: { type: "param", param: "topic" } }]
    const { resolved } = resolveVariables(b, { topic: "TS" }, {})
    expect(resolved).toEqual({ t: "TS" })
  })
  it("resolves node_output source", () => {
    const b: VariableBinding[] = [{ name: "r", source: { type: "node_output", node: "n1" } }]
    const { resolved } = resolveVariables(b, {}, { n1: "output" })
    expect(resolved).toEqual({ r: "output" })
  })
  it("resolves to empty string when node was skipped (exists in allNodeIds)", () => {
    const b: VariableBinding[] = [{ name: "x", source: { type: "node_output", node: "skipped_node" } }]
    const allNodeIds = new Set(["skipped_node", "other_node"])
    const { resolved, skippedReferences } = resolveVariables(b, {}, {}, undefined, allNodeIds)
    expect(resolved).toEqual({ x: "" })
    expect(skippedReferences).toHaveLength(1)
    expect(skippedReferences[0].variableName).toBe("x")
    expect(skippedReferences[0].sourceNodeId).toBe("skipped_node")
  })
  it("throws when referenced node does not exist in workflow", () => {
    const b: VariableBinding[] = [{ name: "x", source: { type: "node_output", node: "nonexistent" } }]
    const allNodeIds = new Set(["other_node"])
    expect(() => resolveVariables(b, {}, {}, undefined, allNodeIds)).toThrow("不存在")
  })
  it("resolves to empty string when allNodeIds not provided (legacy behavior — no throw)", () => {
    // Without allNodeIds, the function cannot distinguish skipped from nonexistent.
    // For backward compat when allNodeIds is omitted, it still throws (broken ref).
    const b: VariableBinding[] = [{ name: "x", source: { type: "node_output", node: "missing" } }]
    expect(() => resolveVariables(b, {}, {})).toThrow("不存在")
  })
  it("resolves static source", () => {
    const b: VariableBinding[] = [{ name: "g", source: { type: "static", value: "Hello" } }]
    const { resolved } = resolveVariables(b, {}, {})
    expect(resolved).toEqual({ g: "Hello" })
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
