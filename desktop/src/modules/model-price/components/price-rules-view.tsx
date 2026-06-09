import { useEffect, useState } from "react"
import { Plus, RotateCcw, Trash2 } from "lucide-react"
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
import type { ModelPriceRule, ModelPriceRuleInput, ModelPriceState } from "../types"

interface PriceRulesViewProps {
  readonly state: ModelPriceState<ModelPriceRule[]>
  readonly onSaved: () => void
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

export function PriceRulesView({ state, onSaved }: PriceRulesViewProps) {
  const { error: showError, success: showSuccess } = useAppNotifications()
  const [rows, setRows] = useState<EditablePriceRule[]>([])
  const [saving, setSaving] = useState(false)
  const [resetting, setResetting] = useState(false)

  useEffect(() => {
    if (!state.data) return
    setRows(state.data.map(toEditableRule))
  }, [state.data])

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

  const reset = async () => {
    setResetting(true)
    try {
      const resetRows = await requireSynapseBridge().modelPrice.resetRules()
      setRows(resetRows.map(toEditableRule))
      onSaved()
      showSuccess("已重置")
    } catch {
      showError("重置失败")
    } finally {
      setResetting(false)
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
          <AlertDialog>
            <AlertDialogTrigger asChild>
              <Button type="button" variant="outline" size="sm" disabled={saving || resetting}>
                <RotateCcw data-icon="inline-start" />
                重置
              </Button>
            </AlertDialogTrigger>
            <AlertDialogContent>
              <AlertDialogHeader>
                <AlertDialogTitle>恢复内置默认价格</AlertDialogTitle>
                <AlertDialogDescription>当前规则会被内置规则替换。</AlertDialogDescription>
              </AlertDialogHeader>
              <AlertDialogFooter>
                <AlertDialogCancel>取消</AlertDialogCancel>
                <AlertDialogAction onClick={() => void reset()} disabled={resetting}>
                  {resetting ? "重置中" : "确认重置"}
                </AlertDialogAction>
              </AlertDialogFooter>
            </AlertDialogContent>
          </AlertDialog>
          <Button type="button" variant="outline" size="sm" onClick={addRow} disabled={saving || resetting}>
            <Plus data-icon="inline-start" />
            添加
          </Button>
          <Button type="button" size="sm" onClick={() => void save()} disabled={saving || resetting}>
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
