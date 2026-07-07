export const OPEN_AGENT_SESSION_EVENT = "synapse:open-agent-session"

export type SynapseAgentConversationPlatform = "automation" | "workflow" | "scheduled" | "swarm"

export type SynapseAgentConversationSourceFilter =
  | "user"
  | "scheduled"
  | "automation"
  | "workflow"
  | "swarm"
  | "webhook"
  | "relay"
  | "bridge"
  | "all"

export interface SynapseAgentConversationTarget {
  readonly projectId: string
  readonly conversationId: string
  readonly sessionKey: string
  readonly platform: SynapseAgentConversationPlatform
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
