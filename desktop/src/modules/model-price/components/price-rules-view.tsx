import { useEffect, useRef, useState } from "react"
import { Plus, Trash2 } from "lucide-react"
import { useAppNotifications } from "@/app-shell/notifications"
import { startTrackedOperation } from "@/lib/ui-tracking"
import { ModuleContentPanel } from "@/components/module-page"
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
  AlertDialogTrigger,
} from "@/components/ui/alert-dialog"
import { Button } from "@/components/ui/button"
import { Checkbox } from "@/components/ui/checkbox"
import {
  Dialog,
  DialogContent,
  DialogFooter,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from "@/components/ui/dialog"
import { Empty, EmptyDescription, EmptyHeader, EmptyTitle } from "@/components/ui/empty"
import { Input } from "@/components/ui/input"
import { Skeleton } from "@/components/ui/skeleton"
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
  ModelPricePresetId,
  ModelPricePresetSummary,
  ModelPriceRule,
  ModelPriceRuleInput,
  ModelPriceState,
} from "../types"

interface PriceRulesViewProps {
  readonly state: ModelPriceState<ModelPriceRule[]>
  readonly presetState: ModelPriceState<ModelPricePresetSummary[]>
  readonly onSaved: () => void
  readonly onBusyChange?: (busy: boolean) => void
}

interface EditablePriceRule {
  readonly clientId: string
  readonly id?: string
  readonly modelPattern: string
  readonly inputPer1M: string
  readonly outputPer1M: string
  readonly cacheReadPer1M: string
  readonly cacheWritePer1M: string
  readonly reasoningPer1M: string
  readonly enabled: boolean
}

type PriceField = Exclude<keyof EditablePriceRule, "clientId" | "id" | "enabled">

const PRICE_COLUMNS: { readonly key: PriceField; readonly label: string }[] = [
  { key: "modelPattern", label: "模型匹配" },
  { key: "inputPer1M", label: "输入" },
  { key: "outputPer1M", label: "输出" },
  { key: "cacheReadPer1M", label: "缓存读" },
  { key: "cacheWritePer1M", label: "缓存写" },
  { key: "reasoningPer1M", label: "推理" },
]

