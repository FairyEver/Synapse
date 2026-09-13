import type { CapabilityId } from "../../../synapse-capabilities/shared/naming"

export const AGENT_APP_ID = "agent" as const
type AgentConversationCapabilityMetadata = {
  readonly id: CapabilityId
  readonly toolName: string
  readonly title: string
  readonly description: string
  readonly mutates: boolean
  readonly risk?: "normal" | "high"
}

function capability(input: Omit<AgentConversationCapabilityMetadata, "id" | "toolName"> & {
  readonly id: `app.agent.${string}.${string}`
}): AgentConversationCapabilityMetadata {
  return Object.freeze({
    ...input,
    id: input.id as CapabilityId,
    toolName: input.id.replaceAll(".", "_"),
  })
}

export const AGENT_CONVERSATION_CAPABILITY_CATALOG = [
  capability({
    id: "app.agent.conversation.open",
    title: "Open Agent conversation",
    description: "Open an existing local Synapse Agent conversation in the main application window.",
    mutates: false,
  }),
  capability({
    id: "app.agent.conversation.inspect",
    title: "Inspect Agent conversation",
    description: "Read one bounded page of the visible timeline and the current runtime state for a local Synapse Agent conversation.",
    mutates: false,
    risk: "high",
  }),
  capability({
    id: "app.agent.conversation.observe",
    title: "Observe Agent conversation",
    description: "Wait for a bounded Agent conversation state or timeline change without returning timeline content.",
    mutates: false,
  }),
  capability({
    id: "app.agent.message.send",
    title: "Send Agent message",
    description: "Asynchronously submit one user message to an existing local user-owned Agent conversation.",
    mutates: true,
    risk: "high",
  }),
  capability({
    id: "app.agent.turn.steer",
    title: "Steer active Agent turn",
    description: "Inject one idempotent steering message into the exact active turn of a local user-owned Agent conversation.",
    mutates: true,
    risk: "high",
  }),
  capability({
    id: "app.agent.turn.stop",
    title: "Stop active Agent turn",
    description: "Request graceful cancellation of the exact active turn without automatic force escalation.",
    mutates: true,
    risk: "high",
  }),
  capability({
    id: "app.agent.turn.force_stop",
    title: "Force stop active Agent turn",
    description: "Explicitly force termination of the exact active turn.",
    mutates: true,
    risk: "high",
  }),
  capability({
    id: "app.agent.permission.respond",
    title: "Respond to Agent request",
    description: "Answer a pending Agent question or explicitly allow or deny one exact pending tool permission request.",
    mutates: true,
    risk: "high",
  }),
  capability({
    id: "app.agent.group.list",
    title: "List Agent conversation groups",
    description: "List conversation groups, including the built-in 本地对话 group and configured projects, with identifiers and names. Supports name search and pagination; returns no paths or conversation content.",
    mutates: false,
  }),
  capability({
    id: "app.agent.conversation.create",
    title: "Create Agent conversation",
    description: "Create a new local user-owned conversation using a requested provider/model tier or the current default model selection, with ordinary agent identity. Returns its projectId, conversationRef, and deepLink for sending messages or opening it.",
    mutates: true,
  }),
  capability({
    id: "app.agent.provider.list",
    title: "List Agent providers and models",
    description: "List non-archived local Agent model providers and their selectable model tiers and names, matching custom conversation creation. Supports provider ID filtering, provider/model name search and pagination. Returns no credentials or connection settings.",
    mutates: false,
  }),
] as const

export const AGENT_CONVERSATION_CAPABILITY_IDS = AGENT_CONVERSATION_CAPABILITY_CATALOG.map((item) => item.id)
export const AGENT_CONVERSATION_MCP_TOOL_ACTIONS = Object.fromEntries(
  AGENT_CONVERSATION_CAPABILITY_CATALOG.map((item) => [item.toolName, item.id]),
) as Readonly<Record<string, CapabilityId>>

export const AGENT_CONVERSATION_OPEN_CAPABILITY_ID = AGENT_CONVERSATION_CAPABILITY_CATALOG[0].id
export const AGENT_CONVERSATION_OPEN_MCP_TOOL_NAME = AGENT_CONVERSATION_CAPABILITY_CATALOG[0].toolName
export const AGENT_CONVERSATION_NAVIGATION_SERVICE_ID = "core.agent-conversation-navigation" as const
export const AGENT_CONVERSATION_CONTROL_SERVICE_ID = "core.agent-conversation-control" as const
