import { useCallback, useEffect, useMemo, useState } from "react"
import { FolderOpenIcon, RefreshCwIcon } from "lucide-react"
import { toast } from "sonner"

import { createRendererLogger } from "@/app-shell/logging"
import { Alert, AlertDescription } from "@/components/ui/alert"
import { Badge } from "@/components/ui/badge"
import { Button } from "@/components/ui/button"
import { Checkbox } from "@/components/ui/checkbox"
import {
  Dialog,
  DialogContent,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog"
import { ScrollArea } from "@/components/ui/scroll-area"
import { requireSynapseBridge } from "@/lib/electron-bridge"
import type {
  SynapseCcSwitchClaudeImportPreviewResult,
  SynapseCcSwitchClaudeProviderPreviewItem,
  SynapseCcSwitchImportSource,
} from "@/types/bridge"

type CcSwitchImportDialogProps = {
  readonly open: boolean
  readonly onOpenChange: (open: boolean) => void
  readonly onImported: () => void
}

const logger = createRendererLogger("settings.providers.cc-switch")

function CcSwitchImportDialog({
  open,
  onOpenChange,
  onImported,
}: CcSwitchImportDialogProps) {
  const [preview, setPreview] = useState<SynapseCcSwitchClaudeImportPreviewResult | null>(null)
  const [selectedIds, setSelectedIds] = useState<Set<string>>(new Set())
  const [loading, setLoading] = useState(false)
  const [importing, setImporting] = useState(false)
  const [error, setError] = useState<string | null>(null)

  const readyItems = useMemo(
    () => preview?.items.filter((item) => item.status === "ready") ?? [],
    [preview],
  )
  const selectedReadyCount = useMemo(
    () => readyItems.filter((item) => selectedIds.has(item.id)).length,
    [readyItems, selectedIds],
  )

  const loadPreview = useCallback(async (source?: SynapseCcSwitchImportSource) => {
    setLoading(true)
    setError(null)
    try {
      const result = await requireSynapseBridge().agent.previewCcSwitchClaudeProviders({ source })
      setPreview(result)
      setSelectedIds(new Set(result.items.filter((item) => item.selectedByDefault).map((item) => item.id)))
    } catch (rawError) {
      logger.error("CC Switch preview failed.", {
        boundary: "settings.providers.cc-switch.preview",
        action: "previewCcSwitchClaudeProviders",
        ...ccSwitchImportErrorDiagnostic(rawError),
      })
      setError("读取失败")
    } finally {
      setLoading(false)
    }
  }, [])

  useEffect(() => {
    if (!open) return
    setPreview(null)
    setSelectedIds(new Set())
    setError(null)
    void loadPreview()
  }, [loadPreview, open])

  const chooseSource = async () => {
    try {
      const result = await requireSynapseBridge().agent.chooseCcSwitchClaudeImportSource()
      if (!result.source) return
      await loadPreview(result.source)
    } catch (rawError) {
      logger.error("CC Switch source choose failed.", {
        boundary: "settings.providers.cc-switch.choose",
        action: "chooseCcSwitchClaudeImportSource",
        ...ccSwitchImportErrorDiagnostic(rawError),
      })
      toast("选择失败")
    }
  }

  const toggleItem = (item: SynapseCcSwitchClaudeProviderPreviewItem, checked: boolean) => {
    if (item.status !== "ready") return
    setSelectedIds((current) => {
      const next = new Set(current)
      if (checked) {
        next.add(item.id)
      } else {
        next.delete(item.id)
      }
      return next
    })
  }

  const importSelected = async () => {
    if (!preview?.source || selectedReadyCount === 0) return
    setImporting(true)
    try {
      const result = await requireSynapseBridge().agent.importCcSwitchClaudeProviders({
        source: preview.source,
        providerIds: [...selectedIds],
      })
      toast(`已导入 ${result.imported.length} 个 Provider`)
      onOpenChange(false)
      onImported()
    } catch (rawError) {
      logger.error("CC Switch import failed.", {
        boundary: "settings.providers.cc-switch.import",
        action: "importCcSwitchClaudeProviders",
        ...ccSwitchImportErrorDiagnostic(rawError),
      })
      toast("导入失败")
    } finally {
      setImporting(false)
    }
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-3xl" aria-describedby={undefined}>
        <DialogHeader>
          <DialogTitle>从 CCS 导入</DialogTitle>
        </DialogHeader>

        <div className="flex items-center justify-between gap-2">
          <div className="min-w-0 text-sm text-muted-foreground">
            {preview?.source?.path ?? "默认位置"}
          </div>
          <div className="flex shrink-0 items-center gap-2">
            <Button type="button" variant="outline" size="sm" disabled={loading || importing} onClick={() => loadPreview(preview?.source)}>
              <RefreshCwIcon data-icon="inline-start" />
              扫描
            </Button>
            <Button type="button" variant="outline" size="sm" disabled={loading || importing} onClick={chooseSource}>
              <FolderOpenIcon data-icon="inline-start" />
              选择配置
            </Button>
          </div>
        </div>

        {error ? (
          <Alert variant="destructive">
            <AlertDescription>{error}</AlertDescription>
          </Alert>
        ) : null}

        <ScrollArea className="max-h-96">
          <div className="flex flex-col gap-2 pr-3">
            {loading ? (
              <div className="rounded-lg bg-muted/40 px-3 py-3 text-sm text-muted-foreground">
                正在扫描
              </div>
            ) : !preview || preview.items.length === 0 ? (
              <div className="rounded-lg bg-muted/40 px-3 py-3 text-sm text-muted-foreground">
                未找到 Claude 配置
              </div>
            ) : preview.items.map((item) => (
              <CcSwitchProviderRow
                key={item.id}
                item={item}
                checked={selectedIds.has(item.id)}
                disabled={importing}
                onCheckedChange={(checked) => toggleItem(item, checked)}
              />
            ))}
          </div>
        </ScrollArea>

        <DialogFooter>
          <Button type="button" variant="outline" onClick={() => onOpenChange(false)}>
            取消
          </Button>
          <Button
            type="button"
            disabled={!preview?.source || selectedReadyCount === 0 || importing}
            onClick={importSelected}
          >
            {importing ? "导入中" : `导入 ${selectedReadyCount} 个`}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}

function CcSwitchProviderRow({
  item,
  checked,
  disabled,
  onCheckedChange,
}: {
  readonly item: SynapseCcSwitchClaudeProviderPreviewItem
  readonly checked: boolean
  readonly disabled: boolean
  readonly onCheckedChange: (checked: boolean) => void
}) {
  return (
    <div className="flex gap-2 rounded-lg bg-muted/40 px-3 py-3">
      <div className="flex pt-1">
        <Checkbox
          aria-label={`导入 ${item.name}`}
          checked={checked}
          disabled={item.status !== "ready" || disabled}
          onCheckedChange={(nextChecked) => onCheckedChange(nextChecked === true)}
        />
      </div>

      <div className="min-w-0 flex-1">
        <div className="flex items-start justify-between gap-2">
          <div className="min-w-0">
            <div className="truncate font-medium">{item.name}</div>
            <div className="truncate text-xs text-muted-foreground">{item.baseUrl || "-"}</div>
          </div>
          <ImportStatusBadge item={item} />
        </div>

        <div className="mt-3 grid gap-2 text-xs sm:grid-cols-[minmax(0,0.85fr)_minmax(0,1.15fr)]">
          <InfoLine label="Key 字段" value={item.apiKeyField} />
          <ModelMap item={item} />
        </div>
      </div>
    </div>
  )
}

function ModelMap({ item }: { readonly item: SynapseCcSwitchClaudeProviderPreviewItem }) {
  const entries = [
    ["主模型", item.model],
    ["Opus", item.opusModel],
    ["Sonnet", item.sonnetModel],
    ["Haiku", item.haikuModel],
  ] as const

  return (
    <div className="min-w-0">
      <div className="mb-1 text-muted-foreground">模型映射</div>
      <div className="grid gap-1 sm:grid-cols-2">
        {entries.map(([label, value]) => (
          <InfoLine key={label} label={label} value={value || "-"} />
        ))}
      </div>
    </div>
  )
}

function InfoLine({ label, value }: { readonly label: string; readonly value: string }) {
  return (
    <div className="min-w-0">
      <span className="text-muted-foreground">{label}</span>
      <span className="mx-1 text-muted-foreground">·</span>
      <span className="break-all font-medium">{value}</span>
    </div>
  )
}

function ImportStatusBadge({ item }: { readonly item: SynapseCcSwitchClaudeProviderPreviewItem }) {
  if (item.status === "ready") return <Badge variant="secondary">可导入</Badge>
  if (item.status === "duplicate") return <Badge variant="outline">已存在</Badge>
  return <Badge variant="destructive">缺少 Key</Badge>
}

function ccSwitchImportErrorDiagnostic(error: unknown): { readonly errorName: string; readonly errorLength: number } {
  const message = error instanceof Error
    ? error.message
    : typeof error === "string"
      ? error
      : String(error)
  return {
    errorName: error instanceof Error ? error.name : typeof error,
    errorLength: message.length,
  }
}

export { CcSwitchImportDialog }
