import { getSynapseBridge } from "@/lib/electron-bridge"
import type {
  SynapseAgentConversationTarget,
  SynapseOpenAgentConversationResult,
} from "@/types/agent-navigation"

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null
}

function isAgentConversationPlatform(value: unknown): value is SynapseAgentConversationTarget["platform"] {
  return value === "automation" || value === "workflow" || value === "scheduled"
}

function targetFromRecord(raw: Record<string, unknown>): SynapseAgentConversationTarget | null {
  const { projectId, conversationId, sessionKey, platform } = raw
  if (
    typeof projectId !== "string"
    || projectId.length === 0
    || typeof conversationId !== "string"
    || conversationId.length === 0
    || typeof sessionKey !== "string"
    || sessionKey.length === 0
    || !isAgentConversationPlatform(platform)
  ) {
    return null
  }
  return { projectId, conversationId, sessionKey, platform }
}

export function agentConversationTargetFromOutputs(
  outputs: Record<string, unknown> | undefined,
): SynapseAgentConversationTarget | null {
  if (!outputs) return null
  const nested = outputs.agentConversation
  if (isRecord(nested)) {
    return targetFromRecord(nested)
  }
  return targetFromRecord(outputs)
}

export async function openAgentConversationTarget(
  target: SynapseAgentConversationTarget,
): Promise<SynapseOpenAgentConversationResult> {
  const bridge = getSynapseBridge()?.agent.openConversation
  if (!bridge) throw new Error("Agent conversation bridge is unavailable")
  return bridge(target)
}