export function PriceRulesView({ state, presetState, onSaved, onBusyChange }: PriceRulesViewProps) {
  const { error: showError, success: showSuccess } = useAppNotifications()
  const rootRef = useRef<HTMLDivElement>(null)
  const addButtonRef = useRef<HTMLButtonElement>(null)
  const [rows, setRows] = useState<EditablePriceRule[]>([])
  const [saving, setSaving] = useState(false)
  const [focusErrorMessage, setFocusErrorMessage] = useState<string | null>(null)
  const [clearing, setClearing] = useState(false)
  const [importing, setImporting] = useState(false)
  const [importDialogOpen, setImportDialogOpen] = useState(false)
  const [selectedPresetIds, setSelectedPresetIds] = useState<ModelPricePresetId[]>([])
  const busy = saving || clearing || importing

  useEffect(() => {
    onBusyChange?.(busy)
    return () => {
      if (busy) onBusyChange?.(false)
    }
  }, [busy, onBusyChange])

  useEffect(() => {
    if (!state.data) return
    setRows(state.data.map(toEditableRule))
  }, [state.data])

  useEffect(() => {
    if (!importDialogOpen) return
    const presets = presetState.data
    if (!presets?.length) {
      setSelectedPresetIds([])
      return
    }
    setSelectedPresetIds((current) => {
      const validIds = current.filter((presetId) => presets.some((preset) => preset.id === presetId))
      return validIds.length > 0 ? validIds : [presets[0].id]
    })
  }, [importDialogOpen, presetState.data])

  useEffect(() => {
    if (saving || !focusErrorMessage) return
    focusInvalidRuleField(rootRef.current, focusErrorMessage)
    setFocusErrorMessage(null)
  }, [focusErrorMessage, saving])

  const togglePresetSelection = (presetId: ModelPricePresetId, checked: boolean) => {
    setSelectedPresetIds((current) => {
      if (checked) {
        return current.includes(presetId) ? current : [...current, presetId]
      }
      return current.filter((candidate) => candidate !== presetId)
    })
  }

  const updateRow = (clientId: string, field: PriceField, value: string) => {
    setRows((current) => current.map((row) => (
      row.clientId === clientId ? { ...row, [field]: value } : row
    )))
  }

  const updateEnabled = (clientId: string, enabled: boolean) => {
    setRows((current) => current.map((row) => (
      row.clientId === clientId ? { ...row, enabled } : row
    )))
  }

  const removeRow = (clientId: string) => {
    const removingOnlyRow = rows.length === 1
    setRows((current) => current.filter((row) => row.clientId !== clientId))
    if (removingOnlyRow) {
      setTimeout(() => addButtonRef.current?.focus(), 0)
    }
  }

  const addRow = () => {
    setRows((current) => [newEditableRule(), ...current])
  }

  const save = async () => {
    const finishTracking = startTrackedOperation({ component: "model-price", eventKey: "model-price.rule.save" })
    setSaving(true)
    try {
      const saved = await requireSynapseBridge().modelPrice.rule.save(rows.map(toRuleInput))
      setRows(saved.map(toEditableRule))
      onSaved()
      showSuccess("已保存")
      finishTracking("success")
    } catch (error) {
      finishTracking("failure")
      const message = error instanceof Error ? error.message : "保存失败"
      showError(message)
      setFocusErrorMessage(message)
    } finally {
      setSaving(false)
    }
  }

  const clear = async () => {
    const finishTracking = startTrackedOperation({ component: "model-price", eventKey: "model-price.rule.clear" })
    setClearing(true)
    try {
      const clearedRows = await requireSynapseBridge().modelPrice.rule.clear()
      setRows(clearedRows.map(toEditableRule))
      onSaved()
      showSuccess("已清空")
      finishTracking("success")
    } catch {
      finishTracking("failure")
      showError("清空失败")
    } finally {
      setClearing(false)
    }
  }

  const importPreset = async () => {
    if (selectedPresetIds.length === 0) return
    const finishTracking = startTrackedOperation({ component: "model-price", eventKey: "model-price.preset.import" })
    setImporting(true)
    try {
      const selectedIds = presetState.data
        ?.map((preset) => preset.id)
        .filter((presetId) => selectedPresetIds.includes(presetId)) ?? selectedPresetIds
      const importedRows = await requireSynapseBridge().modelPrice.preset.import(selectedIds)
      setRows(importedRows.map(toEditableRule))
      setImportDialogOpen(false)
      onSaved()
      showSuccess(selectedIds.length > 1 ? `已导入 ${selectedIds.length} 个预设` : "已导入预设")
      finishTracking("success")
    } catch {
      finishTracking("failure")
      showError("导入失败")
    } finally {
      setImporting(false)
    }
  }

  if (state.loading && !state.data) {
    return (
      <div className="space-y-2">
        {Array.from({ length: 8 }).map((_, index) => (
          <Skeleton key={index} className="h-9 w-full" />
        ))}
      </div>
    )
  }

  if (state.error) {
    return (
      <Empty>
        <EmptyHeader>
          <EmptyTitle>读取失败</EmptyTitle>
          <EmptyDescription>{state.error.message}</EmptyDescription>
        </EmptyHeader>
      </Empty>
    )
  }

  return (
    <div ref={rootRef} data-price-rules-root className="flex min-h-0 min-w-0 max-w-full flex-col gap-2 overflow-hidden">
      <div data-price-rules-toolbar className="grid shrink-0 grid-cols-1 gap-2 sm:grid-cols-[auto_minmax(0,1fr)] sm:items-center">
        <div className="text-sm text-muted-foreground">人民币 / 1M token</div>
        <div data-price-rules-actions className="flex min-w-0 max-w-full flex-wrap items-center gap-2 sm:justify-end">
          <Dialog open={importDialogOpen} onOpenChange={setImportDialogOpen}>
            <DialogTrigger asChild>
              <Button type="button" variant="outline" size="sm" disabled={busy}>
                导入预设
              </Button>
            </DialogTrigger>
            <DialogContent className="sm:max-w-md" aria-describedby={undefined}>
              <DialogHeader>
                <DialogTitle>导入预设</DialogTitle>
              </DialogHeader>
              <PresetList
                state={presetState}
                selectedPresetIds={selectedPresetIds}
                disabled={importing}
                onCheckedChange={togglePresetSelection}
              />
              <DialogFooter>
                <Button
                  type="button"
                  variant="outline"
                  onClick={() => setImportDialogOpen(false)}
                  disabled={importing}
                >
                  取消
                </Button>
                <Button
                  type="button"
                  onClick={() => void importPreset()}
                  disabled={importing || selectedPresetIds.length === 0 || presetState.loading || !!presetState.error}
                >
                  {importing ? "导入中" : "导入"}
                </Button>
              </DialogFooter>
            </DialogContent>
          </Dialog>
          <AlertDialog>
            <AlertDialogTrigger asChild>
              <Button type="button" variant="outline" size="sm" disabled={busy}>
                <Trash2 data-icon="inline-start" />
                清空
              </Button>
            </AlertDialogTrigger>
            <AlertDialogContent>
              <AlertDialogHeader>
                <AlertDialogTitle>清空价格规则</AlertDialogTitle>
                <AlertDialogDescription>当前规则会被删除。</AlertDialogDescription>
              </AlertDialogHeader>
              <AlertDialogFooter>
                <AlertDialogCancel>取消</AlertDialogCancel>
                <AlertDialogAction onClick={() => void clear()} disabled={clearing}>
                  {clearing ? "清空中" : "确认清空"}
                </AlertDialogAction>
              </AlertDialogFooter>
            </AlertDialogContent>
          </AlertDialog>
          <Button ref={addButtonRef} type="button" variant="outline" size="sm" onClick={addRow} disabled={busy}>
            <Plus data-icon="inline-start" />
            添加
          </Button>
          <Button type="button" size="sm" onClick={() => void save()} disabled={busy}>
            {saving ? "保存中" : "保存"}
          </Button>
        </div>
      </div>
      <ModuleContentPanel className="min-w-0 max-w-full overflow-hidden">
        <div data-price-rules-table-panel className="min-w-0 max-w-full overflow-hidden">
          <Table containerClassName="min-w-0 max-w-full" className="min-w-[60rem] table-fixed">
            <colgroup>
              <col className="w-20" />
              <col className="w-auto" />
              <col className="w-28" />
              <col className="w-28" />
              <col className="w-28" />
              <col className="w-28" />
              <col className="w-28" />
              <col className="w-20" />
            </colgroup>
            <TableHeader>
              <TableRow className="hover:bg-transparent">
                <TableHead>启用</TableHead>
                {PRICE_COLUMNS.map((column) => (
                  <TableHead key={column.key} className={column.key === "modelPattern" ? undefined : "text-right"}>{column.label}</TableHead>
                ))}
                <TableHead className="text-right">操作</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {rows.map((row) => (
                <TableRow key={row.clientId}>
                  <TableCell>
                    <Checkbox
                      checked={row.enabled}
                      disabled={busy}
                      aria-label="启用"
                      onCheckedChange={(checked) => updateEnabled(row.clientId, checked === true)}
                    />
                  </TableCell>
                  {PRICE_COLUMNS.map((column) => (
                    <TableCell key={column.key}>
                      <Input
                        value={row[column.key]}
                        type={column.key === "modelPattern" ? "text" : "number"}
                        min={column.key === "modelPattern" ? undefined : 0}
                        step={column.key === "modelPattern" ? undefined : "0.0001"}
                        aria-label={column.label}
                        className={column.key === "modelPattern" ? "min-w-48" : "min-w-24 text-right tabular-nums"}
                        disabled={busy}
                        onChange={(event) => updateRow(row.clientId, column.key, event.target.value)}
                      />
                    </TableCell>
                  ))}
                  <TableCell className="text-right">
                    <Button
                      type="button"
                      variant="ghost"
                      size="icon-sm"
                      aria-label="删除"
                      disabled={busy}
                      onClick={() => removeRow(row.clientId)}
                    >
                      <Trash2 />
                    </Button>
                  </TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        </div>
      </ModuleContentPanel>
    </div>
  )
}

function focusInvalidRuleField(root: HTMLDivElement | null, message: string): void {
  if (!root) return
  const rowNumber = Number(message.match(/第\s*(\d+)\s*行/)?.[1])
  if (!Number.isInteger(rowNumber) || rowNumber < 1) return
  const column = PRICE_COLUMNS.find(({ key, label }) => message.includes(key) || message.includes(label))
  if (!column) return
  root.querySelectorAll<HTMLInputElement>(`input[aria-label="${column.label}"]`)[rowNumber - 1]?.focus()
}

function toEditableRule(rule: ModelPriceRule): EditablePriceRule {
  return {
    clientId: rule.id,
    id: rule.id,
    modelPattern: rule.modelPattern,
    inputPer1M: formatPriceField(rule.inputPer1M),
    outputPer1M: formatPriceField(rule.outputPer1M),
    cacheReadPer1M: formatPriceField(rule.cacheReadPer1M),
    cacheWritePer1M: formatPriceField(rule.cacheWritePer1M),
    reasoningPer1M: formatPriceField(rule.reasoningPer1M),
    enabled: rule.enabled,
  }
}

function newEditableRule(): EditablePriceRule {
  return {
    clientId: `draft-${Date.now()}-${Math.random().toString(36).slice(2)}`,
    modelPattern: "",
    inputPer1M: "",
    outputPer1M: "",
    cacheReadPer1M: "",
    cacheWritePer1M: "",
    reasoningPer1M: "",
    enabled: true,
  }
}

function toRuleInput(rule: EditablePriceRule): ModelPriceRuleInput {
  return {
    id: rule.id,
    modelPattern: rule.modelPattern,
    inputPer1M: parsePriceField(rule.inputPer1M),
    outputPer1M: parsePriceField(rule.outputPer1M),
    cacheReadPer1M: parsePriceField(rule.cacheReadPer1M),
    cacheWritePer1M: parsePriceField(rule.cacheWritePer1M),
    reasoningPer1M: parsePriceField(rule.reasoningPer1M),
    currency: "CNY",
    enabled: rule.enabled,
  }
}

function formatPriceField(value: number): string {
  return value > 0 ? String(value) : ""
}

function parsePriceField(value: string): number {
  if (value.trim() === "") return 0
  const parsed = Number(value)
  return parsed
}

interface PresetListProps {
  readonly state: ModelPriceState<ModelPricePresetSummary[]>
  readonly selectedPresetIds: readonly ModelPricePresetId[]
  readonly disabled: boolean
  readonly onCheckedChange: (presetId: ModelPricePresetId, checked: boolean) => void
}

function PresetList({ state, selectedPresetIds, disabled, onCheckedChange }: PresetListProps) {
  if (state.loading && !state.data) {
    return <div className="py-4 text-sm text-muted-foreground">正在加载</div>
  }

  if (state.error) {
    return <div className="py-4 text-sm text-destructive">{state.error.message}</div>
  }

  if (!state.data?.length) {
    return <div className="py-4 text-sm text-muted-foreground">暂无预设</div>
  }

  return (
    <div className="overflow-hidden rounded-lg border">
      {state.data.map((preset) => (
        <label
          key={preset.id}
          htmlFor={`model-price-preset-${preset.id}`}
          className="flex w-full cursor-pointer items-center justify-between gap-3 border-b px-3 py-3 text-left last:border-b-0"
        >
          <div className="flex min-w-0 items-center gap-3">
            <Checkbox
              id={`model-price-preset-${preset.id}`}
              checked={selectedPresetIds.includes(preset.id)}
              disabled={disabled}
              aria-label={preset.label}
              onCheckedChange={(checked) => onCheckedChange(preset.id, checked === true)}
            />
            <span className="truncate font-medium">{preset.label}</span>
          </div>
          <span className="shrink-0 text-sm text-muted-foreground tabular-nums">{preset.ruleCount} 条</span>
        </label>
      ))}
    </div>
  )
}
