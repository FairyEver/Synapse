export interface WorkflowParam {
  name: string; type: "text" | "number"; default: string | number | null; description?: string
}
export interface WorkflowNode {
  id: string; name: string; type: string; position: { x: number; y: number }; config: Record<string, unknown>
}
export interface WorkflowEdge { id: string; from: string; to: string; branch?: string }
export interface WorkflowDefinition {
  id: string; name: string; description?: string; version: string
  createdAt: number; updatedAt: number
  params: WorkflowParam[]; nodes: WorkflowNode[]; edges: WorkflowEdge[]
}
export interface WorkflowMeta {
  id: string; name: string; description?: string; version: string
  nodeCount: number; createdAt: number; updatedAt: number
}
export interface NodeRunResult {
  nodeId: string
  status: "pending" | "running" | "success" | "failed" | "skipped"
  input: { variables: Record<string, string>; prompt?: string }
  output?: string; outputs?: Record<string, unknown>; activeBranch?: string; error?: string
  startedAt?: number; endedAt?: number; durationMs?: number
}
export interface WorkflowRunResult {
  status: "completed" | "failed" | "cancelled"
  nodeResults: Record<string, NodeRunResult>
  durationMs: number
}
export type WorkflowEvent =
  | { type: "workflow:started"; runId: string }
  | { type: "node:started"; nodeId: string }
  | { type: "node:completed"; nodeId: string; output: unknown }
  | { type: "node:failed"; nodeId: string; error: string }
  | { type: "node:skipped"; nodeId: string }
  | { type: "edge:activated"; from: string; to: string }
  | { type: "workflow:completed"; result: WorkflowRunResult }
  | { type: "workflow:failed"; error: string }
  | { type: "workflow:cancelled" }
export interface ValidationError {
  type: "cycle" | "unreachable_reference" | "invalid_config" | "invalid_switch_edge" | "orphan_edge_branch"
  nodeId?: string; edgeId?: string; message: string
}
export interface ValidationWarning { type: "disconnected_node" | "multiple_start_nodes"; nodeId?: string; message: string }
export interface ValidationResult { valid: boolean; errors: ValidationError[]; warnings: ValidationWarning[] }
export interface WorkflowRunSnapshot {
  runId: string; workflowId: string; version: string; startedAt: number; endedAt?: number
  status: "completed" | "failed" | "cancelled"; params: Record<string, unknown>
  nodeResults: Record<string, NodeRunResult>
}
