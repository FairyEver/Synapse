import type {
  ModelPriceCoverageInput,
  ModelPriceCoverageRange,
  ModelPriceCoverageRow,
  ModelPriceCoverageSource,
  ModelPriceRule,
  ModelPriceRuleInput,
} from "@/types/bridge"

export type {
  ModelPriceCoverageInput,
  ModelPriceCoverageRange,
  ModelPriceCoverageRow,
  ModelPriceCoverageSource,
  ModelPriceRule,
  ModelPriceRuleInput,
}

export type ModelPriceViewId = "coverage" | "rules"

export type ModelPriceState<T> = {
  readonly data: T | null
  readonly loading: boolean
  readonly error: Error | null
  readonly reload: () => Promise<void>
}
