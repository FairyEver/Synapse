import type { NodeRunResult, WorkflowDefinition } from "@/types/workflow"

const VIEWPORT_FOCUS_DURATION_MS = 300
const MULTI_NODE_PADDING = 0.2
const FIT_ALL_MAX_ZOOM = 1
export const WORKFLOW_RUNNER_MIN_ZOOM = 0.05

export const FIT_WORKFLOW_NODES_OPTIONS = {
  duration: VIEWPORT_FOCUS_DURATION_MS,
  maxZoom: FIT_ALL_MAX_ZOOM,
  minZoom: WORKFLOW_RUNNER_MIN_ZOOM,
  padding: MULTI_NODE_PADDING,
} as const

interface RunnerViewportController {
  getViewport: () => { zoom: number }
  fitView: (options: {
    duration: number
    maxZoom: number
    minZoom?: number
    nodes: Array<{ id: string }>
    padding: number
  }) => Promise<boolean>
}

export function getRunningNodeIds(
  definition: WorkflowDefinition,
  nodeResults: Record<string, NodeRunResult>,
): string[] {
  return definition.nodes
    .filter((node) => nodeResults[node.id]?.status === "running")
    .map((node) => node.id)
}

export async function focusRunningNodes(
  nodeIds: readonly string[],
  controller: RunnerViewportController,
): Promise<boolean> {
  if (nodeIds.length === 0) return false

  const currentZoom = controller.getViewport().zoom
  if (nodeIds.length === 1) {
    return controller.fitView({
      duration: VIEWPORT_FOCUS_DURATION_MS,
      maxZoom: currentZoom,
      minZoom: currentZoom,
      nodes: [{ id: nodeIds[0] }],
      padding: MULTI_NODE_PADDING,
    })
  }

  return controller.fitView({
    duration: VIEWPORT_FOCUS_DURATION_MS,
    maxZoom: currentZoom,
    minZoom: WORKFLOW_RUNNER_MIN_ZOOM,
    nodes: nodeIds.map((id) => ({ id })),
    padding: MULTI_NODE_PADDING,
  })
}

export async function fitWorkflowNodes(
  nodeIds: readonly string[],
  controller: RunnerViewportController,
): Promise<boolean> {
  if (nodeIds.length === 0) return false

  return controller.fitView({
    ...FIT_WORKFLOW_NODES_OPTIONS,
    nodes: nodeIds.map((id) => ({ id })),
  })
}
