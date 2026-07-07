import type { LucideIcon } from "lucide-react"
import type { ZodType } from "zod"
import type { ActorIdentity, AuditSink, PermissionGuard } from "../electron/runtime/security"
import type { SynapseAgentConversationTarget } from "../src/types/agent-navigation"
import type { WorkflowDefinition, WorkflowRunResult, WorkflowNodeUsageCostSnapshot } from "../src/types/workflow"

export interface PortDefinition { id: string; label: string }
export interface ConfigFieldDescriptor {
  name: string
  kind: "text" | "select" | "variable-binding-list" | "branch-list" | "record" | "number"
  label: string
  optional?: boolean
}

export interface NodeManifest<TConfig = unknown> {
  type: string
  title: string
  icon: LucideIcon
  color: string
  defaultConfig: TConfig
  ports: { inputs: PortDefinition[]; outputs: PortDefinition[] | "dynamic" }
  resolveDynamicPorts?: (config: TConfig) => PortDefinition[]
  cardSummary: (config: TConfig) => { title: string; subtitle: string }
  configFields: readonly ConfigFieldDescriptor[]
  configSchema: ZodType<TConfig>
}

export interface WorkflowRuntimeContext {
  projectId?: string
  workflowId?: string
  workflowName?: string
  runId: string
  nodeId?: string
  nodeName?: string
  abortSignal: AbortSignal
  actor?: ActorIdentity
  automationId?: string
  automationRunId?: string
  workflowCallStack?: readonly WorkflowCallStackEntry[]
}

export interface AgentSendDeps {
  sendToAgent: (input: {
    providerId: string
    modelTier: string
    prompt: string
    projectId: string
    abortSignal: AbortSignal
    timeoutMins?: number
    workflowId?: string
    workflowName?: string
    workflowRunId?: string
    workflowNodeId?: string
    workflowNodeName?: string
    onConversationCreated?: (target: SynapseAgentConversationTarget) => void
  }) => Promise<{
    status: "success" | "failed"
    response: string
    error?: string
    durationMs: number
    usage?: Record<string, unknown>
    modelName?: string
    costUsd?: number
    costCny?: number
    costBreakdownCny?: {
      readonly input: number
      readonly output: number
      readonly cacheRead: number
      readonly cacheWrite: number
      readonly reasoning: number
    }
    costCurrency?: "CNY"
    agentConversation?: SynapseAgentConversationTarget
  }>
}

export interface NodeRuntimeDeps {
  processRunner: {
    run: (request: import("../electron/runtime/process").ControlledProcessRunRequest) => Promise<import("../electron/runtime/process").ControlledProcessResult>
  }
  sendHttpRequest: (request: import("../electron/runtime/network").OutboundHttpRequest) => Promise<import("../electron/runtime/network").OutboundHttpResponse>
  permissionGuard?: PermissionGuard
  auditSink?: AuditSink
  resolveProjectWorkspacePath?: (projectId: string) => Promise<string | null>
  resolveService?: <T>(serviceId: string) => T
  workflowCall?: WorkflowCallRuntimeDeps
}

export interface WorkflowCallStackEntry {
  workflowId: string
  workflowName?: string
}

export interface WorkflowCallRunInput {
  definition: WorkflowDefinition
  params: Record<string, unknown>
  projectId?: string
  triggerSource: string
  abortSignal: AbortSignal
  actor?: ActorIdentity
  automationId?: string
  automationRunId?: string
  parentWorkflowId?: string
  parentRunId: string
  parentNodeId?: string
  parentNodeName?: string
  callStack: readonly WorkflowCallStackEntry[]
}

export interface WorkflowCallRunOutput {
  runId: string
  result: WorkflowRunResult
}

export interface WorkflowCallRuntimeDeps {
  getWorkflowDefinition: (id: string) => Promise<WorkflowDefinition | null>
  runWorkflow: (input: WorkflowCallRunInput) => Promise<WorkflowCallRunOutput>
}

export interface NodeExecutionInput<TConfig> {
  config: TConfig
  resolvedVariables: Record<string, string>
  paramValues?: Record<string, unknown>
  context: WorkflowRuntimeContext
  agentDeps: AgentSendDeps
  runtimeDeps?: NodeRuntimeDeps
  onProgress?: (phase: string, label: string) => void
  onAgentConversation?: (target: SynapseAgentConversationTarget) => void
}

export interface NodeExecutionResult {
  status: "success" | "failed" | "cancelled"
  output: string
  outputs?: Record<string, unknown>
  activeBranch?: string
  error?: string
  durationMs: number
  usage?: Record<string, unknown>
  modelName?: string
  costUsd?: number
  costCny?: number
  costBreakdownCny?: WorkflowNodeUsageCostSnapshot["costBreakdownCny"]
  costCurrency?: "CNY"
  usageCost?: WorkflowNodeUsageCostSnapshot
  agentConversation?: SynapseAgentConversationTarget
}

export interface NodeExecutor<TConfig = unknown> {
  execute(input: NodeExecutionInput<TConfig>): Promise<NodeExecutionResult>
}
