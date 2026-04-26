import type {
  ProviderCodexOptionsV1,
  ProviderModelEntryV1,
} from "../../runtime/data-repo"
import type { ActorIdentity } from "../../runtime/security"

export const PROVIDER_CONFIG_SERVICE_ID = "provider.config"

export type AgentRuntimeAgentType = "codex" | "claude-code" | string

export interface ProviderConfigInput {
  readonly id: string
  readonly kind?: string
  readonly display?: string
  readonly baseUrl?: string
  readonly secretRef?: string
  readonly model?: string
  readonly models?: readonly ProviderModelEntryV1[]
  readonly agentType?: string
  readonly agentTypes?: readonly string[]
  readonly env?: Record<string, string>
  readonly thinking?: string
  readonly effort?: string
  readonly endpoints?: Record<string, string>
  readonly agentModels?: Record<string, string>
  readonly agentModelLists?: Record<string, readonly ProviderModelEntryV1[]>
  readonly codex?: ProviderCodexOptionsV1
}

export interface ProviderConfigView {
  readonly id: string
  readonly kind: string
  readonly display?: string
  readonly baseUrl?: string
  readonly secretRef?: string
  readonly model?: string
  readonly models: readonly ProviderModelEntryV1[]
  readonly agentTypes?: readonly string[]
  readonly env: Record<string, string>
  readonly thinking?: string
  readonly effort?: string
  readonly codex?: ProviderCodexOptionsV1
  readonly scope: "global" | "project"
}

export interface ProjectProviderState {
  readonly projectId: string
  readonly agentType: AgentRuntimeAgentType
  readonly providers: readonly ProviderConfigView[]
  readonly activeProvider?: ProviderConfigView
  readonly activeProviderId?: string
  readonly activeModel?: string
  readonly activeMode?: string
}

export interface ProviderRuntimeView extends ProjectProviderState {
  readonly model?: string
  readonly mode?: string
  readonly provider?: ProviderConfigView
  readonly baseUrl?: string
  readonly apiKey?: string
  readonly env: Record<string, string | undefined>
  readonly envAllowlist: readonly string[]
}

export interface ProviderRuntimeRequest {
  readonly actor?: ActorIdentity
}

