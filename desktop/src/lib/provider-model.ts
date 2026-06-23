import { useEffect, useState } from "react"
import { requireSynapseBridge } from "@/lib/electron-bridge"
import type { ModelTier, ProviderModelSelection } from "@/types/provider-model"

type ProviderModelMap = {
  readonly id?: string
  readonly source?: "local" | "user" | string
  readonly model?: string
  readonly haikuModel?: string
  readonly sonnetModel?: string
  readonly opusModel?: string
}

const LOCAL_CLAUDE_CODE_PROVIDER_ID = "local-claude-code"
const LOCAL_CLAUDE_CODE_DEFAULT_MODEL_LABEL = "Claude Code 默认"
const MODEL_TIER_DISPLAY_LABELS: Record<ModelTier, string> = {
  default: "主模型",
  haiku: "Haiku",
  sonnet: "Sonnet",
  opus: "Opus",
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

function isLocalClaudeCodeProvider(provider: ProviderModelMap): boolean {
  return provider.id === LOCAL_CLAUDE_CODE_PROVIDER_ID || provider.source === "local"
}

function isProviderModelTierSelectable(provider: ProviderModelMap, tier: ModelTier): boolean {
  if (resolveModelName(provider, tier)) return true
  return tier === "default" && isLocalClaudeCodeProvider(provider)
}

function resolveModelDisplayName(provider: ProviderModelMap, tier: ModelTier): string | undefined {
  const modelName = resolveModelName(provider, tier)
  if (modelName) return modelName
  if (tier === "default" && isLocalClaudeCodeProvider(provider)) {
    return LOCAL_CLAUDE_CODE_DEFAULT_MODEL_LABEL
  }
  return undefined
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

export {
  LOCAL_CLAUDE_CODE_DEFAULT_MODEL_LABEL,
  MODEL_TIER_DISPLAY_LABELS,
  formatProviderModelLabel,
  isLocalClaudeCodeProvider,
  isProviderModelTierSelectable,
  resolveModelDisplayName,
  resolveModelName,
  useProviderModelLabel,
}
