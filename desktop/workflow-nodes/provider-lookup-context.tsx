import { createContext, useContext, useEffect, useState, type ReactNode } from "react"
import type { SynapseAgentProvider } from "@/types/bridge"
import type { ModelTier } from "@/types/provider-model"
import { createRendererLogger } from "@/app-shell/logging"
import { truncateWithEllipsis } from "@/modules/workflow/lib/error-utils"

const logger = createRendererLogger("workflow.provider-lookup")

function errorLogMeta(error: unknown): { readonly errorName: string; readonly errorLength: number; readonly errorMessage: string } {
  const raw = error instanceof Error ? error.message : String(error)
  return {
    errorName: error instanceof Error ? error.name : typeof error,
    errorLength: raw.length,
    errorMessage: truncateWithEllipsis(raw, 200),
  }
}

type ProviderLookup = {
  getProviderName: (providerId: string) => string | undefined
  getModelName: (providerId: string, modelTier: ModelTier) => string | undefined
  isProviderAvailable: (providerId: string) => boolean
}

const defaultLookup: ProviderLookup = {
  getProviderName: () => undefined,
  getModelName: () => undefined,
  isProviderAvailable: () => true,
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
  const [loaded, setLoaded] = useState(false)

  useEffect(() => {
    let cancelled = false
    void (async () => {
      try {
        const list = await window.synapse?.agent.listProviders()
        if (!cancelled && list) setProviders(list)
      } catch (err) {
        logger.warn("provider list fetch failed — cards will show raw IDs", {
          ...errorLogMeta(err),
        })
      } finally {
        if (!cancelled) setLoaded(true)
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
    isProviderAvailable: (providerId) => {
      if (!loaded) return true
      const provider = providers.find((p) => p.id === providerId)
      return provider != null && !provider.archived
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
