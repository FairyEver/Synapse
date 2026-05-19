import type { LucideIcon } from "lucide-react"
import type { ZodType } from "zod"
import type { ActorIdentity } from "../electron/runtime/security"

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
  runId: string
  abortSignal: AbortSignal
  actor?: ActorIdentity
}

export interface AgentSendDeps {
  sendToAgent: (input: { providerId: string; modelTier: string; prompt: string; projectId: string; abortSignal: AbortSignal }) => Promise<{
    status: "success" | "failed"
    response: string
    error?: string
    durationMs: number
  }>
}

export interface NodeRuntimeDeps {
  processRunner: {
    run: (request: import("../electron/runtime/process").ControlledProcessRunRequest) => Promise<import("../electron/runtime/process").ControlledProcessResult>
  }
  sendHttpRequest: (request: import("../electron/runtime/network").OutboundHttpRequest) => Promise<import("../electron/runtime/network").OutboundHttpResponse>
}

export interface NodeExecutionInput<TConfig> {
  config: TConfig
  resolvedVariables: Record<string, string>
  context: WorkflowRuntimeContext
  agentDeps: AgentSendDeps
  runtimeDeps?: NodeRuntimeDeps
  onProgress?: (phase: string, label: string) => void
}

export interface NodeExecutionResult {
  status: "success" | "failed" | "cancelled"
  output: string
  outputs?: Record<string, unknown>
  activeBranch?: string
  error?: string
  durationMs: number
}

export interface NodeExecutor<TConfig = unknown> {
  execute(input: NodeExecutionInput<TConfig>): Promise<NodeExecutionResult>
}
