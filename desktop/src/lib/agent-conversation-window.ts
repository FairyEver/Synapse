import type { AgentConversationWindowRequest } from "@/types/agent-conversation-window"

const WINDOW_KIND_PARAM = "synapseWindow"
const WINDOW_KIND = "agent-conversation"

function normalizeRequiredParam(value: string | null): string | null {
  const normalized = value?.trim() ?? ""
  return normalized.length > 0 ? normalized : null
}

function normalizeOptionalParam(value: string | null): string | undefined {
  const normalized = value?.trim() ?? ""
  return normalized.length > 0 ? normalized : undefined
}

export function buildAgentConversationWindowSearchParams(
  request: AgentConversationWindowRequest,
): URLSearchParams {
  const params = new URLSearchParams({
    [WINDOW_KIND_PARAM]: WINDOW_KIND,
    projectId: request.projectId,
    conversationId: request.conversationId,
    sessionKey: request.sessionKey,
  })

  const title = normalizeOptionalParam(request.title ?? null)
  if (title) params.set("title", title)

  return params
}

export function parseAgentConversationWindowRequest(search: string): AgentConversationWindowRequest | null {
  const params = new URLSearchParams(search)
  if (params.get(WINDOW_KIND_PARAM) !== WINDOW_KIND) return null

  const projectId = normalizeRequiredParam(params.get("projectId"))
  const conversationId = normalizeRequiredParam(params.get("conversationId"))
  const sessionKey = normalizeRequiredParam(params.get("sessionKey"))
  if (!projectId || !conversationId || !sessionKey) return null

  const title = normalizeOptionalParam(params.get("title"))
  return {
    projectId,
    conversationId,
    sessionKey,
    ...(title ? { title } : {}),
  }
}
