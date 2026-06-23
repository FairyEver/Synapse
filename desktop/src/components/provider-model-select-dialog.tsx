import { useCallback, useEffect, useMemo, useRef, useState } from "react"
import { Button } from "@/components/ui/button"
import {
  Dialog,
  DialogContent,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog"
import { Input } from "@/components/ui/input"
import { RadioGroup, RadioGroupItem } from "@/components/ui/radio-group"
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table"
import { createRendererLogger } from "@/app-shell/logging"
import { requireSynapseBridge } from "@/lib/electron-bridge"
import { track } from "@/lib/ui-tracking"
import {
  isProviderModelTierSelectable,
  resolveModelDisplayName,
  resolveModelName,
} from "@/lib/provider-model"
import type { SynapseAgentProvider } from "@/types/bridge"
import type { ModelTier, ProviderModelSelection } from "@/types/provider-model"
import { cn } from "@/lib/utils"

const logger = createRendererLogger("agent")

type ProviderModelSelectDialogProps = {
  readonly open: boolean
  readonly onOpenChange: (open: boolean) => void
  readonly onSelect: (
    selection: ProviderModelSelection,
    meta?: ProviderModelSelectDialogSelectMeta,
  ) => void | Promise<void>
  readonly defaultSelection?: ProviderModelSelection
  readonly excludeProviderIds?: readonly string[]
  readonly confirmInput?: ProviderModelSelectDialogConfirmInput
}

type ProviderModelSelectDialogConfirmInput = {
  readonly initialValue: string
  readonly placeholder?: string
  readonly ariaLabel: string
}

type ProviderModelSelectDialogSelectMeta = {
  readonly confirmInputValue?: string
}

const TIER_CONFIG: ReadonlyArray<{ tier: ModelTier; label: string }> = [
  { tier: "default", label: "主模型" },
  { tier: "opus", label: "Opus" },
  { tier: "sonnet", label: "Sonnet" },
  { tier: "haiku", label: "Haiku" },
]

const EMPTY_EXCLUDED_PROVIDERS: readonly string[] = []

function availableTiers(provider: SynapseAgentProvider) {
  return TIER_CONFIG.flatMap((c) => isProviderModelTierSelectable(provider, c.tier) ? [c] : [])
}

function ProviderModelSelectDialog({
  open,
  onOpenChange,
  onSelect,
  defaultSelection,
  excludeProviderIds = EMPTY_EXCLUDED_PROVIDERS,
  confirmInput,
}: ProviderModelSelectDialogProps) {
  const [providers, setProviders] = useState<SynapseAgentProvider[]>([])
  const [selectedProviderId, setSelectedProviderId] = useState<string | undefined>(undefined)
  const [selectedTier, setSelectedTier] = useState<ModelTier | undefined>(undefined)
  const [loading, setLoading] = useState(false)
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [confirmInputValue, setConfirmInputValue] = useState(confirmInput?.initialValue ?? "")
  const requestIdRef = useRef(0)

  const visibleProviders = useMemo(
    () => providers.filter((provider) =>
      !provider.archived && !excludeProviderIds.includes(provider.id)),
    [excludeProviderIds, providers],
  )

  const loadProviders = useCallback(async () => {
    const requestId = requestIdRef.current + 1
    requestIdRef.current = requestId
    setLoading(true)
    setError(null)
    setProviders([])
    setSelectedProviderId(undefined)
    setSelectedTier(undefined)
    try {
      const nextProviders = await requireSynapseBridge().agent.listProviders()
      if (requestId !== requestIdRef.current) return
      setProviders(nextProviders)
      const visible = nextProviders.filter((p) =>
        !p.archived && !excludeProviderIds.includes(p.id))

      const defaultProvider = defaultSelection
        ? visible.find((p) => p.id === defaultSelection.providerId)
        : undefined
      const activeProvider = visible.find((p) => p.active)
      const preselectedProvider = defaultProvider ?? activeProvider ?? visible[0]

      if (preselectedProvider) {
        setSelectedProviderId(preselectedProvider.id)
        if (defaultSelection && defaultProvider) {
          const defaultTierAvailable = isProviderModelTierSelectable(defaultProvider, defaultSelection.modelTier)
          if (defaultTierAvailable) {
            setSelectedTier(defaultSelection.modelTier)
          } else {
            setSelectedTier(pickDefaultTier(preselectedProvider))
          }
        } else {
          setSelectedTier(pickDefaultTier(preselectedProvider))
        }
      }
    } catch (rawError) {
      if (requestId !== requestIdRef.current) return
      logger.warn("Agent provider list failed.", {
        boundary: "renderer.provider-model-select",
        errorName: rawError instanceof Error ? rawError.name : typeof rawError,
        errorLength: errorMessageLength(rawError),
      })
      setProviders([])
      setSelectedProviderId(undefined)
      setSelectedTier(undefined)
      setError("读取 Provider 失败")
    } finally {
      if (requestId === requestIdRef.current) {
        setLoading(false)
      }
    }
  }, [defaultSelection, excludeProviderIds])

  useEffect(() => {
    if (!open) {
      requestIdRef.current += 1
      return
    }
    void loadProviders()
  }, [loadProviders, open])

  useEffect(() => {
    if (!open) return
    setConfirmInputValue(confirmInput?.initialValue ?? "")
  }, [confirmInput?.initialValue, open])

  const selectedProviderAvailable = Boolean(
    selectedProviderId && visibleProviders.some((p) => p.id === selectedProviderId),
  )
  const confirmInputTrimmedValue = confirmInput ? confirmInputValue.trim() : undefined
  const confirmInputValid = !confirmInput || Boolean(confirmInputTrimmedValue)
  const canConfirm = selectedProviderAvailable
    && selectedTier !== undefined
    && confirmInputValid
    && !loading
    && !error
    && !saving

  const handleSelectProvider = (providerId: string) => {
    setSelectedProviderId(providerId)
    const provider = visibleProviders.find((p) => p.id === providerId)
    if (provider) {
      if (selectedTier && isProviderModelTierSelectable(provider, selectedTier)) {
        return
      }
      setSelectedTier(pickDefaultTier(provider))
    }
  }

  const handleSelectTier = (providerId: string, tier: ModelTier) => {
    setSelectedProviderId(providerId)
    setSelectedTier(tier)
  }

  const handleConfirm = useCallback(async () => {
    if (!selectedProviderId || !selectedTier || !canConfirm) return
    setSaving(true)
    track({
      component: "agent",
      name: "agent-provider-model-select",
      action: "submit",
      metadata: {
        boundary: "renderer.provider-model-select",
        providerId: selectedProviderId,
        modelTier: selectedTier,
        providerCount: visibleProviders.length,
      },
    })
    const provider = visibleProviders.find((p) => p.id === selectedProviderId)
    const providerName = provider?.name
    const modelName = provider ? resolveModelName(provider, selectedTier) : undefined
    try {
      const selection = { providerId: selectedProviderId, modelTier: selectedTier, providerName, modelName }
      if (confirmInput) {
        await onSelect(selection, { confirmInputValue: confirmInputTrimmedValue })
      } else {
        await onSelect(selection)
      }
      onOpenChange(false)
    } catch {
      // Save failed — dialog stays open, selection preserved
    } finally {
      setSaving(false)
    }
  }, [
    canConfirm,
    confirmInput,
    confirmInputTrimmedValue,
    onOpenChange,
    onSelect,
    selectedProviderId,
    selectedTier,
    visibleProviders,
  ])

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-lg" aria-describedby={undefined}>
        <DialogHeader>
          <DialogTitle>选择供应商 + 模型</DialogTitle>
        </DialogHeader>
        <div className="flex flex-col gap-2">
          {error ? (
            <div className="flex items-center gap-2">
              <p className="text-sm text-destructive">{error}</p>
              <Button type="button" variant="outline" size="sm" onClick={() => void loadProviders()}>
                重试
              </Button>
            </div>
          ) : (
            <RadioGroup value={selectedProviderId ?? ""} onValueChange={handleSelectProvider}>
              <Table className="table-fixed">
                <TableHeader>
                  <TableRow>
                    <TableHead className="w-6" />
                    <TableHead className="w-40 pl-1">名称</TableHead>
                    <TableHead>模型</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {loading ? (
                    <TableRow>
                      <TableCell colSpan={3} className="text-muted-foreground">
                        正在加载
                      </TableCell>
                    </TableRow>
                  ) : visibleProviders.length === 0 ? (
                    <TableRow>
                      <TableCell colSpan={3} className="text-muted-foreground">
                        暂无 Provider
                      </TableCell>
                    </TableRow>
                  ) : visibleProviders.map((provider) => {
                    const selected = provider.id === selectedProviderId
                    const tiers = availableTiers(provider)
                    return (
                      <TableRow
                        key={provider.id}
                        data-state={selected ? "selected" : undefined}
                        className="cursor-pointer"
                        onClick={() => handleSelectProvider(provider.id)}
                      >
                        <TableCell className="w-6 py-2 pr-1 pl-2">
                          <RadioGroupItem value={provider.id} />
                        </TableCell>
                        <TableCell className="min-w-0 pl-1">
                          <span className="block truncate font-medium">{provider.name}</span>
                        </TableCell>
                        <TableCell className="min-w-0">
                          <div className="flex flex-col">
                            {tiers.map((tierConfig) => {
                              const modelDisplayName = resolveModelDisplayName(provider, tierConfig.tier)
                              const isTierSelected = selected && selectedTier === tierConfig.tier
                              return (
                                <button
                                  key={tierConfig.tier}
                                  data-tier={tierConfig.tier}
                                  type="button"
                                  className={cn(
                                    "w-full truncate rounded px-2 py-1 text-left text-sm",
                                    selected
                                      ? isTierSelected
                                        ? "bg-foreground font-medium text-background"
                                        : "text-foreground hover:bg-muted/50"
                                      : "text-muted-foreground hover:bg-muted/50",
                                  )}
                                  onClick={(e) => {
                                    e.stopPropagation()
                                    handleSelectTier(provider.id, tierConfig.tier)
                                  }}
                                >
                                  {modelDisplayName ? `${tierConfig.label} (${modelDisplayName})` : tierConfig.label}
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
          )}
        </div>
        <DialogFooter>
          <Button type="button" variant="outline" onClick={() => onOpenChange(false)} disabled={saving}>
            取消
          </Button>
          {confirmInput ? (
            <Input
              aria-label={confirmInput.ariaLabel}
              value={confirmInputValue}
              placeholder={confirmInput.placeholder}
              disabled={saving}
              onChange={(event) => setConfirmInputValue(event.target.value)}
              onKeyDown={(event) => {
                if (event.key !== "Enter" || event.nativeEvent.isComposing) return
                event.preventDefault()
                void handleConfirm()
              }}
            />
          ) : null}
          <Button
            type="button"
            disabled={!canConfirm}
            onClick={handleConfirm}
          >
            {saving ? "正在保存..." : "确认"}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}

function pickDefaultTier(provider: SynapseAgentProvider): ModelTier | undefined {
  if (isProviderModelTierSelectable(provider, "sonnet")) return "sonnet"
  const tiers = availableTiers(provider)
  return tiers[0]?.tier
}

function errorMessageLength(error: unknown): number {
  if (error instanceof Error) return error.message.length
  return String(error).length
}

export { ProviderModelSelectDialog }
export type {
  ProviderModelSelectDialogConfirmInput,
  ProviderModelSelectDialogProps,
  ProviderModelSelectDialogSelectMeta,
}
