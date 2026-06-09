import type { SynapseCostCurrency } from "../../../action-packages/shared/cost-currency"

export interface ModelPriceRuleInput {
  readonly id?: string
  readonly modelPattern: string
  readonly inputPer1M?: number
  readonly outputPer1M?: number
  readonly cacheReadPer1M?: number
  readonly cacheWritePer1M?: number
  readonly reasoningPer1M?: number
  readonly currency?: SynapseCostCurrency
  readonly enabled?: boolean
  readonly source?: "builtin" | "user"
  readonly sortIndex?: number
  readonly updatedAt?: string
}

export interface ModelPriceRule {
  readonly id: string
  readonly modelPattern: string
  readonly inputPer1M: number
  readonly outputPer1M: number
  readonly cacheReadPer1M: number
  readonly cacheWritePer1M: number
  readonly reasoningPer1M: number
  readonly currency: SynapseCostCurrency
  readonly enabled: boolean
  readonly source: "builtin" | "user"
  readonly sortIndex: number
  readonly updatedAt: string
}

export type ModelPricePresetId =
  | "openai"
  | "anthropic"
  | "deepseek-official"
  | "aliyun-bailian"
  | "other"

export interface ModelPricePreset {
  readonly id: ModelPricePresetId
  readonly label: string
  readonly rules: readonly ModelPriceRuleInput[]
}

export interface ModelPricePresetSummary {
  readonly id: ModelPricePresetId
  readonly label: string
  readonly ruleCount: number
}

export interface ModelUsageTokenBreakdown {
  readonly input: number
  readonly output: number
  readonly cacheRead: number
  readonly cacheWrite: number
  readonly reasoning: number
}

export interface EstimatedModelUsageCost {
  readonly input: number
  readonly output: number
  readonly cacheRead: number
  readonly cacheWrite: number
  readonly reasoning: number
  readonly total: number
  readonly priceKnown: boolean
  readonly currency: SynapseCostCurrency
  readonly matchedRuleId?: string
  readonly matchedRulePattern?: string
}

export interface ModelPriceRulePatch {
  readonly modelPattern?: string
  readonly inputPer1M?: number
  readonly outputPer1M?: number
  readonly cacheReadPer1M?: number
  readonly cacheWritePer1M?: number
  readonly reasoningPer1M?: number
  readonly enabled?: boolean
}

export interface ModelPriceRuleDeleteResult {
  readonly deleted: true
  readonly ruleId: string
}

export type ModelPriceCoverageSource = "all" | "cc" | "codex"
export type ModelPriceCoverageRange = "today" | "7d" | "30d" | "90d" | "all"
export type ModelPriceUsageSourceName = "cc" | "codex"

export interface ModelPriceCoverageInput {
  readonly source?: ModelPriceCoverageSource
  readonly range?: ModelPriceCoverageRange
  readonly limit?: number
}

export interface ModelPriceCoverageRow {
  readonly model: string
  readonly sources: ModelPriceUsageSourceName[]
  readonly tokens: number
  readonly requests: number
  readonly pricedTokens: number
  readonly unpricedTokens: number
  readonly estimatedCost: number
  readonly input: number
  readonly output: number
  readonly cacheRead: number
  readonly cacheWrite: number
  readonly reasoning: number
  readonly priceKnown: boolean
  readonly matchedRuleId?: string
  readonly matchedRulePattern?: string
}
