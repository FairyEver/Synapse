import { describe, expect, it } from "vitest"
import { layoutWorkflowNodes } from "../workflow-auto-layout"
import {
  resolveSwitchBranchHandlePercent,
  resolveSwitchNodeWidth,
  toDagreRankDirection,
} from "../workflow-layout-direction"
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

    const result = layoutWorkflowNodes(nodes, edges, { layoutDirection: "horizontal" as const })

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

    const result = layoutWorkflowNodes(nodes, edges, { layoutDirection: "vertical" })

    expect(result.find((node) => node.id === "switch")!.position.y)
      .toBeLessThan(result.find((node) => node.id === "end")!.position.y)
  })

  it("uses compact rank and sibling gaps in both layout directions", () => {
    const nodeWidth = 220
    const nodes = [makeNode("start"), makeNode("a"), makeNode("b")]
    const edges = [makeEdge("start", "a"), makeEdge("start", "b")]

    const horizontal = layoutWorkflowNodes(nodes, edges, { layoutDirection: "horizontal", nodeWidth })
    const horizontalStart = horizontal.find((node) => node.id === "start")!
    const horizontalSiblings = horizontal
      .filter((node) => node.id !== "start")
      .sort((left, right) => left.position.y - right.position.y)

    expect(horizontalSiblings[0].position.x - (horizontalStart.position.x + nodeWidth)).toBe(64)
    expect(horizontalSiblings[1].position.y - (horizontalSiblings[0].position.y + 80)).toBe(32)

    const vertical = layoutWorkflowNodes(nodes, edges, { layoutDirection: "vertical", nodeWidth })
    const verticalStart = vertical.find((node) => node.id === "start")!
    const verticalSiblings = vertical
      .filter((node) => node.id !== "start")
      .sort((left, right) => left.position.x - right.position.x)

    expect(verticalSiblings[0].position.y - (verticalStart.position.y + 80)).toBe(64)
    expect(verticalSiblings[1].position.x - (verticalSiblings[0].position.x + nodeWidth)).toBe(32)
  })

  it("keeps empty, dangling, and disconnected layout inputs deterministic", () => {
    const empty: WorkflowNode[] = []
    expect(layoutWorkflowNodes(empty, [], { layoutDirection: "vertical" })).toBe(empty)

    const nodes = [makeNode("connected"), makeNode("end", "end"), makeNode("disconnected", "prompt", 99, 101)]
    const edges = [makeEdge("connected", "end"), makeEdge("missing", "end")]
    const first = layoutWorkflowNodes(nodes, edges, { layoutDirection: "vertical" })
    const second = layoutWorkflowNodes(nodes, edges, { layoutDirection: "vertical" })

    expect(second).toEqual(first)
    expect(first.every((node) => Number.isFinite(node.position.x) && Number.isFinite(node.position.y))).toBe(true)
  })

  it("reserves extra right-side room after switch nodes for branch labels", () => {
    const nodeWidth = 220
    const promptNodes = [makeNode("prompt", "prompt"), makeNode("prompt-end", "end")]
    const switchNodes = [
      makeNode("switch", "switch", 0, 0, { branches: [{ id: "yes", label: "Yes" }] }),
      makeNode("switch-end", "end"),
    ]

    const promptResult = layoutWorkflowNodes(promptNodes, [makeEdge("prompt", "prompt-end")], { layoutDirection: "horizontal" as const, nodeWidth })
    const switchResult = layoutWorkflowNodes(switchNodes, [makeEdge("switch", "switch-end")], { layoutDirection: "horizontal" as const, nodeWidth })

    const prompt = promptResult.find((node) => node.id === "prompt")!
    const promptEnd = promptResult.find((node) => node.id === "prompt-end")!
    const switchNode = switchResult.find((node) => node.id === "switch")!
    const switchEnd = switchResult.find((node) => node.id === "switch-end")!
    const promptRightGap = promptEnd.position.x - (prompt.position.x + nodeWidth)
    const switchRightGap = switchEnd.position.x - (switchNode.position.x + nodeWidth)

    expect(switchRightGap).toBeGreaterThan(promptRightGap)
  })

  it("maps product directions only at the Dagre boundary", () => {
    expect(toDagreRankDirection("horizontal")).toBe("LR")
    expect(toDagreRankDirection("vertical")).toBe("TB")
  })

  it("shares deterministic vertical Switch width and branch positions", () => {
    expect(resolveSwitchNodeWidth("horizontal", 2)).toBe(300)
    expect(resolveSwitchNodeWidth("vertical", 2)).toBe(220)
    expect(resolveSwitchNodeWidth("vertical", 9)).toBe(240)
    expect([0, 1, 2].map((index) => resolveSwitchBranchHandlePercent(index, 3)))
      .toEqual([25, 50, 75])
  })
})
