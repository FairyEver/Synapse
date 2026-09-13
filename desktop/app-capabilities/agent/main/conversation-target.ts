import type { ConversationEntryV1, DataRepository } from "../../../electron/runtime/data-repo"
import {
  resolveAgentConversationTargetInput,
  type AgentConversationTargetInput,
} from "../shared/schema"
import {
  isValidAgentConversationReference,
  looksLikeAgentConversationReference,
  resolveGlobalAgentConversationReference,
  resolveAgentConversationReference,
} from "./conversation-reference"

export type AgentConversationTargetErrorCode = "invalid_link" | "invalid_locator" | "not_found"

export class AgentConversationTargetError extends Error {
  constructor(readonly code: AgentConversationTargetErrorCode) {
    super(code)
    this.name = "AgentConversationTargetError"
  }
}

export async function resolvePersistedAgentConversation(
  dataRepository: DataRepository,
  input: AgentConversationTargetInput,
): Promise<ConversationEntryV1> {
  if (input.conversationRef !== undefined && !isValidAgentConversationReference(input.conversationRef)) {
    throw new AgentConversationTargetError("invalid_locator")
  }
  let target: ReturnType<typeof resolveAgentConversationTargetInput>
  try {
    target = resolveAgentConversationTargetInput(input)
  } catch {
    throw new AgentConversationTargetError("invalid_link")
  }

  const conversations = dataRepository.namespace<ConversationEntryV1>("conversations")
  if ("conversationRef" in target) {
    if (!isValidAgentConversationReference(target.conversationRef)) {
      throw new AgentConversationTargetError("invalid_locator")
    }
    const resolved = await resolveGlobalAgentConversationReference(conversations, target.conversationRef)
    if (resolved) return resolved
    throw new AgentConversationTargetError("not_found")
  }
  const direct = await conversations.get(target.conversationId)
  if (direct && direct.projectId === target.projectId && direct.id === target.conversationId) return direct
  if (looksLikeAgentConversationReference(target.conversationId)) {
    if (!isValidAgentConversationReference(target.conversationId)) {
      throw new AgentConversationTargetError("invalid_locator")
    }
    const resolved = await resolveAgentConversationReference(
      conversations,
      target.projectId,
      target.conversationId,
    )
    if (resolved) return resolved
    throw new AgentConversationTargetError("not_found")
  }

  throw new AgentConversationTargetError("not_found")
}
