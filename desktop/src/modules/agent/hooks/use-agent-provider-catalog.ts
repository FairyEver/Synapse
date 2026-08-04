import { useCallback, useEffect, useRef, useState } from "react"

import { createRendererLogger } from "@/app-shell/logging"
import { requireSynapseBridge } from "@/lib/electron-bridge"
import type { SynapseAgentProvider } from "@/types/bridge"

const logger = createRendererLogger("agent")

type UseAgentProviderCatalogResult = {
  readonly providers: readonly SynapseAgentProvider[] | null
  readonly isLoading: boolean
  readonly hasError: boolean
  readonly reload: () => Promise<readonly SynapseAgentProvider[] | null>
}

function useAgentProviderCatalog(enabled: boolean): UseAgentProviderCatalogResult {
  const [providers, setProviders] = useState<readonly SynapseAgentProvider[] | null>(null)
  const [isLoading, setIsLoading] = useState(false)
  const [hasError, setHasError] = useState(false)
  const requestIdRef = useRef(0)

  const reload = useCallback(async () => {
    const requestId = ++requestIdRef.current
    setIsLoading(true)
    setHasError(false)
    try {
      const nextProviders = await requireSynapseBridge().agent.listAllProviders()
      if (requestId !== requestIdRef.current) return null
      setProviders(nextProviders)
      return nextProviders
    } catch (rawError) {
      logger.warn("Agent session model list failed.", {
        boundary: "renderer.agent.session-create-model-list",
        errorName: rawError instanceof Error ? rawError.name : typeof rawError,
        errorLength: errorMessageLength(rawError),
      })
      if (requestId !== requestIdRef.current) return null
      setProviders(null)
      setHasError(true)
      return null
    } finally {
      if (requestId === requestIdRef.current) setIsLoading(false)
    }
  }, [])

  useEffect(() => {
    if (!enabled) {
      requestIdRef.current += 1
      setIsLoading(false)
      setHasError(false)
      return undefined
    }
    void reload()
    return () => {
      requestIdRef.current += 1
    }
  }, [enabled, reload])

  return { providers, isLoading, hasError, reload }
}

function errorMessageLength(error: unknown): number {
  return (error instanceof Error ? error.message : String(error)).length
}

export { useAgentProviderCatalog }
export type { UseAgentProviderCatalogResult }
