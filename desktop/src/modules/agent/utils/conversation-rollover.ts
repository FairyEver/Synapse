const CONVERSATION_ROLLOVER_COST_THRESHOLD_CNY = 10
const CONVERSATION_ROLLOVER_TOKEN_FALLBACK_THRESHOLD = 5_000_000

interface ConversationRolloverMetadata {
  readonly totalCostCny?: number
  readonly usage?: Record<string, unknown>
}

const COMPONENT_TOKEN_FIELDS = [
  ["inputTokens", "input_tokens"],
  ["outputTokens", "output_tokens"],
  ["cacheReadInputTokens", "cache_read_input_tokens"],
  ["cacheCreationInputTokens", "cache_creation_input_tokens"],
  ["reasoningOutputTokens", "reasoning_output_tokens"],
] as const

function shouldShowConversationRolloverPrompt(metadata: ConversationRolloverMetadata | undefined): boolean {
  if (!metadata) return false
  if (isFiniteNumber(metadata.totalCostCny)) {
    return metadata.totalCostCny >= CONVERSATION_ROLLOVER_COST_THRESHOLD_CNY
  }
  return conversationRolloverTotalTokens(metadata.usage) >= CONVERSATION_ROLLOVER_TOKEN_FALLBACK_THRESHOLD
}

function conversationRolloverTotalTokens(usage: Record<string, unknown> | undefined): number {
  if (!usage) return 0
  const componentTotal = COMPONENT_TOKEN_FIELDS.reduce((total, fields) => (
    total + numericUsageField(usage, fields)
  ), 0)
  if (componentTotal > 0) return componentTotal
  return numericUsageField(usage, ["totalTokens", "total_tokens"])
}

function numericUsageField(
  usage: Record<string, unknown>,
  fields: readonly string[],
): number {
  for (const field of fields) {
    const value = usage[field]
    if (isFiniteNumber(value) && value > 0) return value
  }
  return 0
}

function isFiniteNumber(value: unknown): value is number {
  return typeof value === "number" && Number.isFinite(value)
}

export {
  CONVERSATION_ROLLOVER_COST_THRESHOLD_CNY,
  CONVERSATION_ROLLOVER_TOKEN_FALLBACK_THRESHOLD,
  conversationRolloverTotalTokens,
  shouldShowConversationRolloverPrompt,
}
export type { ConversationRolloverMetadata }
