import { CONVERSATION_IDLE_ROLLOVER_PROMPT_MS } from "../../../../config"

type ConversationActivityTimestampItem = {
  readonly timestamp?: string
}

type ConversationIdleRolloverPromptInput = {
  readonly latestActivityTimestamp?: string
  readonly now: number
  readonly sending: boolean
  readonly hasStartAction: boolean
}

function shouldShowConversationIdleRolloverPrompt({
  latestActivityTimestamp,
  now,
  sending,
  hasStartAction,
}: ConversationIdleRolloverPromptInput): boolean {
  if (sending || !hasStartAction || !latestActivityTimestamp) return false
  const latestActivityTime = Date.parse(latestActivityTimestamp)
  if (!Number.isFinite(latestActivityTime)) return false
  return now - latestActivityTime >= CONVERSATION_IDLE_ROLLOVER_PROMPT_MS
}

function latestConversationActivityTimestamp(
  items: readonly ConversationActivityTimestampItem[],
): string | undefined {
  let latestTimestamp: string | undefined
  let latestTime = Number.NEGATIVE_INFINITY
  for (const item of items) {
    if (!item.timestamp) continue
    const timestamp = Date.parse(item.timestamp)
    if (!Number.isFinite(timestamp) || timestamp < latestTime) continue
    latestTimestamp = item.timestamp
    latestTime = timestamp
  }
  return latestTimestamp
}

export {
  CONVERSATION_IDLE_ROLLOVER_PROMPT_MS,
  latestConversationActivityTimestamp,
  shouldShowConversationIdleRolloverPrompt,
}
export type { ConversationIdleRolloverPromptInput }
