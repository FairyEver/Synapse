import dagre from "@dagrejs/dagre"
import type { WorkflowEdge, WorkflowLayoutDirection, WorkflowNode } from "../types/workflow"
import { SWITCH_BRANCH_H, SWITCH_HEADER_H } from "../../workflow-nodes/switch/constants"
import {
  resolveSwitchNodeWidth,
  toDagreRankDirection,
  WORKFLOW_NODE_WIDTH,
} from "./workflow-layout-direction"

export interface WorkflowAutoLayoutOptions {
  layoutDirection?: WorkflowLayoutDirection
  nodeWidth?: number
}

const DEFAULT_NODE_HEIGHT = 80

function resolveNodeHeight(node: Pick<WorkflowNode, "type" | "config">): number {
  if (node.type !== "switch") return DEFAULT_NODE_HEIGHT

  const branches = node.config.branches
  const count = Array.isArray(branches) ? branches.length : 0
  return SWITCH_HEADER_H + count * SWITCH_BRANCH_H
}

function resolveNodeLayoutWidth(
  node: Pick<WorkflowNode, "type" | "config">,
  layoutDirection: WorkflowLayoutDirection,
  nodeWidth: number,
): number {
  if (node.type !== "switch") return nodeWidth
  const branches = node.config.branches
  const branchCount = Array.isArray(branches) ? branches.length : 0
  return resolveSwitchNodeWidth(layoutDirection, branchCount, nodeWidth)
}

export function layoutWorkflowNodes(
  nodes: WorkflowNode[],
  edges: WorkflowEdge[],
  options?: WorkflowAutoLayoutOptions,
): WorkflowNode[] {
  if (nodes.length === 0) return nodes

  const layoutDirection = options?.layoutDirection ?? "horizontal"
  const nodeWidth = options?.nodeWidth ?? WORKFLOW_NODE_WIDTH

  const graph = new dagre.graphlib.Graph()
  graph.setDefaultEdgeLabel(() => ({}))
  graph.setGraph({ rankdir: toDagreRankDirection(layoutDirection), nodesep: 32, ranksep: 64 })

  for (const node of nodes) {
    graph.setNode(node.id, {
      width: resolveNodeLayoutWidth(node, layoutDirection, nodeWidth),
      height: resolveNodeHeight(node),
    })
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
    const layoutWidth = resolveNodeLayoutWidth(node, layoutDirection, nodeWidth)
    return {
      ...node,
      position: {
        x: position.x - layoutWidth / 2,
        y: position.y - nodeHeight / 2,
      },
    }
  })
}
