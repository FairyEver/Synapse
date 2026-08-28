import { formatSynapseCost } from "@/lib/cost-currency"

export function formatEstimatedCostLabel({
  estimatedCost,
  tokens,
  unpricedTokens,
}: {
  readonly estimatedCost: number
  readonly tokens: number
  readonly unpricedTokens: number
}): string {
  if (tokens > 0 && unpricedTokens >= tokens) return "未定价"
  if (unpricedTokens > 0) return `${formatSynapseCost(estimatedCost)} · 部分定价`
  return formatSynapseCost(estimatedCost)
}
