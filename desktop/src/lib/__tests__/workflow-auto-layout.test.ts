import { describe, expect, it } from "vitest"
import { layoutWorkflowNodes } from "../workflow-auto-layout"
import type { WorkflowEdge, WorkflowNode } from "../../types/workflow"

function makeNode(id: string, type = "prompt", x = 0, y = 0, config: Record<string, unknown> = {}): WorkflowNode {
  return { id, name: id, type, position: { x, y }, config }
}

function makeEdge(from: string, to: string): WorkflowEdge {
  return { id: `${from}-${to}`, from, to }
}

describe("layoutWorkflowNodes", () => {
  it("arranges workflow nodes left-to-right without mutating the input", () => {
    const nodes = [makeNode("a", "prompt", 10, 20), makeNode("b", "prompt", 30, 40), makeNode("end", "end", 50, 60)]
    const edges = [makeEdge("a", "b"), makeEdge("b", "end"), makeEdge("missing", "end")]
    const original = structuredClone(nodes)

    const result = layoutWorkflowNodes(nodes, edges, { direction: "LR" })

    expect(nodes).toEqual(original)
    expect(result).toHaveLength(3)
    expect(result.find((node) => node.id === "a")!.position.x)
      .toBeLessThan(result.find((node) => node.id === "b")!.position.x)
    expect(result.find((node) => node.id === "b")!.position.x)
      .toBeLessThan(result.find((node) => node.id === "end")!.position.x)
  })

  it("supports top-to-bottom layout for workflow definitions", () => {
    const nodes = [
      makeNode("switch", "switch", 0, 0, { branches: [{ id: "yes" }, { id: "no" }] }),
      makeNode("end", "end"),
    ]
    const edges = [makeEdge("switch", "end")]

    const result = layoutWorkflowNodes(nodes, edges, { direction: "TB" })

    expect(result.find((node) => node.id === "switch")!.position.y)
      .toBeLessThan(result.find((node) => node.id === "end")!.position.y)
  })
})
