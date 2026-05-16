import dagre from "@dagrejs/dagre"
import type { Node, Edge } from "@xyflow/react"
import { SWITCH_HEADER_H, SWITCH_BRANCH_H } from "../../../../workflow-nodes/switch/constants"

export interface AutoLayoutOptions {
  direction?: "LR" | "TB"
  nodeWidth?: number
  nodeHeight?: number
}

const DEFAULT_NODE_WIDTH = 220
const DEFAULT_NODE_HEIGHT = 80

function resolveNodeHeight(node: Node): number {
  if (node.type === "switch") {
    const branches = (node.data as { branches?: Array<unknown> })?.branches
    const count = branches?.length ?? 0
    return SWITCH_HEADER_H + count * SWITCH_BRANCH_H
  }
  return DEFAULT_NODE_HEIGHT
}

export function autoLayoutNodes(
  nodes: Node[],
  edges: Edge[],
  options?: AutoLayoutOptions,
): Node[] {
  if (nodes.length === 0) return nodes

  const direction = options?.direction ?? "LR"
  const nodeWidth = options?.nodeWidth ?? DEFAULT_NODE_WIDTH

  const g = new dagre.graphlib.Graph()
  g.setDefaultEdgeLabel(() => ({}))
  g.setGraph({ rankdir: direction, nodesep: 40, ranksep: 80 })

  for (const node of nodes) {
    g.setNode(node.id, { width: nodeWidth, height: resolveNodeHeight(node) })
  }

  for (const edge of edges) {
    if (g.hasNode(edge.source) && g.hasNode(edge.target)) {
      g.setEdge(edge.source, edge.target)
    }
  }

  dagre.layout(g)

  return nodes.map((node) => {
    const pos = g.node(node.id)
    if (!pos) return node
    const h = resolveNodeHeight(node)
    return {
      ...node,
      position: {
        x: pos.x - nodeWidth / 2,
        y: pos.y - h / 2,
      },
    }
  })
}
