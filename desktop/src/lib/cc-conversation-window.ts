import type {
  CcConversationFocus,
  CcConversationWindowRequest,
} from "../types/usage-analysis-conversations"

const WINDOW_KIND_PARAM = "synapseWindow"
const WINDOW_KIND = "cc-conversation"

function appendFocus(params: URLSearchParams, focus?: CcConversationFocus): void {
  if (!focus) return
  if (focus.eventId) params.set("eventId", focus.eventId)
  if (focus.usageEventId) params.set("usageEventId", focus.usageEventId)
  if (focus.toolEventId) params.set("toolEventId", focus.toolEventId)
  if (typeof focus.timestampMs === "number" && Number.isFinite(focus.timestampMs)) {
    params.set("timestampMs", String(Math.trunc(focus.timestampMs)))
  }
}

function parseOptionalTimestamp(value: string | null): number | undefined {
  const normalized = value?.trim() ?? ""
  if (!normalized) return undefined

  const timestampMs = Number(normalized)
  return Number.isFinite(timestampMs) ? Math.trunc(timestampMs) : undefined
}

function parseFocus(params: URLSearchParams): CcConversationFocus | undefined {
  const eventId = params.get("eventId")?.trim() || undefined
  const usageEventId = params.get("usageEventId")?.trim() || undefined
  const toolEventId = params.get("toolEventId")?.trim() || undefined
  const timestampMs = parseOptionalTimestamp(params.get("timestampMs"))

  if (!eventId && !usageEventId && !toolEventId && timestampMs === undefined) return undefined

  return { eventId, usageEventId, toolEventId, timestampMs }
}

export function buildCcConversationWindowSearchParams(
  request: CcConversationWindowRequest,
): URLSearchParams {
  const params = new URLSearchParams({
    [WINDOW_KIND_PARAM]: WINDOW_KIND,
    sessionId: request.sessionId,
  })

  if (request.title?.trim()) params.set("title", request.title.trim())
  appendFocus(params, request.focus)

  return params
}

export function parseCcConversationWindowRequest(search: string): CcConversationWindowRequest | null {
  const params = new URLSearchParams(search)
  if (params.get(WINDOW_KIND_PARAM) !== WINDOW_KIND) return null

  const sessionId = params.get("sessionId")?.trim() ?? ""
  if (!sessionId) return null

  const title = params.get("title")?.trim() || undefined
  const focus = parseFocus(params)

  return {
    sessionId,
    ...(title ? { title } : {}),
    ...(focus ? { focus } : {}),
  }
}
