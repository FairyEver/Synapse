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
  it("resolves local path resource params to their path string", () => {
    const b: VariableBinding[] = [{ name: "input", source: { type: "param", param: "input_file" } }]
    const { resolved } = resolveVariables(b, {
      input_file: { kind: "local_path", entryType: "file", path: "/tmp/input.txt" },
    }, {})

    expect(resolved.input).toBe("/tmp/input.txt")
  })
  it("resolves multi-resource params to an ordered JSON path array", () => {
    const b: VariableBinding[] = [{ name: "inputs", source: { type: "param", param: "input_files" } }]
    const { resolved } = resolveVariables(b, {
      input_files: [
        { kind: "local_path", entryType: "file", path: "/tmp/first.txt" },
        { kind: "local_path", entryType: "file", path: "/tmp/second.txt" },
      ],
    }, {})

    expect(resolved.inputs).toBe('["/tmp/first.txt","/tmp/second.txt"]')
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
  it("throws on missing node when allNodeIds is not provided", () => {
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
    expect(() => interpolatePrompt("{{missing}}", {})).toThrow("未绑定")
  })
  it("replaces {{$prefixed}} tokens", () => {
    expect(interpolatePrompt("{{$name}}", { name: "val" })).toBe("val")
  })
  it("replaces CJK variable name tokens", () => {
    expect(interpolatePrompt("主题：{{主题}}", { 主题: "测试" })).toBe("主题：测试")
  })
  it("replaces Greek letter variable name tokens", () => {
    expect(interpolatePrompt("{{α}}", { α: "alpha" })).toBe("alpha")
  })
  it("replaces Cyrillic variable name tokens", () => {
    expect(interpolatePrompt("{{переменная}}", { переменная: "value" })).toBe("value")
  })
  it("replaces mixed Latin and CJK variable names", () => {
    expect(interpolatePrompt("{{var变量}}", { "var变量": "val" })).toBe("val")
  })
  it("replaces digits in variable names", () => {
    expect(interpolatePrompt("{{v2}}", { v2: "val" })).toBe("val")
  })
  it("replaces variable names with hyphens, dots, and surrounding spaces", () => {
    expect(interpolatePrompt("{{ my-var }} {{obj.name}}", { "my-var": "a", "obj.name": "b" })).toBe("a b")
  })
})
