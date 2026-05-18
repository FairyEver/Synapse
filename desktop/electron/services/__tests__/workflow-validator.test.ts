import { describe, expect, it, vi } from "vitest"

vi.mock("electron", () => ({ app: { getPath: () => "/tmp", getAppPath: () => "/tmp" } }))

import { buildEffectiveRunParams, validateRunParams, validateWorkflow } from "../workflow/workflow-validator"
import type { WorkflowDefinition } from "../../../src/types/workflow"
import "../../../workflow-nodes/register.main"

const nodeA = { id: "a", name: "A", type: "prompt", position: { x: 0, y: 0 }, config: { providerId: "test-provider", modelTier: "sonnet", variables: [], prompt: "hi" } }
const nodeB = { id: "b", name: "B", type: "prompt", position: { x: 200, y: 0 }, config: { providerId: "test-provider", modelTier: "sonnet", variables: [], prompt: "bye" } }
const nodeEnd = { id: "end", name: "结束", type: "end", position: { x: 400, y: 0 }, config: { outputType: "text", template: "{{result}}", variables: [{ name: "result", source: { type: "node_output", node: "b" } }] } }

// base now includes an End Node so existing tests keep passing
const base: WorkflowDefinition = {
  id: "wf", name: "WF", version: "v1", createdAt: 0, updatedAt: 0, params: [],
  nodes: [nodeA, nodeB, nodeEnd],
  edges: [{ id: "e1", from: "a", to: "b" }, { id: "e2", from: "b", to: "end" }],
}

