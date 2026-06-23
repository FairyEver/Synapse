import { createContext, useContext, useEffect, useState, type ReactNode } from "react"
import type { SynapseAgentProvider } from "@/types/bridge"
import type { ModelTier } from "@/types/provider-model"
import { createRendererLogger } from "@/app-shell/logging"
import { errorDiagnostic } from "@/modules/workflow/lib/error-utils"
import { resolveModelDisplayName, resolveModelName } from "@/lib/provider-model"

const logger = createRendererLogger("workflow.provider-lookup")

type ProviderLookup = {
  getProviderName: (providerId: string) => string | undefined
  getModelName: (providerId: string, modelTier: ModelTier) => string | undefined
  getModelDisplayName: (providerId: string, modelTier: ModelTier) => string | undefined
  isProviderAvailable: (providerId: string) => boolean
}

const defaultLookup: ProviderLookup = {
  getProviderName: () => undefined,
  getModelName: () => undefined,
  getModelDisplayName: () => undefined,
  isProviderAvailable: () => true,
}

const ProviderLookupContext = createContext<ProviderLookup>(defaultLookup)

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
          ...errorDiagnostic(err),
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
      return provider ? resolveModelName(provider, modelTier) : undefined
    },
    getModelDisplayName: (providerId, modelTier) => {
      const provider = providers.find((p) => p.id === providerId)
      return provider ? resolveModelDisplayName(provider, modelTier) : undefined
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
