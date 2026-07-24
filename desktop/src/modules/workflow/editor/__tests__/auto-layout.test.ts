import { describe, expect, it } from "vitest"
import type { Node, Edge } from "@xyflow/react"
import { autoLayoutNodes } from "../auto-layout"

function makeNode(id: string, x = 0, y = 0): Node {
  return { id, type: "prompt", position: { x, y }, data: {} }
}

function makeEdge(source: string, target: string): Edge {
  return { id: `${source}-${target}`, source, target }
}

describe("autoLayoutNodes", () => {
  it("returns empty array for empty input", () => {
    expect(autoLayoutNodes([], [])).toEqual([])
  })

  it("returns single node with a position", () => {
    const nodes = [makeNode("a")]
    const result = autoLayoutNodes(nodes, [])
    expect(result).toHaveLength(1)
    expect(result[0].id).toBe("a")
    expect(typeof result[0].position.x).toBe("number")
    expect(typeof result[0].position.y).toBe("number")
  })

  it("arranges a linear chain left-to-right", () => {
    const nodes = [makeNode("a"), makeNode("b"), makeNode("c")]
    const edges = [makeEdge("a", "b"), makeEdge("b", "c")]
    const result = autoLayoutNodes(nodes, edges, { layoutDirection: "horizontal" as const })

    const posA = result.find((n) => n.id === "a")!.position
    const posB = result.find((n) => n.id === "b")!.position
    const posC = result.find((n) => n.id === "c")!.position

    expect(posA.x).toBeLessThan(posB.x)
    expect(posB.x).toBeLessThan(posC.x)
  })

  it("arranges a linear chain top-to-bottom when direction is TB", () => {
    const nodes = [makeNode("a"), makeNode("b")]
    const edges = [makeEdge("a", "b")]
    const result = autoLayoutNodes(nodes, edges, { layoutDirection: "vertical" })

    const posA = result.find((n) => n.id === "a")!.position
    const posB = result.find((n) => n.id === "b")!.position

    expect(posA.y).toBeLessThan(posB.y)
  })

  it("handles branching DAG without errors", () => {
    const nodes = [makeNode("start"), makeNode("a"), makeNode("b"), makeNode("end")]
    const edges = [
      makeEdge("start", "a"),
      makeEdge("start", "b"),
      makeEdge("a", "end"),
      makeEdge("b", "end"),
    ]
    const result = autoLayoutNodes(nodes, edges)
    expect(result).toHaveLength(4)
    // start should be leftmost
    const startX = result.find((n) => n.id === "start")!.position.x
    const endX = result.find((n) => n.id === "end")!.position.x
    expect(startX).toBeLessThan(endX)
  })

  it("does not mutate input nodes", () => {
    const nodes = [makeNode("a", 100, 200), makeNode("b", 300, 400)]
    const edges = [makeEdge("a", "b")]
    const originalPositions = nodes.map((n) => ({ ...n.position }))
    autoLayoutNodes(nodes, edges)
    nodes.forEach((n, i) => {
      expect(n.position).toEqual(originalPositions[i])
    })
  })

  it("ignores edges referencing nonexistent nodes", () => {
    const nodes = [makeNode("a"), makeNode("b")]
    const edges = [makeEdge("a", "b"), makeEdge("a", "ghost")]
    const result = autoLayoutNodes(nodes, edges)
    expect(result).toHaveLength(2)
  })
})
