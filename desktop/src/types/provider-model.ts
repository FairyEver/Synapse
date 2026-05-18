export type ModelTier = "default" | "haiku" | "sonnet" | "opus"

export type ProviderModelSelection = {
  readonly providerId: string
  readonly modelTier: ModelTier
  readonly providerName?: string
  readonly modelName?: string
}

export const MODEL_TIERS = ["default", "haiku", "sonnet", "opus"] as const
