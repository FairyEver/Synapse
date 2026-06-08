import { useEffect, useState } from "react"
import { requireSynapseBridge } from "@/lib/electron-bridge"
import type { ModelTier, ProviderModelSelection } from "@/types/provider-model"

type ProviderModelMap = {
  readonly model?: string
  readonly haikuModel?: string
  readonly sonnetModel?: string
  readonly opusModel?: string
}

/**
 * Extract the model name string from a provider by tier.
 */
function resolveModelName(provider: ProviderModelMap, tier: ModelTier): string | undefined {
  const raw = tier === "default" ? provider.model
    : tier === "haiku" ? provider.haikuModel
    : tier === "sonnet" ? provider.sonnetModel
    : provider.opusModel
  const trimmed = raw?.trim()
  return trimmed || undefined
}

/**
 * Format a display label like "Claude Official claude-sonnet-4-20250514".
 */
function formatProviderModelLabel(
  providerName: string,
  modelName: string | undefined,
  modelTier: ModelTier,
): string {
  return `${providerName} ${modelName ?? modelTier}`
}

/**
 * Hook that resolves a ProviderModelSelection to a display label.
 * If the selection already carries providerName, formats directly.
 * Otherwise fetches the provider list to resolve names.
 */
function useProviderModelLabel(
  selection: ProviderModelSelection | null | undefined,
): string {
  const [label, setLabel] = useState("")

  useEffect(() => {
    if (!selection) {
      setLabel("")
      return
    }

    if (selection.providerName) {
      setLabel(formatProviderModelLabel(
        selection.providerName,
        selection.modelName,
        selection.modelTier,
      ))
      return
    }

    let cancelled = false
    void (async () => {
      try {
        const providers = await requireSynapseBridge().agent.listProviders()
        if (cancelled) return
        const provider = providers.find((p) => p.id === selection.providerId)
        if (provider) {
          const modelName = resolveModelName(provider, selection.modelTier)
          setLabel(formatProviderModelLabel(provider.name, modelName, selection.modelTier))
        } else {
          setLabel(selection.providerId)
        }
      } catch {
        setLabel(selection.providerId)
      }
    })()
    return () => { cancelled = true }
  }, [selection?.providerId, selection?.providerName, selection?.modelName, selection?.modelTier])

  return label
}

export { resolveModelName, formatProviderModelLabel, useProviderModelLabel }
