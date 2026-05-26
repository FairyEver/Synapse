import { useEffect, useState } from "react"
import { Plus, Trash2 } from "lucide-react"
import { useAppNotifications } from "@/app-shell/notifications"
import { Button } from "@/components/ui/button"
import { Checkbox } from "@/components/ui/checkbox"
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog"
import { Input } from "@/components/ui/input"
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
import type { UsageModelPriceRule, UsageModelPriceRuleInput } from "../types"

interface PricingRulesDialogProps {
  readonly open: boolean
  readonly onOpenChange: (open: boolean) => void
  readonly onSaved?: () => void
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

export function PricingRulesDialog({ open, onOpenChange, onSaved }: PricingRulesDialogProps) {
  const { error: showError, success: showSuccess } = useAppNotifications()
  const [rows, setRows] = useState<EditablePriceRule[]>([])
  const [loading, setLoading] = useState(false)
  const [saving, setSaving] = useState(false)

  useEffect(() => {
    if (!open) return
    let active = true
    setLoading(true)
    requireSynapseBridge().usageAnalysis.getPricingRules()
      .then((rules) => {
        if (!active) return
        setRows(rules.map(toEditableRule))
      })
      .catch(() => {
        if (active) showError("读取失败")
      })
      .finally(() => {
        if (active) setLoading(false)
      })
    return () => {
      active = false
    }
  }, [open, showError])

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
      const saved = await requireSynapseBridge().usageAnalysis.savePricingRules(rows.map(toRuleInput))
      setRows(saved.map(toEditableRule))
      onSaved?.()
      showSuccess("已保存")
      onOpenChange(false)
    } catch {
      showError("保存失败")
    } finally {
      setSaving(false)
    }
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-5xl">
        <DialogHeader>
          <DialogTitle>价格规则</DialogTitle>
          <DialogDescription>人民币 / 1M token</DialogDescription>
        </DialogHeader>
        <div className="min-w-0 overflow-hidden">
          <ScrollArea className="h-96" viewportClassName="min-w-0">
            <Table>
              <TableHeader>
                <TableRow>
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
          </ScrollArea>
        </div>
        <DialogFooter>
          <Button type="button" variant="outline" onClick={addRow} disabled={loading || saving}>
            <Plus data-icon="inline-start" />
            添加
          </Button>
          <Button type="button" onClick={save} disabled={loading || saving}>
            {saving ? "保存中" : "保存"}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}

function toEditableRule(rule: UsageModelPriceRule): EditablePriceRule {
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

function toRuleInput(rule: EditablePriceRule): UsageModelPriceRuleInput {
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
