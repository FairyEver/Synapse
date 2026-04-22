import { useCallback, useState } from "react"
import { Check, X } from "lucide-react"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { TableCell, TableRow } from "@/components/ui/table"
import type { DataStoreColumnInfo } from "@/types/data-store"

type RowEditorProps = {
  columns: DataStoreColumnInfo[]
  initialData?: Record<string, unknown>
  onSave: (data: Record<string, unknown>) => void
  onCancel: () => void
}

function RowEditor({ columns, initialData, onSave, onCancel }: RowEditorProps) {
  const editableColumns = columns.filter((c) => !c.primaryKey)
  const [values, setValues] = useState<Record<string, string>>(() => {
    const init: Record<string, string> = {}
    for (const col of editableColumns) {
      const val = initialData?.[col.name]
      init[col.name] = val != null ? String(val) : ""
    }
    return init
  })

  const handleChange = useCallback((colName: string, value: string) => {
    setValues((prev) => ({ ...prev, [colName]: value }))
  }, [])

  const handleSave = useCallback(() => {
    const data: Record<string, unknown> = {}
    for (const col of editableColumns) {
      const raw = values[col.name] ?? ""
      if (col.type === "INTEGER") {
        data[col.name] = raw ? parseInt(raw, 10) : null
      } else if (col.type === "REAL") {
        data[col.name] = raw ? parseFloat(raw) : null
      } else if (col.type === "JSON") {
        try {
          data[col.name] = raw ? JSON.parse(raw) : null
        } catch {
          data[col.name] = raw
        }
      } else {
        data[col.name] = raw || null
      }
    }
    onSave(data)
  }, [editableColumns, values, onSave])

  return (
    <TableRow>
      <TableCell className="text-muted-foreground">
        {initialData?.id != null ? String(initialData.id) : ""}
      </TableCell>
      {editableColumns.map((col) => (
        <TableCell key={col.name} className="py-1">
          <Input
            className="h-6 px-2 text-xs"
            value={values[col.name] ?? ""}
            onChange={(e) => handleChange(col.name, e.target.value)}
          />
        </TableCell>
      ))}
      <TableCell className="py-1">
        <div className="flex items-center gap-0.5">
          <Button variant="ghost" size="icon" className="size-6" onClick={handleSave}>
            <Check className="size-3.5" />
          </Button>
          <Button variant="ghost" size="icon" className="size-6" onClick={onCancel}>
            <X className="size-3.5" />
          </Button>
        </div>
      </TableCell>
    </TableRow>
  )
}

export { RowEditor }
