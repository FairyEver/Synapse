import { createContext, useContext, useEffect, useState, type ReactNode } from "react"
import type { SynapseAgentProvider } from "@/types/bridge"
import type { ModelTier } from "@/types/provider-model"

type ProviderLookup = {
  getProviderName: (providerId: string) => string | undefined
  getModelName: (providerId: string, modelTier: ModelTier) => string | undefined
}

const defaultLookup: ProviderLookup = {
  getProviderName: () => undefined,
  getModelName: () => undefined,
}

const ProviderLookupContext = createContext<ProviderLookup>(defaultLookup)

function tierModelValue(provider: SynapseAgentProvider, tier: ModelTier): string | undefined {
  const raw = tier === "default" ? provider.model
    : tier === "haiku" ? provider.haikuModel
    : tier === "sonnet" ? provider.sonnetModel
    : provider.opusModel
  const trimmed = raw?.trim()
  return trimmed || undefined
}

function ProviderLookupProvider({ children }: { children: ReactNode }) {
  const [providers, setProviders] = useState<SynapseAgentProvider[]>([])

  useEffect(() => {
    let cancelled = false
    void (async () => {
      try {
        const list = await window.synapse?.agent.listProviders()
        if (!cancelled && list) setProviders(list)
      } catch {
        // Provider lookup is best-effort; cards fall back to raw IDs
      }
    })()
    return () => { cancelled = true }
  }, [])

  const lookup: ProviderLookup = {
    getProviderName: (providerId) =>
      providers.find((p) => p.id === providerId)?.name,
    getModelName: (providerId, modelTier) => {
      const provider = providers.find((p) => p.id === providerId)
      return provider ? tierModelValue(provider, modelTier) : undefined
    },
  }

  return (
    <ProviderLookupContext.Provider value={lookup}>
      {children}
    </ProviderLookupContext.Provider>
  )
}

function useProviderLookup(): ProviderLookup {
  return useContext(ProviderLookupContext)
}

export { ProviderLookupContext, ProviderLookupProvider, useProviderLookup }
export type { ProviderLookup }