describe("validateWorkflow", () => {
  it("returns valid for a clean two-node DAG with end node", () => {
    const r = validateWorkflow(base)
    expect(r.valid).toBe(true); expect(r.errors).toHaveLength(0)
  })
  it("detects a cycle", () => {
    const r = validateWorkflow({ ...base, edges: [{ id: "e1", from: "a", to: "b" }, { id: "e2", from: "b", to: "a" }, { id: "e3", from: "b", to: "end" }] })
    expect(r.valid).toBe(false); expect(r.errors.some((e) => e.type === "cycle")).toBe(true)
  })
  it("detects unreachable variable reference", () => {
    const nodeC = { id: "c", name: "C", type: "prompt", position: { x: 0, y: 0 }, config: { providerId: "test-provider", modelTier: "sonnet", variables: [{ name: "x", source: { type: "node_output", node: "a" } }], prompt: "" } }
    const r = validateWorkflow({ ...base, nodes: [nodeA, nodeB, nodeC, nodeEnd], edges: [{ id: "e1", from: "b", to: "c" }, { id: "e2", from: "c", to: "end" }] })
    expect(r.errors.some((e) => e.type === "unreachable_reference")).toBe(true)
  })
  it("warns about disconnected node", () => {
    const iso = { id: "iso", name: "Iso", type: "prompt", position: { x: 600, y: 0 }, config: { providerId: "test-provider", modelTier: "sonnet", variables: [], prompt: "" } }
    const r = validateWorkflow({ ...base, nodes: [nodeA, nodeB, nodeEnd, iso] })
    expect(r.warnings.some((w) => w.type === "disconnected_node")).toBe(true)
  })
  it("errors on switch edge referencing non-existent branch", () => {
    const sw = { id: "sw", name: "S", type: "switch", position: { x: 0, y: 0 }, config: { providerId: "test-provider", modelTier: "sonnet", variables: [], prompt: "?", branches: [{ id: "yes", label: "Y" }] } }
    const r = validateWorkflow({ ...base, nodes: [sw, nodeB, nodeEnd], edges: [{ id: "e1", from: "sw", to: "b", branch: "nope" }, { id: "e2", from: "b", to: "end" }] })
    expect(r.errors.some((e) => e.type === "invalid_switch_edge")).toBe(true)
  })
  it("errors on switch edge without branch", () => {
    const sw = { id: "sw", name: "S", type: "switch", position: { x: 0, y: 0 }, config: { providerId: "test-provider", modelTier: "sonnet", variables: [], prompt: "?", branches: [{ id: "yes", label: "Y" }] } }
    const r = validateWorkflow({ ...base, nodes: [sw, nodeB, nodeEnd], edges: [{ id: "e1", from: "sw", to: "b" }, { id: "e2", from: "b", to: "end" }] })
    expect(r.errors.some((e) => e.type === "invalid_switch_edge")).toBe(true)
  })
  it("errors on switch defaultBranch outside branch list", () => {
    const sw = { id: "sw", name: "S", type: "switch", position: { x: 0, y: 0 }, config: { providerId: "test-provider", modelTier: "sonnet", variables: [], prompt: "?", branches: [{ id: "yes", label: "Y" }], defaultBranch: "nope" } }
    const r = validateWorkflow({ ...base, nodes: [sw, nodeB, nodeEnd], edges: [{ id: "e1", from: "sw", to: "b", branch: "yes" }, { id: "e2", from: "b", to: "end" }] })
    expect(r.errors.some((e) => e.type === "invalid_config" && e.nodeId === "sw")).toBe(true)
  })
  it("errors on unknown node type", () => {
    const unknown = { id: "u", name: "Unknown", type: "unknown", position: { x: 0, y: 0 }, config: {} }
    const r = validateWorkflow({ ...base, nodes: [unknown, nodeEnd], edges: [{ id: "e1", from: "u", to: "end" }] })
    expect(r.errors.some((e) => e.type === "invalid_config" && e.nodeId === "u")).toBe(true)
  })
  it("errors on edge referencing a missing node", () => {
    const r = validateWorkflow({ ...base, edges: [{ id: "missing", from: "a", to: "nope" }, { id: "e2", from: "a", to: "end" }] })
    expect(r.errors.some((e) => e.type === "invalid_config" && e.edgeId === "missing")).toBe(true)
  })
  it("does not report a cycle for an edge that only references a missing node", () => {
    const r = validateWorkflow({ ...base, edges: [{ id: "missing", from: "a", to: "nope" }, { id: "e2", from: "a", to: "end" }] })
    expect(r.errors.some((e) => e.type === "cycle")).toBe(false)
  })
  it("errors on duplicate node ids", () => {
    const duplicate = { ...nodeB, name: "Duplicate B" }
    const r = validateWorkflow({ ...base, nodes: [nodeA, nodeB, duplicate, nodeEnd] })
    expect(r.errors.some((e) => e.type === "invalid_config" && e.nodeId === "b")).toBe(true)
  })
  it("errors on duplicate edge ids", () => {
    const r = validateWorkflow({
      ...base,
      edges: [{ id: "e1", from: "a", to: "b" }, { id: "e1", from: "b", to: "end" }],
    })
    expect(r.errors.some((e) => e.type === "invalid_config" && e.edgeId === "e1")).toBe(true)
  })

  // New: End Node enforcement
  it("errors when no end node exists", () => {
    const r = validateWorkflow({ ...base, nodes: [nodeA, nodeB], edges: [{ id: "e1", from: "a", to: "b" }] })
    expect(r.valid).toBe(false)
    expect(r.errors.some((e) => e.type === "missing_end_node")).toBe(true)
  })
  it("errors when multiple end nodes exist", () => {
    const nodeEnd2 = { ...nodeEnd, id: "end2" }
    const r = validateWorkflow({ ...base, nodes: [nodeA, nodeB, nodeEnd, nodeEnd2], edges: [{ id: "e1", from: "a", to: "b" }, { id: "e2", from: "b", to: "end" }, { id: "e3", from: "b", to: "end2" }] })
    expect(r.valid).toBe(false)
    expect(r.errors.some((e) => e.type === "multiple_end_nodes")).toBe(true)
  })
  it("errors when an end node has outgoing edges", () => {
    const r = validateWorkflow({
      ...base,
      edges: [
        { id: "e1", from: "a", to: "end" },
        { id: "e2", from: "end", to: "b" },
      ],
    })
    expect(r.valid).toBe(false)
    expect(r.errors.some((e) => e.type === "invalid_config" && e.nodeId === "end")).toBe(true)
  })

  // Provider resolution validation
  it("errors when prompt node has no providerId and workflow has no default", () => {
    const nodeNoProvider = { id: "np", name: "NP", type: "prompt", position: { x: 0, y: 0 }, config: { variables: [], prompt: "hi" } }
    const r = validateWorkflow({ ...base, nodes: [nodeNoProvider, nodeEnd], edges: [{ id: "e1", from: "np", to: "end" }] })
    expect(r.valid).toBe(false)
    expect(r.errors.some((e) => e.type === "invalid_config" && e.nodeId === "np" && e.message.includes("供应商"))).toBe(true)
  })

  it("errors when prompt node has no modelTier and workflow has no default", () => {
    const nodeNoTier = { id: "nt", name: "NT", type: "prompt", position: { x: 0, y: 0 }, config: { providerId: "test-provider", variables: [], prompt: "hi" } }
    const r = validateWorkflow({ ...base, nodes: [nodeNoTier, nodeEnd], edges: [{ id: "e1", from: "nt", to: "end" }] })
    expect(r.valid).toBe(false)
    expect(r.errors.some((e) => e.type === "invalid_config" && e.nodeId === "nt" && e.message.includes("模型"))).toBe(true)
  })

  it("passes when node omits provider but workflow has defaultProviderId + defaultModelTier", () => {
    const nodeNoProvider = { id: "np", name: "NP", type: "prompt", position: { x: 0, y: 0 }, config: { variables: [], prompt: "hi" } }
    const endWithBinding = { ...nodeEnd, config: { ...nodeEnd.config, variables: [{ name: "result", source: { type: "node_output", node: "np" } }] } }
    const defWithDefault = { ...base, defaultProviderId: "test-provider", defaultModelTier: "sonnet" as const, nodes: [nodeNoProvider, endWithBinding], edges: [{ id: "e1", from: "np", to: "end" }] }
    const r = validateWorkflow(defWithDefault)
    expect(r.valid).toBe(true)
  })

  it("passes when switch node omits provider but workflow has defaults", () => {
    const sw = { id: "sw", name: "S", type: "switch", position: { x: 0, y: 0 }, config: { variables: [], prompt: "?", branches: [{ id: "yes", label: "Y" }] } }
    const defWithDefault = { ...base, defaultProviderId: "test-provider", defaultModelTier: "sonnet" as const, nodes: [sw, nodeB, nodeEnd], edges: [{ id: "e1", from: "sw", to: "b", branch: "yes" }, { id: "e2", from: "b", to: "end" }] }
    const r = validateWorkflow(defWithDefault)
    expect(r.valid).toBe(true)
  })

  // Edge case: switch branch with no outgoing edge
  it("errors when switch branch has no outgoing edge", () => {
    const sw = { id: "sw", name: "S", type: "switch", position: { x: 0, y: 0 }, config: { providerId: "test-provider", modelTier: "sonnet", variables: [], prompt: "?", branches: [{ id: "yes", label: "Y" }, { id: "no", label: "N" }] } }
    const r = validateWorkflow({ ...base, nodes: [sw, nodeB, nodeEnd], edges: [{ id: "e1", from: "sw", to: "b", branch: "yes" }, { id: "e2", from: "b", to: "end" }] })
    expect(r.errors.some((e) => e.type === "invalid_switch_edge" && e.message.includes("N"))).toBe(true)
  })

  // Edge case: switch branch edge exists but path cannot reach end node
  it("errors when switch branch path cannot reach end node", () => {
    const sw = { id: "sw", name: "S", type: "switch", position: { x: 0, y: 0 }, config: { providerId: "test-provider", modelTier: "sonnet", variables: [], prompt: "?", branches: [{ id: "yes", label: "Y" }, { id: "no", label: "N" }] } }
    const nodeC = { id: "c", name: "C", type: "prompt", position: { x: 400, y: 200 }, config: { providerId: "test-provider", modelTier: "sonnet", variables: [], prompt: "" } }
    const r = validateWorkflow({ ...base, nodes: [sw, nodeB, nodeC, nodeEnd], edges: [{ id: "e1", from: "sw", to: "b", branch: "yes" }, { id: "e2", from: "sw", to: "c", branch: "no" }, { id: "e3", from: "b", to: "end" }] })
    expect(r.errors.some((e) => e.type === "invalid_switch_edge" && e.message.includes("N"))).toBe(true)
  })

  // Edge case: non-switch node edge incorrectly carries a branch field
  it("errors on non-switch edge with orphan branch field", () => {
    const r = validateWorkflow({ ...base, edges: [{ id: "e1", from: "a", to: "b", branch: "yes" }, { id: "e2", from: "b", to: "end" }] })
    expect(r.errors.some((e) => e.type === "orphan_edge_branch")).toBe(true)
  })

  // Edge case: end node exists but nothing connects to it
  it("warns when end node has no incoming edges", () => {
    const endNoIncoming = { ...nodeEnd, config: { ...nodeEnd.config, variables: [{ name: "result", source: { type: "static", value: "" } }] } }
    const r = validateWorkflow({ ...base, nodes: [nodeA, nodeB, endNoIncoming], edges: [{ id: "e1", from: "a", to: "b" }] })
    expect(r.valid).toBe(true)
    expect(r.warnings.some((w) => w.type === "disconnected_node" && w.nodeId === "end")).toBe(true)
  })

  it("rejects whitespace-only param names", () => {
    const r = validateWorkflow({ ...base, params: [{ name: " ", type: "text", default: null }] })
    expect(r.valid).toBe(false)
    expect(r.errors[0]).toMatchObject({ type: "invalid_config", message: "工作流参数名称不能为空" })
  })

  // Edge case: multiple nodes with no incoming edges
  it("warns about multiple explicit start nodes", () => {
    const startA = { ...nodeA, type: "start" }
    const startB = { ...nodeB, type: "start" }
    const r = validateWorkflow({ ...base, nodes: [startA, startB, nodeEnd], edges: [{ id: "e1", from: "a", to: "end" }, { id: "e2", from: "b", to: "end" }] })
    expect(r.warnings.some((w) => w.type === "multiple_start_nodes")).toBe(true)
  })

  it("does not report multiple start nodes for ordinary root nodes", () => {
    const r = validateWorkflow({ ...base, edges: [{ id: "e1", from: "a", to: "end" }, { id: "e2", from: "b", to: "end" }] })
    expect(r.warnings.some((w) => w.type === "multiple_start_nodes")).toBe(false)
  })
})

