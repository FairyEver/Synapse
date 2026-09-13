import type { ModelTier, ProviderModelSelection } from "../types/provider-model"

export type ProviderModelMap = {
  readonly id?: string
  readonly source?: "local" | "user" | string
  readonly model?: string
  readonly haikuModel?: string
  readonly sonnetModel?: string
  readonly opusModel?: string
  readonly archived?: boolean
}

const LOCAL_CLAUDE_CODE_PROVIDER_ID = "local-claude-code"
export const LOCAL_CLAUDE_CODE_DEFAULT_MODEL_LABEL = "Claude Code 默认"
export const MODEL_TIER_DISPLAY_LABELS: Record<ModelTier, string> = {
  default: "#1",
  haiku: "#4",
  sonnet: "#3",
  opus: "#2",
}
export const MODEL_TIER_ORIGINAL_LABELS: Record<ModelTier, string> = {
  default: "主模型",
  haiku: "Haiku",
  sonnet: "Sonnet",
  opus: "Opus",
}
export const MODEL_TIER_DISPLAY_ORDER: readonly ModelTier[] = ["default", "opus", "sonnet", "haiku"]

/**
 * Extract the model name string from a provider by tier.
 */
export function resolveModelName(provider: ProviderModelMap, tier: ModelTier): string | undefined {
  const raw = tier === "default" ? provider.model
    : tier === "haiku" ? provider.haikuModel
    : tier === "sonnet" ? provider.sonnetModel
    : provider.opusModel
  const trimmed = raw?.trim()
  return trimmed || undefined
}

export function isLocalClaudeCodeProvider(provider: ProviderModelMap): boolean {
  return provider.id === LOCAL_CLAUDE_CODE_PROVIDER_ID || provider.source === "local"
}

export function isProviderModelTierSelectable(provider: ProviderModelMap, tier: ModelTier): boolean {
  if (resolveModelName(provider, tier)) return true
  return tier === "default" && isLocalClaudeCodeProvider(provider)
}

export function resolveModelDisplayName(provider: ProviderModelMap, tier: ModelTier): string | undefined {
  const modelName = resolveModelName(provider, tier)
  if (modelName) return modelName
  if (tier === "default" && isLocalClaudeCodeProvider(provider)) {
    return LOCAL_CLAUDE_CODE_DEFAULT_MODEL_LABEL
  }
  return undefined
}

type SelectableProvider = ProviderModelMap & {
  readonly id: string
  readonly name: string
  readonly active?: boolean
}

export function pickDefaultProviderModelTier(provider: SelectableProvider): ModelTier | undefined {
  if (isProviderModelTierSelectable(provider, "sonnet")) return "sonnet"
  return MODEL_TIER_DISPLAY_ORDER.find((tier) => isProviderModelTierSelectable(provider, tier))
}

export function pickInitialProviderModelSelection(
  providers: readonly SelectableProvider[],
  preferred?: ProviderModelSelection | null,
  autoSelectFallback = true,
): ProviderModelSelection | undefined {
  const available = providers.filter((provider) => !provider.archived)
  const preferredProvider = preferred
    ? available.find((provider) => provider.id === preferred.providerId)
    : undefined

  if (preferredProvider && preferred
    && isProviderModelTierSelectable(preferredProvider, preferred.modelTier)) {
    return selectionForProvider(preferredProvider, preferred.modelTier)
  }
  if (!autoSelectFallback) return undefined

  const provider = preferredProvider
    ?? available.find((item) => item.active)
    ?? available[0]
  if (!provider) return undefined
  const tier = pickDefaultProviderModelTier(provider)
  return tier ? selectionForProvider(provider, tier) : undefined
}

export function selectionForProvider(
  provider: SelectableProvider,
  modelTier: ModelTier,
): ProviderModelSelection {
  return {
    providerId: provider.id,
    providerName: provider.name,
    modelTier,
    modelName: resolveModelName(provider, modelTier),
  }
}
