import { useCallback, useEffect, useMemo, useState } from "react"
import { requireSynapseBridge } from "@/lib/electron-bridge"
import type { ModelTier, ProviderModelSelection } from "@/types/provider-model"
import {
  LOCAL_CLAUDE_CODE_DEFAULT_MODEL_LABEL,
  MODEL_TIER_DISPLAY_ORDER,
  MODEL_TIER_DISPLAY_LABELS,
  MODEL_TIER_ORIGINAL_LABELS,
  isLocalClaudeCodeProvider,
  isProviderModelTierSelectable,
  resolveModelDisplayName,
  resolveModelName,
  type ProviderModelMap,
} from "./provider-model-selection"

type ProviderModelDisplayStatus = "available" | "archived" | "unavailable" | "unknown"

type ProviderModelDisplay = {
  readonly label: string
  readonly status: ProviderModelDisplayStatus
}

type ProviderModelDisplayProvider = ProviderModelMap & {
  readonly id: string
  readonly name: string
}

type ProviderModelCatalog = {
  readonly providers: readonly ProviderModelDisplayProvider[] | null
  readonly refresh: () => Promise<void>
}

/**
 * Format a display label like "Claude Official claude-sonnet-4-20250514".
 */
function formatProviderModelLabel(
  providerName: string,
  modelName: string | undefined,
  modelTier: ModelTier,
  provider?: ProviderModelMap,
): string {
  const modelDisplay = modelName
    ?? (provider ? resolveModelDisplayName(provider, modelTier) : undefined)
    ?? MODEL_TIER_DISPLAY_LABELS[modelTier]
    ?? modelTier
  return `${providerName} ${modelDisplay}`
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
        { id: selection.providerId },
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
          setLabel(formatProviderModelLabel(provider.name, modelName, selection.modelTier, provider))
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

function useProviderModelCatalog(): ProviderModelCatalog {
  const [providers, setProviders] = useState<readonly ProviderModelDisplayProvider[] | null>(null)
  const refresh = useCallback(async () => {
    try {
      setProviders(await requireSynapseBridge().agent.listAllProviders())
    } catch {
      setProviders(null)
    }
  }, [])

  useEffect(() => {
    void refresh()
  }, [refresh])

  return useMemo(() => ({ providers, refresh }), [providers, refresh])
}

function resolveProviderModelDisplay(
  selection: ProviderModelSelection,
  providers: readonly ProviderModelDisplayProvider[] | null,
): ProviderModelDisplay {
  if (!providers) {
    return { label: fallbackProviderModelLabel(selection), status: "unknown" }
  }
  const provider = providers.find((item) => item.id === selection.providerId)
  if (selection.providerName && !provider?.archived) {
    return { label: fallbackProviderModelLabel(selection), status: "available" }
  }
  if (!provider) {
    return {
      label: `${fallbackProviderModelLabel(selection)}（不可用）`,
      status: "unavailable",
    }
  }

  const label = formatProviderModelLabel(
    provider.name,
    resolveModelName(provider, selection.modelTier),
    selection.modelTier,
    provider,
  )
  if (!isProviderModelTierSelectable(provider, selection.modelTier)) {
    return { label: `${label}（不可用）`, status: "unavailable" }
  }
  if (provider.archived) {
    return { label: `${label}（已归档）`, status: "archived" }
  }
  return { label, status: "available" }
}

function fallbackProviderModelLabel(selection: ProviderModelSelection): string {
  return formatProviderModelLabel(
    selection.providerName ?? selection.providerId,
    selection.modelName,
    selection.modelTier,
  )
}

export {
  LOCAL_CLAUDE_CODE_DEFAULT_MODEL_LABEL,
  MODEL_TIER_DISPLAY_ORDER,
  MODEL_TIER_DISPLAY_LABELS,
  MODEL_TIER_ORIGINAL_LABELS,
  formatProviderModelLabel,
  isLocalClaudeCodeProvider,
  isProviderModelTierSelectable,
  resolveModelDisplayName,
  resolveModelName,
  resolveProviderModelDisplay,
  useProviderModelCatalog,
  useProviderModelLabel,
}
export type { ProviderModelCatalog, ProviderModelDisplay, ProviderModelDisplayProvider, ProviderModelDisplayStatus }
