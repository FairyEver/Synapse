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
