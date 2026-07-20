import { Button } from "@/components/ui/button"
import { ModelTierLabel } from "@/components/model-tier-label"
import { RadioGroup, RadioGroupItem } from "@/components/ui/radio-group"
import { Skeleton } from "@/components/ui/skeleton"
import { TooltipProvider } from "@/components/ui/tooltip"
import {
  Table,
  TableBody,
  TableCell,
  TableRow,
} from "@/components/ui/table"
import {
  isProviderModelTierSelectable,
  MODEL_TIER_DISPLAY_LABELS,
  MODEL_TIER_DISPLAY_ORDER,
  MODEL_TIER_ORIGINAL_LABELS,
  resolveModelDisplayName,
  resolveModelName,
} from "@/lib/provider-model"
import { cn } from "@/lib/utils"
import type { SynapseAgentProvider } from "@/types/bridge"
import type { ModelTier, ProviderModelSelection } from "@/types/provider-model"

const EMPTY_EXCLUDED_PROVIDERS: readonly string[] = []

type ProviderModelPickerProps = {
  readonly providers: readonly SynapseAgentProvider[]
  readonly value: ProviderModelSelection | null | undefined
  readonly onValueChange: (selection: ProviderModelSelection) => void
  readonly loading?: boolean
  readonly error?: string | null
  readonly disabled?: boolean
  readonly excludeProviderIds?: readonly string[]
  readonly onRetry?: () => void
  readonly className?: string
}

function ProviderModelPicker({
  providers,
  value,
  onValueChange,
  loading = false,
  error,
  disabled = false,
  excludeProviderIds = EMPTY_EXCLUDED_PROVIDERS,
  onRetry,
  className,
}: ProviderModelPickerProps) {
  const visibleProviders = providers.filter((provider) =>
    !provider.archived && !excludeProviderIds.includes(provider.id))

  if (error) {
    return (
      <div className={cn("flex min-h-20 items-center gap-2 rounded-lg border px-3", className)}>
        <p className="text-sm text-destructive">{error}</p>
        {onRetry ? (
          <Button type="button" variant="outline" size="sm" disabled={disabled} onClick={onRetry}>
            重试
          </Button>
        ) : null}
      </div>
    )
  }

  const handleSelectProvider = (providerId: string) => {
    const provider = visibleProviders.find((item) => item.id === providerId)
    if (!provider) return
    const tier = value?.modelTier && isProviderModelTierSelectable(provider, value.modelTier)
      ? value.modelTier
      : pickDefaultProviderModelTier(provider)
    if (tier) onValueChange(selectionForProvider(provider, tier))
  }

  return (
    <div
      className={cn("overflow-y-auto rounded-lg border", className)}
      aria-busy={loading || undefined}
    >
      <TooltipProvider>
        <RadioGroup
          aria-label="供应商与模型"
          value={value?.providerId ?? ""}
          disabled={disabled || loading}
          onValueChange={handleSelectProvider}
        >
          <Table className="table-fixed">
            <TableBody>
              {loading ? (
                <ProviderModelPickerSkeleton />
              ) : visibleProviders.length === 0 ? (
                <TableRow>
                  <TableCell colSpan={3} className="text-muted-foreground">
                    暂无 Provider
                  </TableCell>
                </TableRow>
              ) : visibleProviders.map((provider) => {
                const selected = provider.id === value?.providerId
                const tiers = availableTiers(provider)
                const selectable = tiers.length > 0
                return (
                  <TableRow
                    key={provider.id}
                    data-state={selected ? "selected" : undefined}
                    className={cn(
                      "data-[state=selected]:bg-muted/50",
                      selectable && !disabled && "cursor-pointer",
                    )}
                    onClick={(event) => {
                      if ((event.target as HTMLElement).closest("button")) return
                      if (!disabled && selectable) handleSelectProvider(provider.id)
                    }}
                  >
                    <TableCell className="w-8 py-3 pr-1 pl-2">
                      <RadioGroupItem
                        value={provider.id}
                        aria-label={provider.name}
                        disabled={disabled || !selectable}
                      />
                    </TableCell>
                    <TableCell className="w-40 min-w-0 pl-1">
                      <span
                        title={provider.name}
                        className={cn("block truncate font-medium", selected && "font-semibold")}
                      >
                        {provider.name}
                      </span>
                    </TableCell>
                    <TableCell className="min-w-0 py-2.5">
                      <div className="grid grid-cols-1 gap-1 sm:grid-cols-2">
                        {tiers.map((tierConfig) => {
                          const modelDisplayName = resolveModelDisplayName(provider, tierConfig.tier)
                          const isTierSelected = selected && value?.modelTier === tierConfig.tier
                          const accessibleLabel = modelDisplayName
                            ? `${tierConfig.label}，原名称：${tierConfig.originalLabel}，模型：${modelDisplayName}`
                            : `${tierConfig.label}，原名称：${tierConfig.originalLabel}`
                          return (
                            <button
                              key={tierConfig.tier}
                              data-tier={tierConfig.tier}
                              type="button"
                              disabled={disabled}
                              aria-label={accessibleLabel}
                              aria-pressed={isTierSelected}
                              className={cn(
                                "flex min-h-10 w-full min-w-0 items-center gap-1.5 rounded px-2 text-left text-sm outline-none transition-[background-color,color,scale] duration-150 ease-out active:scale-[0.96] focus-visible:ring-2 focus-visible:ring-ring/50 disabled:cursor-not-allowed disabled:opacity-50 motion-reduce:transition-none motion-reduce:active:scale-100",
                                isTierSelected
                                  ? "bg-primary text-primary-foreground"
                                  : "text-foreground hover:bg-muted",
                              )}
                              onClick={(event) => {
                                event.stopPropagation()
                                onValueChange(selectionForProvider(provider, tierConfig.tier))
                              }}
                            >
                              <ModelTierLabel
                                tier={tierConfig.tier}
                                className="shrink-0 font-medium"
                              />
                              {modelDisplayName ? (
                                <span className={cn(
                                  "min-w-0 truncate text-xs",
                                  isTierSelected ? "text-primary-foreground/75" : "text-muted-foreground",
                                )}>
                                  {modelDisplayName}
                                </span>
                              ) : null}
                            </button>
                          )
                        })}
                      </div>
                    </TableCell>
                  </TableRow>
                )
              })}
            </TableBody>
          </Table>
        </RadioGroup>
      </TooltipProvider>
    </div>
  )
}

