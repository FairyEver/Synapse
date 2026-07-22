export const OPEN_AGENT_SESSION_EVENT = "synapse:app:open_agent_session:operation"

export type SynapseAgentConversationPlatform = "automation" | "workflow" | "scheduled"

export type SynapseAgentConversationSourceFilter =
  | "user"
  | "scheduled"
  | "automation"
  | "workflow"
  | "webhook"
  | "relay"
  | "bridge"
  | "all"

export interface SynapseAgentConversationReference {
  readonly projectId: string
  readonly conversationId: string
  readonly sessionKey?: string
  readonly platform: SynapseAgentConversationPlatform
}

export interface SynapseAgentConversationTarget extends SynapseAgentConversationReference {
  readonly sessionKey: string
}

export type SynapseOpenAgentConversationResult =
  | { readonly opened: true }
  | { readonly opened: false; readonly reason: "not-found" }

export interface OpenAgentSessionPayload {
  readonly projectId: string
  readonly conversationId: string
  readonly sessionKey?: string
  readonly sourceFilter?: SynapseAgentConversationSourceFilter
  readonly prompt?: string
}
