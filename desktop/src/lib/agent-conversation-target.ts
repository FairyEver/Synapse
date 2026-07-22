import { getSynapseBridge } from "@/lib/electron-bridge"
import type {
  SynapseAgentConversationReference,
  SynapseAgentConversationPlatform,
  SynapseOpenAgentConversationResult,
} from "@/types/agent-navigation"

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null
}

function isAgentConversationPlatform(value: unknown): value is SynapseAgentConversationPlatform {
  return value === "automation" || value === "workflow" || value === "scheduled"
}

function targetFromRecord(raw: Record<string, unknown>): SynapseAgentConversationReference | null {
  const { projectId, conversationId, sessionKey, platform } = raw
  if (
    typeof projectId !== "string"
    || projectId.length === 0
    || typeof conversationId !== "string"
    || conversationId.length === 0
    || !isAgentConversationPlatform(platform)
  ) {
    return null
  }
  return {
    projectId,
    conversationId,
    platform,
    ...(typeof sessionKey === "string" && sessionKey.length > 0 ? { sessionKey } : {}),
  }
}

export function agentConversationTargetFromOutputs(
  outputs: Record<string, unknown> | undefined,
): SynapseAgentConversationReference | null {
  if (!outputs) return null
  const nested = outputs.agentConversation
  if (isRecord(nested)) {
    return targetFromRecord(nested)
  }
  return targetFromRecord(outputs)
}

export async function openAgentConversationTarget(
  target: SynapseAgentConversationReference,
): Promise<SynapseOpenAgentConversationResult> {
  const bridge = getSynapseBridge()?.agent.openConversation
  if (!bridge) throw new Error("Agent conversation bridge is unavailable")
  return bridge(target)
}
