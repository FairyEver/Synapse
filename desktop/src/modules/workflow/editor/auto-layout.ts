import type { Node, Edge } from "@xyflow/react"
import { layoutWorkflowNodes, type WorkflowAutoLayoutOptions } from "@/lib/workflow-auto-layout"
import type { WorkflowEdge, WorkflowNode } from "@/types/workflow"

export type AutoLayoutOptions = WorkflowAutoLayoutOptions

export function autoLayoutNodes(
  nodes: Node[],
  edges: Edge[],
  options?: AutoLayoutOptions,
): Node[] {
  if (nodes.length === 0) return nodes

  const workflowNodes: WorkflowNode[] = nodes.map((node) => ({
    id: node.id,
    name: node.id,
    type: node.type ?? "prompt",
    position: node.position,
    config: { ...(node.data as Record<string, unknown> | undefined) },
  }))
  const workflowEdges: WorkflowEdge[] = edges.map((edge) => ({
    id: edge.id,
    from: edge.source,
    to: edge.target,
    branch: edge.sourceHandle ?? undefined,
  }))
  const positions = new Map(layoutWorkflowNodes(workflowNodes, workflowEdges, options).map((node) => [node.id, node.position]))

  return nodes.map((node) => {
    const position = positions.get(node.id)
    if (!position) return node
    return {
      ...node,
      position,
    }
  })
}