describe("validateRunParams", () => {
  it("returns missing_param when a required text param is omitted", () => {
    const def: WorkflowDefinition = { ...base, params: [{ name: "text", type: "text", default: null }] }
    const errors = validateRunParams(def, {})
    expect(errors).toHaveLength(1)
    expect(errors[0]).toMatchObject({ type: "missing_param", message: "缺少必填参数「text」" })
  })

  it("allows omitted params when defaults are configured", () => {
    const def: WorkflowDefinition = { ...base, params: [{ name: "text", type: "text", default: "默认文本" }] }
    expect(validateRunParams(def, {})).toHaveLength(0)
  })

  it("validates number params passed as strings", () => {
    const def: WorkflowDefinition = { ...base, params: [{ name: "count", type: "number", default: null }] }
    expect(validateRunParams(def, { count: "12" })).toHaveLength(0)
    expect(validateRunParams(def, { count: "abc" })[0]).toMatchObject({ type: "invalid_config", message: "参数「count」必须是数字" })
  })

  it("treats an explicit empty text param as a provided value", () => {
    const def: WorkflowDefinition = { ...base, params: [{ name: "text", type: "text", default: null }] }

    expect(validateRunParams(def, { text: "" })).toHaveLength(0)
  })

  it("allows an empty text default", () => {
    const def: WorkflowDefinition = { ...base, params: [{ name: "text", type: "text", default: "" }] }

    expect(validateRunParams(def, {})).toHaveLength(0)
  })
})

describe("buildEffectiveRunParams", () => {
  it("fills missing params from defaults without overwriting explicit values", () => {
    const def: WorkflowDefinition = {
      ...base,
      params: [
        { name: "text", type: "text", default: "默认文本" },
        { name: "count", type: "number", default: 3 },
      ],
    }
    expect(buildEffectiveRunParams(def, { text: "显式文本" })).toEqual({ text: "显式文本", count: 3 })
  })

  it("handles null default without including it in effective params", () => {
    const def: WorkflowDefinition = {
      ...base,
      params: [{ name: "a", type: "text", default: null }],
    }
    expect(buildEffectiveRunParams(def, {})).toEqual({})
    expect(buildEffectiveRunParams(def, { a: "explicit" })).toEqual({ a: "explicit" })
  })

  it("preserves explicit empty text params and applies empty defaults", () => {
    const def: WorkflowDefinition = {
      ...base,
      params: [
        { name: "explicit", type: "text", default: "fallback" },
        { name: "emptyDefault", type: "text", default: "" },
      ],
    }

    expect(buildEffectiveRunParams(def, { explicit: "" })).toEqual({
      explicit: "",
      emptyDefault: "",
    })
  })
})
