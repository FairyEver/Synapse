import type { LucideIcon } from "lucide-react"
import type { ZodType } from "zod"
import type { ActorIdentity } from "../electron/runtime/security"
import type { SynapseAgentConversationTarget } from "../src/types/agent-navigation"

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
  fileConversionService?: {
    convert: (
      input: import("../electron/services/file-conversion").FileConversionInput,
      context?: import("../electron/services/workflow/file-conversion-input-service").WorkflowFileConversionContext,
    ) => Promise<import("../electron/services/file-conversion").FileConversionResult>
  }
  writeWorkflowFileConversionOutput?: (request: {
    readonly outputPath: string
    readonly markdown: string
    readonly actor?: ActorIdentity
    readonly runId: string
    readonly abortSignal: AbortSignal
  }) => Promise<void>
}

export interface NodeExecutionInput<TConfig> {
  config: TConfig
  resolvedVariables: Record<string, string>
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
  costUsd?: number
  costCny?: number
  costCurrency?: "CNY"
  agentConversation?: SynapseAgentConversationTarget
}

export interface NodeExecutor<TConfig = unknown> {
  execute(input: NodeExecutionInput<TConfig>): Promise<NodeExecutionResult>
}
