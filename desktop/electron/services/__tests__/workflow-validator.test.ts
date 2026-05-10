import { describe, expect, it } from "vitest"
import { validateWorkflow } from "../workflow/workflow-validator"
import type { WorkflowDefinition } from "../../../src/types/workflow"
import "../../../workflow-nodes/register.main"

const nodeA = { id: "a", name: "A", type: "prompt", position: { x: 0, y: 0 }, config: { agent: "claude-code", variables: [], prompt: "hi" } }
const nodeB = { id: "b", name: "B", type: "prompt", position: { x: 200, y: 0 }, config: { agent: "claude-code", variables: [], prompt: "bye" } }
const base: WorkflowDefinition = { id: "wf", name: "WF", version: "v1", createdAt: 0, updatedAt: 0, params: [], nodes: [nodeA, nodeB], edges: [{ id: "e1", from: "a", to: "b" }] }

describe("validateWorkflow", () => {
  it("returns valid for a clean two-node DAG", () => {
    const r = validateWorkflow(base)
    expect(r.valid).toBe(true); expect(r.errors).toHaveLength(0)
  })
  it("detects a cycle", () => {
    const r = validateWorkflow({ ...base, edges: [{ id: "e1", from: "a", to: "b" }, { id: "e2", from: "b", to: "a" }] })
    expect(r.valid).toBe(false); expect(r.errors.some((e) => e.type === "cycle")).toBe(true)
  })
  it("detects unreachable variable reference", () => {
    const nodeC = { id: "c", name: "C", type: "prompt", position: { x: 0, y: 0 }, config: { agent: "x", variables: [{ name: "x", source: { type: "node_output", node: "a" } }], prompt: "" } }
    const r = validateWorkflow({ ...base, nodes: [nodeA, nodeB, nodeC], edges: [{ id: "e1", from: "b", to: "c" }] })
    expect(r.errors.some((e) => e.type === "unreachable_reference")).toBe(true)
  })
  it("warns about disconnected node", () => {
    const iso = { id: "iso", name: "Iso", type: "prompt", position: { x: 600, y: 0 }, config: { agent: "x", variables: [], prompt: "" } }
    const r = validateWorkflow({ ...base, nodes: [nodeA, nodeB, iso] })
    expect(r.warnings.some((w) => w.type === "disconnected_node")).toBe(true)
  })
  it("errors on switch edge referencing non-existent branch", () => {
    const sw = { id: "sw", name: "S", type: "switch", position: { x: 0, y: 0 }, config: { agent: "x", variables: [], prompt: "?", branches: [{ id: "yes", label: "Y" }] } }
    const r = validateWorkflow({ ...base, nodes: [sw, nodeB], edges: [{ id: "e1", from: "sw", to: "b", branch: "nope" }] })
    expect(r.errors.some((e) => e.type === "invalid_switch_edge")).toBe(true)
  })
  it("errors on switch edge without branch", () => {
    const sw = { id: "sw", name: "S", type: "switch", position: { x: 0, y: 0 }, config: { agent: "x", variables: [], prompt: "?", branches: [{ id: "yes", label: "Y" }] } }
    const r = validateWorkflow({ ...base, nodes: [sw, nodeB], edges: [{ id: "e1", from: "sw", to: "b" }] })
    expect(r.errors.some((e) => e.type === "invalid_switch_edge")).toBe(true)
  })
  it("errors on switch defaultBranch outside branch list", () => {
    const sw = { id: "sw", name: "S", type: "switch", position: { x: 0, y: 0 }, config: { agent: "x", variables: [], prompt: "?", branches: [{ id: "yes", label: "Y" }], defaultBranch: "nope" } }
    const r = validateWorkflow({ ...base, nodes: [sw, nodeB], edges: [{ id: "e1", from: "sw", to: "b", branch: "yes" }] })
    expect(r.errors.some((e) => e.type === "invalid_config" && e.nodeId === "sw")).toBe(true)
  })
})
