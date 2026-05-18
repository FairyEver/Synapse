import type { ModelTier } from "@/types/provider-model"
import type { SynapseAgentProvider } from "@/types/bridge"

export type ProviderReferenceStatus =
  | { valid: true }
  | { valid: false; reason: "provider_not_found" }
  | { valid: false; reason: "provider_archived" }
  | { degraded: true; reason: "tier_unavailable"; fallbackModel?: string }

function tierModelValue(provider: SynapseAgentProvider, tier: ModelTier): string | undefined {
  const raw = tier === "default" ? provider.model
    : tier === "haiku" ? provider.haikuModel
    : tier === "sonnet" ? provider.sonnetModel
    : provider.opusModel
  const trimmed = raw?.trim()
  return trimmed || undefined
}

export function validateProviderReference(
  providerId: string,
  modelTier: ModelTier,
  providers: readonly SynapseAgentProvider[],
  allProviders: readonly SynapseAgentProvider[],
): ProviderReferenceStatus {
  const inActive = providers.find((p) => p.id === providerId)
  if (inActive) {
    const tierValue = tierModelValue(inActive, modelTier)
    if (tierValue) return { valid: true }
    return { degraded: true, reason: "tier_unavailable", fallbackModel: inActive.model?.trim() || undefined }
  }

  const inAll = allProviders.find((p) => p.id === providerId)
  if (inAll) {
    return { valid: false, reason: "provider_archived" }
  }

  return { valid: false, reason: "provider_not_found" }
}
