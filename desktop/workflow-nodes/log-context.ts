import type { WorkflowRuntimeContext } from "./types"

function workflowNodeLogContext(context: WorkflowRuntimeContext): {
  projectId?: string
  workflowId?: string
  runId: string
  nodeId?: string
} {
  return {
    projectId: context.projectId,
    workflowId: context.workflowId,
    runId: context.runId,
    nodeId: context.nodeId,
  }
}

export { workflowNodeLogContext }
