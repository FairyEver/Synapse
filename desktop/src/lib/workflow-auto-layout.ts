import dagre from "@dagrejs/dagre"
import type { WorkflowEdge, WorkflowNode } from "../types/workflow"
import { SWITCH_BRANCH_H, SWITCH_HEADER_H } from "../../workflow-nodes/switch/constants"

export interface WorkflowAutoLayoutOptions {
  direction?: "LR" | "TB"
  nodeWidth?: number
}

const DEFAULT_NODE_WIDTH = 220
const DEFAULT_NODE_HEIGHT = 80

function resolveNodeHeight(node: Pick<WorkflowNode, "type" | "config">): number {
  if (node.type !== "switch") return DEFAULT_NODE_HEIGHT

  const branches = node.config.branches
  const count = Array.isArray(branches) ? branches.length : 0
  return SWITCH_HEADER_H + count * SWITCH_BRANCH_H
}

export function layoutWorkflowNodes(
  nodes: WorkflowNode[],
  edges: WorkflowEdge[],
  options?: WorkflowAutoLayoutOptions,
): WorkflowNode[] {
  if (nodes.length === 0) return nodes

  const direction = options?.direction ?? "LR"
  const nodeWidth = options?.nodeWidth ?? DEFAULT_NODE_WIDTH

  const graph = new dagre.graphlib.Graph()
  graph.setDefaultEdgeLabel(() => ({}))
  graph.setGraph({ rankdir: direction, nodesep: 40, ranksep: 80 })

  for (const node of nodes) {
    graph.setNode(node.id, { width: nodeWidth, height: resolveNodeHeight(node) })
  }

  for (const edge of edges) {
    if (graph.hasNode(edge.from) && graph.hasNode(edge.to)) {
      graph.setEdge(edge.from, edge.to)
    }
  }

  dagre.layout(graph)

  return nodes.map((node) => {
    const position = graph.node(node.id)
    if (!position) return node

    const nodeHeight = resolveNodeHeight(node)
    return {
      ...node,
      position: {
        x: position.x - nodeWidth / 2,
        y: position.y - nodeHeight / 2,
      },
    }
  })
}
