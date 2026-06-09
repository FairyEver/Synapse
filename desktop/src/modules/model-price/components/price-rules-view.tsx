import { useEffect, useState } from "react"
import { Plus, Trash2 } from "lucide-react"
import { useAppNotifications } from "@/app-shell/notifications"
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
import { RadioGroup, RadioGroupItem } from "@/components/ui/radio-group"
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
  const [rows, setRows] = useState<EditablePriceRule[]>([])
  const [saving, setSaving] = useState(false)
  const [clearing, setClearing] = useState(false)
  const [importing, setImporting] = useState(false)
  const [importDialogOpen, setImportDialogOpen] = useState(false)
  const [selectedPresetId, setSelectedPresetId] = useState<ModelPricePresetId | null>(null)
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
      setSelectedPresetId(null)
      return
    }
    setSelectedPresetId((current) => (
      current && presets.some((preset) => preset.id === current)
        ? current
        : presets[0].id
    ))
  }, [importDialogOpen, presetState.data])

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
    setRows((current) => current.filter((row) => row.clientId !== clientId))
  }

  const addRow = () => {
    setRows((current) => [...current, newEditableRule()])
  }

  const save = async () => {
    setSaving(true)
    try {
      const saved = await requireSynapseBridge().modelPrice.saveRules(rows.map(toRuleInput))
      setRows(saved.map(toEditableRule))
      onSaved()
      showSuccess("已保存")
    } catch {
      showError("保存失败")
    } finally {
      setSaving(false)
    }
  }

  const clear = async () => {
    setClearing(true)
    try {
      const clearedRows = await requireSynapseBridge().modelPrice.clearRules()
      setRows(clearedRows.map(toEditableRule))
      onSaved()
      showSuccess("已清空")
    } catch {
      showError("清空失败")
    } finally {
      setClearing(false)
    }
  }

  const importPreset = async () => {
    if (!selectedPresetId) return
    setImporting(true)
    try {
      const importedRows = await requireSynapseBridge().modelPrice.importPreset(selectedPresetId)
      setRows(importedRows.map(toEditableRule))
      setImportDialogOpen(false)
      onSaved()
      showSuccess("已导入预设")
    } catch {
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
    <div className="flex min-h-0 flex-col gap-2">
      <div className="flex shrink-0 items-center justify-between gap-2">
        <div className="text-sm text-muted-foreground">人民币 / 1M token</div>
        <div className="flex items-center gap-2">
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
                selectedPresetId={selectedPresetId}
                onSelect={setSelectedPresetId}
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
                  disabled={importing || !selectedPresetId || presetState.loading || !!presetState.error}
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
          <Button type="button" variant="outline" size="sm" onClick={addRow} disabled={busy}>
            <Plus data-icon="inline-start" />
            添加
          </Button>
          <Button type="button" size="sm" onClick={() => void save()} disabled={busy}>
            {saving ? "保存中" : "保存"}
          </Button>
        </div>
      </div>
      <ModuleContentPanel className="overflow-x-auto">
        <Table className="min-w-[60rem] table-fixed">
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
      </ModuleContentPanel>
    </div>
  )
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
  const parsed = Number(value)
  return Number.isFinite(parsed) && parsed > 0 ? parsed : 0
}

interface PresetListProps {
  readonly state: ModelPriceState<ModelPricePresetSummary[]>
  readonly selectedPresetId: ModelPricePresetId | null
  readonly onSelect: (presetId: ModelPricePresetId) => void
}

function PresetList({ state, selectedPresetId, onSelect }: PresetListProps) {
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
    <RadioGroup value={selectedPresetId ?? ""} onValueChange={(value) => onSelect(value as ModelPricePresetId)}>
      <div className="overflow-hidden rounded-lg border">
        {state.data.map((preset) => (
          <label
            key={preset.id}
            htmlFor={`model-price-preset-${preset.id}`}
            className="flex w-full cursor-pointer items-center justify-between gap-3 border-b px-3 py-3 text-left last:border-b-0"
          >
            <div className="flex min-w-0 items-center gap-3">
              <RadioGroupItem id={`model-price-preset-${preset.id}`} value={preset.id} aria-label={preset.label} />
              <span className="truncate font-medium">{preset.label}</span>
            </div>
            <span className="shrink-0 text-sm text-muted-foreground tabular-nums">{preset.ruleCount} 条</span>
          </label>
        ))}
      </div>
    </RadioGroup>
  )
}
