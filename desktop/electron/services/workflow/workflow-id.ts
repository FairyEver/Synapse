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
