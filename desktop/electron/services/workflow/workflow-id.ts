const SAFE_WORKFLOW_ID_PATTERN = /^[A-Za-z0-9_-]+$/

export function isSafeWorkflowId(workflowId: string): boolean {
  return SAFE_WORKFLOW_ID_PATTERN.test(workflowId)
}

export function assertSafeWorkflowId(workflowId: string): string {
  if (!isSafeWorkflowId(workflowId)) {
    throw new Error("Invalid workflow id")
  }
  return workflowId
}

export function isSafeWorkflowNodeId(nodeId: string): boolean {
  return SAFE_WORKFLOW_ID_PATTERN.test(nodeId)
}

export function assertSafeWorkflowNodeId(nodeId: string): string {
  if (!isSafeWorkflowNodeId(nodeId)) {
    throw new Error("Invalid workflow node id")
  }
  return nodeId
}

export function isSafeWorkflowRunId(runId: string): boolean {
  return SAFE_WORKFLOW_ID_PATTERN.test(runId)
}

export function assertSafeWorkflowRunId(runId: string): string {
  if (!isSafeWorkflowRunId(runId)) {
    throw new Error("Invalid workflow run id")
  }
  return runId
}
