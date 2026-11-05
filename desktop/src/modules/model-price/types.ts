import type {
  ModelPricePresetId,
  ModelPricePresetSummary,
  ModelPriceRule,
  ModelPriceRuleInput,
} from "@/types/bridge"

export type {
  ModelPricePresetId,
  ModelPricePresetSummary,
  ModelPriceRule,
  ModelPriceRuleInput,
}

export type ModelPriceState<T> = {
  readonly data: T | null
  readonly loading: boolean
  readonly error: Error | null
  readonly reload: () => Promise<void>
}
