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
import {
  pickInitialProviderModelSelection,
  ProviderModelPicker,
} from "@/components/provider-model-picker"
import { createRendererLogger } from "@/app-shell/logging"
import { requireSynapseBridge } from "@/lib/electron-bridge"
import { track } from "@/lib/ui-tracking"
import { isProviderModelTierSelectable } from "@/lib/provider-model"
import type { SynapseAgentProvider } from "@/types/bridge"
import type { ProviderModelSelection } from "@/types/provider-model"

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
  readonly autoSelectFallback?: boolean
}

type ProviderModelSelectDialogConfirmInput = {
  readonly initialValue: string
  readonly placeholder?: string
  readonly ariaLabel: string
}

type ProviderModelSelectDialogSelectMeta = {
  readonly confirmInputValue?: string
}

const EMPTY_EXCLUDED_PROVIDERS: readonly string[] = []

function ProviderModelSelectDialog({
  open,
  onOpenChange,
  onSelect,
  defaultSelection,
  excludeProviderIds = EMPTY_EXCLUDED_PROVIDERS,
  confirmInput,
  autoSelectFallback = true,
}: ProviderModelSelectDialogProps) {
  const [providers, setProviders] = useState<SynapseAgentProvider[]>([])
  const [selection, setSelection] = useState<ProviderModelSelection | null>(null)
  const [loading, setLoading] = useState(false)
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [confirmInputValue, setConfirmInputValue] = useState(confirmInput?.initialValue ?? "")
  const confirmInputRef = useRef<HTMLInputElement>(null)
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
    setSelection(null)
    try {
      const nextProviders = await requireSynapseBridge().agent.listProviders()
      if (requestId !== requestIdRef.current) return
      setProviders(nextProviders)
      const visible = nextProviders.filter((p) =>
        !p.archived && !excludeProviderIds.includes(p.id))

      const defaultProvider = defaultSelection
        ? visible.find((p) => p.id === defaultSelection.providerId)
        : undefined
      const initialSelection = pickInitialProviderModelSelection(
        visible,
        defaultSelection,
        autoSelectFallback,
      )
      if (initialSelection) {
        setSelection(initialSelection)
      } else if (defaultProvider && defaultSelection) {
        setSelection({
          ...defaultSelection,
          providerName: defaultProvider.name,
        })
      }
    } catch (rawError) {
      if (requestId !== requestIdRef.current) return
      logger.warn("Agent provider list failed.", {
        boundary: "renderer.provider-model-select",
        errorName: rawError instanceof Error ? rawError.name : typeof rawError,
        errorLength: errorMessageLength(rawError),
      })
      setProviders([])
      setSelection(null)
      setError("读取 Provider 失败")
    } finally {
      if (requestId === requestIdRef.current) {
        setLoading(false)
      }
    }
  }, [autoSelectFallback, defaultSelection, excludeProviderIds])

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

  const selectedProvider = selection
    ? visibleProviders.find((provider) => provider.id === selection.providerId)
    : undefined
  const selectedTierAvailable = Boolean(
    selectedProvider
    && selection
    && isProviderModelTierSelectable(selectedProvider, selection.modelTier),
  )
  const confirmInputTrimmedValue = confirmInput ? confirmInputValue.trim() : undefined
  const confirmInputValid = !confirmInput || Boolean(confirmInputTrimmedValue)
  const canConfirm = selectedTierAvailable
    && confirmInputValid
    && !loading
    && !error
    && !saving

  const handleOpenAutoFocus = (event: Event) => {
    if (!confirmInput) return
    event.preventDefault()
    confirmInputRef.current?.focus()
  }

  const handleConfirm = useCallback(async () => {
    if (!selection || !canConfirm) return
    setSaving(true)
    track({
      component: "agent",
      name: "agent-provider-model-select",
      action: "submit",
      eventKey: "agent.provider-model.select",
      metadata: {
        boundary: "renderer.provider-model-select",
        providerId: selection.providerId,
        modelTier: selection.modelTier,
        providerCount: visibleProviders.length,
      },
    })
    try {
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
    selection,
    visibleProviders,
  ])

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent
        className="sm:max-w-xl"
        aria-describedby={undefined}
        onOpenAutoFocus={handleOpenAutoFocus}
      >
        <DialogHeader>
          <DialogTitle>选择供应商 + 模型</DialogTitle>
        </DialogHeader>
        <div className="flex flex-col gap-2">
          <ProviderModelPicker
            providers={providers}
            value={selection}
            loading={loading}
            error={error}
            disabled={saving}
            excludeProviderIds={excludeProviderIds}
            onRetry={() => void loadProviders()}
            onValueChange={setSelection}
          />
        </div>
        <DialogFooter>
          <Button type="button" variant="outline" onClick={() => onOpenChange(false)} disabled={saving}>
            取消
          </Button>
          {confirmInput ? (
            <Input
              ref={confirmInputRef}
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
