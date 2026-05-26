export interface WorkflowParam {
  name: string; type: "text" | "number"; default: string | number | null; description?: string
}
export interface WorkflowNode {
  id: string; name: string; type: string; position: { x: number; y: number }; config: Record<string, unknown>
}
export interface WorkflowEdge { id: string; from: string; to: string; branch?: string }
export type WorkflowVariableSource =
  | { readonly type: "param"; readonly param: string }
  | { readonly type: "node_output"; readonly node: string }
  | { readonly type: "static"; readonly value: string }
export interface WorkflowVariableBinding {
  readonly name: string
  readonly source: WorkflowVariableSource
}
export interface WorkflowFileConversionNodeConfig {
  readonly inputPath: string
  readonly outputMode?: "result" | "markdown-file"
  readonly outputPath?: string
  readonly outputDirectory?: string
  readonly ocr?: {
    readonly enabled?: boolean
    readonly languages?: readonly string[]
    readonly maxPages?: number
  }
  readonly variables?: readonly WorkflowVariableBinding[]
}
export interface WorkflowFileConversionNodeResult {
  readonly sourcePath: string
  readonly format: string
  readonly kind: string
  readonly title: string
  readonly markdown: string
  readonly text: string
  readonly metadata: Record<string, unknown>
  readonly warnings: readonly { readonly code: string; readonly message: string }[]
  readonly outputPath?: string
}
export interface WorkflowFileConversionNodeFailure {
  readonly ok: false
  readonly code: "unsupported_format" | "encrypted" | "missing_local_helper" | "parse_failed" | "read_failed" | "size_limit_exceeded" | "invalid_output_path" | "write_failed"
  readonly message: string
  readonly sourcePath: string
}
export interface WorkflowDefinition {
  id: string; name: string; description?: string; version: string
  createdAt: number; updatedAt: number
  defaultProjectId?: string
  defaultProviderId?: string
  defaultModelTier?: "default" | "haiku" | "sonnet" | "opus"
  defaultNodeTimeoutMins?: number
  params: WorkflowParam[]; nodes: WorkflowNode[]; edges: WorkflowEdge[]
}
export interface WorkflowMeta {
  id: string; name: string; description?: string; version: string
  nodeCount: number; createdAt: number; updatedAt: number
}
export interface NodeRunResult {
  nodeId: string
  status: "pending" | "running" | "success" | "failed" | "cancelled" | "skipped"
  input: { variables: Record<string, string>; prompt?: string }
  output?: string; outputs?: Record<string, unknown>; activeBranch?: string; error?: string
  startedAt?: number; endedAt?: number; durationMs?: number
  progressLabel?: string
  usage?: Record<string, unknown>
  costUsd?: number
}
export interface WorkflowRunResult {
  status: "completed" | "failed" | "cancelled"
  nodeResults: Record<string, NodeRunResult>
  durationMs: number
  output?: string
}
export interface WorkflowRunStatus {
  runId: string
  workflowId: string
  status: "running" | WorkflowRunResult["status"]
  nodeResults: Record<string, NodeRunResult>
  startedAt: number
  endedAt?: number
  durationMs?: number
  error?: string
  params?: Record<string, unknown>
  definition?: WorkflowDefinition
}
export type WorkflowEvent =
  | { type: "workflow:started"; runId: string; workflowId: string }
  | { type: "node:started"; runId: string; nodeId: string; startedAt?: number; result?: NodeRunResult }
  | { type: "node:progress"; runId: string; nodeId: string; phase: string; label: string }
  | { type: "node:completed"; runId: string; nodeId: string; output: unknown; result?: NodeRunResult }
  | { type: "node:failed"; runId: string; nodeId: string; error: string; result?: NodeRunResult }
  | { type: "node:skipped"; runId: string; nodeId: string; result?: NodeRunResult }
  | { type: "edge:activated"; runId: string; from: string; to: string }
  | { type: "workflow:completed"; runId: string; workflowId: string; result: WorkflowRunResult }
  | { type: "workflow:failed"; runId: string; workflowId: string; error: string; result?: WorkflowRunResult }
  | { type: "workflow:cancelled"; runId: string; workflowId: string; result?: WorkflowRunResult }
  | { type: "workflow:snapshot-save-failed"; runId: string; workflowId: string; status: WorkflowRunResult["status"] }
export interface ValidationError {
  type: "cycle" | "unreachable_reference" | "invalid_config" | "invalid_switch_edge" | "orphan_edge_branch" | "missing_end_node" | "multiple_end_nodes" | "missing_param"
  nodeId?: string; nodeName?: string; edgeId?: string; field?: string; message: string
  retryable?: boolean
  details?: Record<string, unknown>
}
export interface ValidationWarning { type: "disconnected_node" | "multiple_start_nodes" | "duplicate_switch_branch_targets"; nodeId?: string; message: string }
export interface ValidationResult { valid: boolean; errors: ValidationError[]; warnings: ValidationWarning[] }
export interface WorkflowRunSnapshot {
  runId: string; workflowId: string; version: string; startedAt: number; endedAt?: number
  status: "completed" | "failed" | "cancelled"; params: Record<string, unknown>
  nodeResults: Record<string, NodeRunResult>
  error?: string
  definition?: WorkflowDefinition
}
