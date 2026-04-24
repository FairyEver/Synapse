import { useCallback, useEffect, useMemo, useRef, useState } from "react"
import { Loader2, Plus, Trash2, Undo2 } from "lucide-react"
import { Badge } from "@/components/ui/badge"
import { Button } from "@/components/ui/button"
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog"
import { Input } from "@/components/ui/input"
import { cn } from "@/lib/utils"
import { createRendererLogger } from "@/app-shell/logging"
import { getColumnValueUsage } from "../hooks/use-data-store"

type EnumRowStatus = "existing" | "new" | "deleted"

type EnumRow = {
  value: string
  status: EnumRowStatus
}

type EnumValuesEditorDialogProps = {
  open: boolean
  onOpenChange: (open: boolean) => void
  table: string
  column: string
  columnType: "ENUM" | "MULTI_ENUM"
  initialValues: string[]
  onSave: (values: string[]) => Promise<void>
}

const logger = createRendererLogger("data-store.enum-editor")

function EnumValuesEditorDialog({
  open,
  onOpenChange,
  table,
  column,
  columnType,
  initialValues,
  onSave,
}: EnumValuesEditorDialogProps) {
  const [rows, setRows] = useState<EnumRow[]>([])
  const [inputValue, setInputValue] = useState("")
  const [usage, setUsage] = useState<Record<string, number>>({})
  const [usageLoading, setUsageLoading] = useState(false)
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState("")

  const initialValuesRef = useRef(initialValues)
  initialValuesRef.current = initialValues

  useEffect(() => {
    if (!open) return
    setRows(initialValuesRef.current.map((v) => ({ value: v, status: "existing" })))
    setInputValue("")
    setError("")
    setSaving(false)
    setUsage({})
    setUsageLoading(true)

    let cancelled = false
    getColumnValueUsage(table, column)
      .then((data) => {
        if (!cancelled) setUsage(data)
      })
      .catch((err) => {
        if (cancelled) return
        logger.warn("Failed to load enum value usage.", { err })
      })
      .finally(() => {
        if (!cancelled) setUsageLoading(false)
      })

    return () => {
      cancelled = true
    }
  }, [open, table, column])

  const finalValues = useMemo(
    () => rows.filter((r) => r.status !== "deleted").map((r) => r.value),
    [rows],
  )

  const handleAdd = useCallback(() => {
    const v = inputValue.trim()
    if (!v) return
    setError("")

    const existing = rows.find((r) => r.value === v)
    if (existing) {
      if (existing.status === "deleted") {
        setRows((prev) => prev.map((r) => (r.value === v ? { ...r, status: "existing" } : r)))
        setInputValue("")
        return
      }
      setError(`"${v}" 已存在`)
      return
    }

    setRows((prev) => [...prev, { value: v, status: "new" }])
    setInputValue("")
  }, [inputValue, rows])

  const handleDelete = useCallback((value: string) => {
    setError("")
    setRows((prev) =>
      prev.flatMap((r) => {
        if (r.value !== value) return [r]
        if (r.status === "new") return []
        return [{ ...r, status: "deleted" }]
      }),
    )
  }, [])

  const handleUndoDelete = useCallback((value: string) => {
    setError("")
    setRows((prev) => prev.map((r) => (r.value === value ? { ...r, status: "existing" } : r)))
  }, [])

  const handleSave = useCallback(async () => {
    if (finalValues.length === 0) {
      setError("至少需要保留一个选项")
      return
    }
    setSaving(true)
    setError("")
    try {
      await onSave(finalValues)
      onOpenChange(false)
    } catch {
      // Parent already shows an error toast via useAppNotifications.promise.
      // Keep the dialog open so the user can adjust and retry.
    } finally {
      setSaving(false)
    }
  }, [finalValues, onSave, onOpenChange])

  const handleOpenChange = useCallback(
    (next: boolean) => {
      if (saving) return
      onOpenChange(next)
    },
    [saving, onOpenChange],
  )

  return (
    <Dialog open={open} onOpenChange={handleOpenChange}>
      <DialogContent className="max-w-md">
        <DialogHeader>
          <DialogTitle>编辑枚举选项 · {column}</DialogTitle>
          <DialogDescription>
            {columnType === "MULTI_ENUM"
              ? "此列为多选，用户可选择多个值。"
              : "此列为单选，用户只能选择一个值。"}
          </DialogDescription>
        </DialogHeader>

        <div className="flex flex-col gap-3">
          <div className="flex max-h-72 flex-col overflow-y-auto rounded-md border">
            {rows.length === 0 ? (
              <div className="px-3 py-6 text-center text-xs text-muted-foreground">
                还没有选项，添加一个开始。
              </div>
            ) : (
              rows.map((row) => {
                const used = usage[row.value] ?? 0
                const deleted = row.status === "deleted"
                const isNew = row.status === "new"
                return (
                  <div
                    key={row.value}
                    className={cn(
                      "flex items-center gap-2 border-b px-3 py-2 text-sm last:border-b-0",
                      deleted && "bg-destructive/5",
                    )}
                  >
                    <span
                      className={cn(
                        "flex-1 truncate font-mono text-xs",
                        deleted && "text-muted-foreground line-through",
                      )}
                    >
                      {row.value}
                    </span>
                    {isNew ? (
                      <Badge variant="outline" className="shrink-0">新</Badge>
                    ) : null}
                    {deleted ? (
                      <Badge variant="destructive" className="shrink-0">待删除</Badge>
                    ) : null}
                    <span className="w-20 shrink-0 text-right text-xs text-muted-foreground">
                      {isNew
                        ? "—"
                        : usageLoading
                        ? "…"
                        : used > 0
                        ? `${used} 行使用`
                        : "未使用"}
                    </span>
                    {deleted ? (
                      <Button
                        size="icon"
                        variant="ghost"
                        className="size-7 shrink-0"
                        onClick={() => handleUndoDelete(row.value)}
                        title="撤销删除"
                      >
                        <Undo2 className="size-3.5" />
                      </Button>
                    ) : (
                      <Button
                        size="icon"
                        variant="ghost"
                        className="size-7 shrink-0 text-muted-foreground hover:text-destructive"
                        onClick={() => handleDelete(row.value)}
                        title={
                          used > 0
                            ? "删除此值。保存时后端会拒绝删除仍被使用的值"
                            : "删除此值"
                        }
                      >
                        <Trash2 className="size-3.5" />
                      </Button>
                    )}
                  </div>
                )
              })
            )}
          </div>

          <div className="flex items-center gap-2">
            <Input
              value={inputValue}
              onChange={(e) => setInputValue(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === "Enter") {
                  e.preventDefault()
                  handleAdd()
                }
              }}
              placeholder="添加新选项"
              disabled={saving}
            />
            <Button
              type="button"
              variant="outline"
              size="sm"
              onClick={handleAdd}
              disabled={!inputValue.trim() || saving}
            >
              <Plus className="size-3.5" />
              添加
            </Button>
          </div>

          {error ? <p className="text-xs text-destructive">{error}</p> : null}

          <p className="text-xs text-muted-foreground">
            删除正被使用的值会被拒绝。需要先改完相关行的数据再保存。
          </p>
        </div>

        <DialogFooter>
          <Button
            variant="outline"
            onClick={() => handleOpenChange(false)}
            disabled={saving}
          >
            取消
          </Button>
          <Button onClick={handleSave} disabled={saving || finalValues.length === 0}>
            {saving ? <Loader2 className="size-3.5 animate-spin" /> : null}
            保存
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}

export { EnumValuesEditorDialog }
