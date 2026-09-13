import type { SynapseAgentConversationSourceFilter } from "../../../src/types/agent-navigation"

export function agentConversationSourceForPlatform(
  platform: string | undefined,
): Exclude<SynapseAgentConversationSourceFilter, "all"> {
  const normalized = platform?.trim()
  if (!normalized || normalized === "local" || normalized === "local-renderer") return "user"
  if (normalized === "automation") return "automation"
  if (normalized === "scheduled") return "scheduled"
  if (normalized === "workflow") return "workflow"
  if (normalized === "webhook") return "webhook"
  if (normalized === "relay") return "relay"
  return "bridge"
}

