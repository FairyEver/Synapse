import type { SynapseAgentConversationTarget } from "./agent-navigation"

export type WorkflowParamType = "text" | "number" | "file" | "directory"
export type WorkflowResourceEntryType = "file" | "directory"
export type WorkflowLocalPathResourceRef = { readonly kind: "local_path"; readonly entryType: WorkflowResourceEntryType; readonly path: string }
export type WorkflowDriveResourceRef = { readonly kind: "drive"; readonly entryType: WorkflowResourceEntryType; readonly id: string; readonly versionId?: string }
export type WorkflowStagedResourceRef = { readonly kind: "staged"; readonly entryType: WorkflowResourceEntryType; readonly id: string }
export type WorkflowInlineFileResourceRef = { readonly kind: "inline_file"; readonly entryType: "file"; readonly name: string; readonly mimeType?: string; readonly base64: string }
export type WorkflowResourceRef =
  | WorkflowLocalPathResourceRef
  | WorkflowDriveResourceRef
  | WorkflowStagedResourceRef
  | WorkflowInlineFileResourceRef
export type WorkflowParamDefault = string | number | WorkflowResourceRef | null
export interface WorkflowParam {
  name: string; type: WorkflowParamType; default: WorkflowParamDefault; description?: string
}
export interface WorkflowNode {
  id: string; name: string; type: string; position: { x: number; y: number }; config: Record<string, unknown>
}
export interface WorkflowEdge { id: string; from: string; to: string; branch?: string }
export type WorkflowVariableSource =
  | { readonly type: "param"; readonly param: string }
  | { readonly type: "node_output"; readonly node: string }
  | { readonly type: "static"; readonly value: string }
export type WorkflowParamBinding =
  | { readonly mode: "template"; readonly template: string }
  | { readonly mode: "value"; readonly source: WorkflowVariableSource }
export interface WorkflowVariableBinding {
  readonly name: string
  readonly source: WorkflowVariableSource
}
export interface WorkflowDefinition {
  id: string; name: string; description?: string; version: string
  createdAt: number; updatedAt: number
  loadError?: string
  defaultProjectId?: string
  defaultProviderId?: string
  defaultModelTier?: "default" | "haiku" | "sonnet" | "opus"
  defaultNodeTimeoutMins?: number
  params: WorkflowParam[]; nodes: WorkflowNode[]; edges: WorkflowEdge[]
}
export interface WorkflowMeta {
  id: string; name: string; description?: string; version: string
  loadError?: string
  nodeCount: number; createdAt: number; updatedAt: number
}
export interface WorkflowUsageCostBreakdownCny {
  readonly input: number
  readonly output: number
  readonly cacheRead: number
  readonly cacheWrite: number
  readonly reasoning: number
}
export interface WorkflowNodeUsageCostSnapshot {
  readonly modelName?: string
  readonly costCny?: number
  readonly costBreakdownCny?: WorkflowUsageCostBreakdownCny
  readonly costCurrency?: "CNY"
  readonly priceKnown?: boolean
  readonly estimatedCost?: boolean
}
export interface NodeRunResult {
  nodeId: string
  status: "pending" | "running" | "success" | "failed" | "cancelled" | "skipped"
  input: { variables: Record<string, string>; prompt?: string }
  output?: string
  outputs?: Record<string, unknown> & {
    readonly agentConversation?: SynapseAgentConversationTarget
  }
  activeBranch?: string; error?: string
  startedAt?: number; endedAt?: number; durationMs?: number
  progressLabel?: string
  usage?: Record<string, unknown>
  costUsd?: number
  costCny?: number
  costCurrency?: "CNY"
  usageCost?: WorkflowNodeUsageCostSnapshot
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
export interface WorkflowRunListItem {
  runId: string
  workflowId: string
  status: WorkflowRunStatus["status"]
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
  | { type: "node:agent-conversation"; runId: string; nodeId: string; target: SynapseAgentConversationTarget }
  | { type: "node:completed"; runId: string; nodeId: string; output: unknown; result?: NodeRunResult }
  | { type: "node:failed"; runId: string; nodeId: string; error: string; result?: NodeRunResult }
  | { type: "node:skipped"; runId: string; nodeId: string; result?: NodeRunResult }
  | { type: "edge:activated"; runId: string; from: string; to: string }
  | { type: "workflow:completed"; runId: string; workflowId: string; result: WorkflowRunResult }
  | { type: "workflow:failed"; runId: string; workflowId: string; error: string; result?: WorkflowRunResult }
  | { type: "workflow:cancelled"; runId: string; workflowId: string; result?: WorkflowRunResult }
  | { type: "workflow:snapshot-save-failed"; runId: string; workflowId: string; status: WorkflowRunResult["status"] }
export interface ValidationError {
  type: "cycle" | "unreachable_reference" | "invalid_config" | "invalid_switch_edge" | "orphan_edge_branch" | "missing_end_node" | "multiple_end_nodes" | "missing_param" | "disconnected_node"
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
