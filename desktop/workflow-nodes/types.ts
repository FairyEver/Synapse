import type { LucideIcon } from "lucide-react"
import type { ZodType } from "zod"

export interface PortDefinition { id: string; label: string }
export interface ConfigFieldDescriptor {
  name: string
  kind: "text" | "select" | "variable-binding-list" | "branch-list"
  label: string
  optional?: boolean
}

export interface NodeManifest<TConfig = unknown> {
  type: string
  title: string
  icon: LucideIcon
  color: string
  ports: { inputs: PortDefinition[]; outputs: PortDefinition[] | "dynamic" }
  resolveDynamicPorts?: (config: TConfig) => PortDefinition[]
  cardSummary: (config: TConfig) => { title: string; subtitle: string }
  configFields: readonly ConfigFieldDescriptor[]
  configSchema: ZodType<TConfig>
}

export interface WorkflowRuntimeContext {
  projectId: string
  runId: string
  abortSignal: AbortSignal
}

export interface AgentSendDeps {
  sendToAgent: (input: { providerId: string; modelTier: string; prompt: string; abortSignal: AbortSignal }) => Promise<{
    status: "success" | "failed"
    response: string
    error?: string
    durationMs: number
  }>
}

export interface NodeExecutionInput<TConfig> {
  config: TConfig
  resolvedVariables: Record<string, string>
  context: WorkflowRuntimeContext
  agentDeps: AgentSendDeps
  onProgress?: (phase: string, label: string) => void
}

export interface NodeExecutionResult {
  status: "success" | "failed"
  output: string
  outputs?: Record<string, unknown>
  activeBranch?: string
  error?: string
  durationMs: number
}

export interface NodeExecutor<TConfig = unknown> {
  execute(input: NodeExecutionInput<TConfig>): Promise<NodeExecutionResult>
}
