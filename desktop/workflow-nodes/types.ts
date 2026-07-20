import type { LucideIcon } from "lucide-react"
import type { ZodType } from "zod"
import type { ActorIdentity, AuditSink, PermissionGuard } from "../electron/runtime/security"
import type { SynapseAgentConversationTarget } from "../src/types/agent-navigation"
import type { WorkflowDefinition, WorkflowParam, WorkflowRunResult, WorkflowNodeUsageCostSnapshot } from "../src/types/workflow"

export interface PortDefinition { id: string; label: string }
export interface ConfigFieldDescriptor {
  name: string
  kind: "text" | "select" | "variable-binding-list" | "branch-list" | "record" | "number" | "boolean"
  label: string
  optional?: boolean
}

export type NodeShareConfigPath = readonly (string | number | "*")[]

export interface NodeShareCapabilityRequirement {
  readonly id: string
  readonly minVersion: string
  readonly installSourceId?: string
}

export interface NodeShareModelDeclaration {
  readonly providerPath?: NodeShareConfigPath
  readonly tierPath?: NodeShareConfigPath
  readonly modelPath?: NodeShareConfigPath
  readonly inheritProvider?: boolean
  readonly inheritTier?: boolean
  readonly environment?: "synapse" | "codex" | "claude-code"
}

export interface NodeShareProjectDeclaration {
  readonly path: NodeShareConfigPath
  readonly inheritFromWorkflow?: boolean
}

export interface NodeShareWorkflowDeclaration {
  readonly path: NodeShareConfigPath
}

export interface NodeShareResourceDeclaration {
  readonly path: NodeShareConfigPath
  readonly entryType: "file" | "directory"
  readonly cardinality: "one" | "many"
  readonly access: "read" | "write" | "read-write"
  readonly optional?: boolean
}

export interface NodeShareEnvironmentDeclaration {
  readonly path: NodeShareConfigPath
  readonly kind: string
  readonly optional?: boolean
}

export interface NodeShareSensitiveDeclaration {
  readonly path: NodeShareConfigPath
}

export interface NodeShareRiskDeclaration {
  readonly path: NodeShareConfigPath
  readonly id: string
  readonly when: "present" | "truthy"
  readonly equals?: unknown
}

export interface NodeShareRuntimeDeclaration {
  readonly path?: NodeShareConfigPath
  readonly capabilityByValue?: Readonly<Record<string, NodeShareCapabilityRequirement>>
  readonly capability?: NodeShareCapabilityRequirement
}

export interface NodeShareContract {
  readonly selfContained: boolean
  readonly capability: NodeShareCapabilityRequirement
  readonly models?: readonly NodeShareModelDeclaration[]
  readonly projects?: readonly NodeShareProjectDeclaration[]
  readonly workflows?: readonly NodeShareWorkflowDeclaration[]
  readonly resources?: readonly NodeShareResourceDeclaration[]
  readonly environments?: readonly NodeShareEnvironmentDeclaration[]
  readonly sensitive?: readonly NodeShareSensitiveDeclaration[]
  readonly risks?: readonly NodeShareRiskDeclaration[]
  readonly runtimes?: readonly NodeShareRuntimeDeclaration[]
  readonly portabilityWarnings?: readonly string[]
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
  share: NodeShareContract
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
  nodeOutputs?: Readonly<Record<string, string>>
  paramValues?: Record<string, unknown>
  paramDefinitions?: readonly WorkflowParam[]
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