function ProviderModelPickerSkeleton() {
  return Array.from({ length: 3 }, (_, index) => (
    <TableRow key={index}>
      <TableCell className="w-8 py-3 pr-1 pl-2">
        <Skeleton className="size-4 rounded-full" />
      </TableCell>
      <TableCell className="w-40 pl-1">
        <Skeleton className="h-4 w-28" />
      </TableCell>
      <TableCell>
        <Skeleton className="h-7 w-full" />
      </TableCell>
    </TableRow>
  ))
}

function availableTiers(provider: SynapseAgentProvider) {
  return MODEL_TIER_DISPLAY_ORDER.flatMap((tier) =>
    isProviderModelTierSelectable(provider, tier)
      ? [{
          tier,
          label: MODEL_TIER_DISPLAY_LABELS[tier],
          originalLabel: MODEL_TIER_ORIGINAL_LABELS[tier],
        }]
      : [])
}

function pickDefaultProviderModelTier(provider: SynapseAgentProvider): ModelTier | undefined {
  if (isProviderModelTierSelectable(provider, "sonnet")) return "sonnet"
  return availableTiers(provider)[0]?.tier
}

function pickInitialProviderModelSelection(
  providers: readonly SynapseAgentProvider[],
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

function selectionForProvider(
  provider: SynapseAgentProvider,
  modelTier: ModelTier,
): ProviderModelSelection {
  return {
    providerId: provider.id,
    providerName: provider.name,
    modelTier,
    modelName: resolveModelName(provider, modelTier),
  }
}

export {
  ProviderModelPicker,
  pickDefaultProviderModelTier,
  pickInitialProviderModelSelection,
  selectionForProvider,
}
export type { ProviderModelPickerProps }
