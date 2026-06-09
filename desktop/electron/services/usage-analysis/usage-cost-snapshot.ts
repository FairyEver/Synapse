import { estimateModelUsageCost, roundModelUsageCost, type ModelPriceRule } from "../model-price"
import type { UsageCostBreakdown, UsageTokenBreakdown } from "./types"

export interface SynapseUsageCostSnapshot {
  readonly modelName: string
  readonly costCny?: number
  readonly costBreakdownCny?: UsageCostBreakdown
  readonly costCurrency?: "CNY"
  readonly priceKnown: boolean
  readonly estimatedCost: boolean
}

export function usageTokenBreakdownFromRecord(
  usage: Record<string, unknown> | undefined,
): UsageTokenBreakdown | undefined {
  if (!usage) return undefined
  const breakdown = {
    input: usageTokenNumber(usage, ["input_tokens", "inputTokens"]),
    output: usageTokenNumber(usage, ["output_tokens", "outputTokens"]),
    cacheRead: usageTokenNumber(usage, ["cache_read_input_tokens", "cacheReadInputTokens", "cacheRead"]),
    cacheWrite: usageTokenNumber(usage, ["cache_creation_input_tokens", "cacheCreationInputTokens", "cacheWrite"]),
    reasoning: usageTokenNumber(usage, [
      "reasoning_output_tokens",
      "reasoningOutputTokens",
      "reasoning_tokens",
      "reasoningTokens",
    ]),
  }
  return Object.values(breakdown).some((value) => value > 0) ? breakdown : undefined
}

export function estimateSynapseUsageCostSnapshot(input: {
  readonly modelName?: string
  readonly usage?: Record<string, unknown>
  readonly priceRules: readonly ModelPriceRule[]
}): SynapseUsageCostSnapshot | undefined {
  const modelName = input.modelName?.trim()
  if (!modelName) return undefined
  const tokens = usageTokenBreakdownFromRecord(input.usage)
  if (!tokens) return undefined
  const cost = estimateModelUsageCost(modelName, tokens, input.priceRules)
  if (!cost.priceKnown) {
    return {
      modelName,
      priceKnown: false,
      estimatedCost: false,
    }
  }
  return {
    modelName,
    costCny: roundModelUsageCost(cost.total),
    costBreakdownCny: {
      input: roundModelUsageCost(cost.input),
      output: roundModelUsageCost(cost.output),
      cacheRead: roundModelUsageCost(cost.cacheRead),
      cacheWrite: roundModelUsageCost(cost.cacheWrite),
      reasoning: roundModelUsageCost(cost.reasoning),
    },
    costCurrency: "CNY",
    priceKnown: true,
    estimatedCost: true,
  }
}

function usageTokenNumber(usage: Record<string, unknown>, keys: readonly string[]): number {
  for (const key of keys) {
    const value = usage[key]
    if (typeof value === "number" && Number.isFinite(value) && value >= 0) return value
  }
  return 0
}
