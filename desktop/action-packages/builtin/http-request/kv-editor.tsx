import { useCallback, useEffect, useRef, useState } from "react"
import { Button } from "../../../src/components/ui/button"
import { Input } from "../../../src/components/ui/input"
import { X } from "lucide-react"

interface KvEditorProps {
  readonly value: Record<string, string>
  readonly onChange: (value: Record<string, string>) => void
  readonly keyPlaceholder?: string
  readonly valuePlaceholder?: string
  readonly addButtonLabel?: string
  readonly emptyMessage?: string
}

interface KvRow {
  id: string
  key: string
  val: string
}

let rowIdCounter = 0
function nextRowId(): string {
  return `kv-${++rowIdCounter}`
}

function recordToRows(record: Record<string, string>): KvRow[] {
  return Object.entries(record).map(([key, val]) => ({ id: nextRowId(), key, val }))
}

function rowsToRecord(rows: KvRow[]): Record<string, string> {
  const result: Record<string, string> = {}
  for (const row of rows) {
    const k = row.key.trim()
    if (k) {
      result[k] = row.val
    }
  }
  return result
}

export function KvEditor({
  value,
  onChange,
  keyPlaceholder = "键",
  valuePlaceholder = "值",
  addButtonLabel = "+ 添加",
  emptyMessage = "暂无数据",
}: KvEditorProps) {
  const [rows, setRows] = useState<KvRow[]>(() => recordToRows(value))
  const lastEmittedJson = useRef(JSON.stringify(value))

  useEffect(() => {
    const incoming = JSON.stringify(value)
    if (incoming !== lastEmittedJson.current) {
      lastEmittedJson.current = incoming
      setRows(recordToRows(value))
    }
  }, [value])

  const commit = useCallback(
    (nextRows: KvRow[]) => {
      setRows(nextRows)
      const record = rowsToRecord(nextRows)
      lastEmittedJson.current = JSON.stringify(record)
      onChange(record)
    },
    [onChange],
  )

  const updateRow = (id: string, field: "key" | "val", fieldValue: string) => {
    const nextRows = rows.map((r) => (r.id === id ? { ...r, [field]: fieldValue } : r))
    commit(nextRows)
  }

  const removeRow = (id: string) => {
    const nextRows = rows.filter((r) => r.id !== id)
    commit(nextRows)
  }

  const addRow = () => {
    const nextRows = [...rows, { id: nextRowId(), key: "", val: "" }]
    setRows(nextRows)
  }

  if (rows.length === 0) {
    return (
      <div className="flex flex-col gap-2">
        <p className="text-xs text-muted-foreground">{emptyMessage}</p>
        <Button type="button" variant="link" size="sm" className="h-auto p-0 text-xs justify-start" onClick={addRow}>
          {addButtonLabel}
        </Button>
      </div>
    )
  }

  return (
    <div className="flex flex-col gap-1">
      {rows.map((row) => (
        <div key={row.id} className="flex items-center gap-1">
          <Input
            className="h-7 text-xs w-[100px] shrink-0"
            value={row.key}
            placeholder={keyPlaceholder}
            onChange={(e) => updateRow(row.id, "key", e.target.value)}
          />
          <Input
            className="h-7 text-xs flex-1 min-w-0"
            value={row.val}
            placeholder={valuePlaceholder}
            onChange={(e) => updateRow(row.id, "val", e.target.value)}
          />
          <Button
            type="button"
            variant="ghost"
            size="icon"
            className="size-6 shrink-0"
            onClick={() => removeRow(row.id)}
          >
            <X className="size-3" />
          </Button>
        </div>
      ))}
      <Button type="button" variant="link" size="sm" className="h-auto p-0 text-xs justify-start" onClick={addRow}>
        {addButtonLabel}
      </Button>
    </div>
  )
}
