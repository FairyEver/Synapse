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
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table"
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
        error: rawError instanceof Error ? rawError.message : String(rawError),
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
        error: rawError instanceof Error ? rawError.message : String(rawError),
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
        error: rawError instanceof Error ? rawError.message : String(rawError),
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

        <div className="flex items-center justify-between gap-3">
          <div className="min-w-0 text-sm text-muted-foreground">
            {preview?.source?.path ?? "默认位置"}
          </div>
          <div className="flex shrink-0 items-center gap-2">
            <Button type="button" variant="outline" size="sm" disabled={loading || importing} onClick={() => loadPreview()}>
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
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead className="w-10" />
                <TableHead>名称</TableHead>
                <TableHead>模型</TableHead>
                <TableHead>状态</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {loading ? (
                <TableRow>
                  <TableCell colSpan={4} className="text-muted-foreground">
                    正在扫描
                  </TableCell>
                </TableRow>
              ) : !preview || preview.items.length === 0 ? (
                <TableRow>
                  <TableCell colSpan={4} className="text-muted-foreground">
                    未找到 Claude 配置
                  </TableCell>
                </TableRow>
              ) : preview.items.map((item) => (
                <TableRow key={item.id}>
                  <TableCell>
                    <Checkbox
                      aria-label={`导入 ${item.name}`}
                      checked={selectedIds.has(item.id)}
                      disabled={item.status !== "ready" || importing}
                      onCheckedChange={(checked) => toggleItem(item, checked === true)}
                    />
                  </TableCell>
                  <TableCell>
                    <div className="min-w-0">
                      <div className="truncate font-medium">{item.name}</div>
                      {item.baseUrl ? (
                        <div className="truncate text-xs text-muted-foreground">{item.baseUrl}</div>
                      ) : null}
                    </div>
                  </TableCell>
                  <TableCell>{item.model || "-"}</TableCell>
                  <TableCell>
                    <ImportStatusBadge item={item} />
                  </TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
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

function ImportStatusBadge({ item }: { readonly item: SynapseCcSwitchClaudeProviderPreviewItem }) {
  if (item.status === "ready") return <Badge variant="secondary">可导入</Badge>
  if (item.status === "duplicate") return <Badge variant="outline">已存在</Badge>
  return <Badge variant="destructive">缺少 Key</Badge>
}

export { CcSwitchImportDialog }
