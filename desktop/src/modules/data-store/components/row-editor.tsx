import {
  forwardRef,
  useCallback,
  useEffect,
  useImperativeHandle,
  useMemo,
  useRef,
  useState,
} from "react"
import { Check, X } from "lucide-react"
import { Button } from "@/components/ui/button"
import { TableCell, TableRow } from "@/components/ui/table"
import type { DataStoreColumnInfo } from "@/types/data-store"
import { DataTableCellEnum } from "./data-table-cell-enum"
import { DataTableCellInput } from "./data-table-cell-input"
import {
  DATA_TABLE_COLUMN_CLASS,
  DATA_TABLE_STICKY_ACTION_COLUMN_CLASS,
  formatCellValue,
} from "./data-table-layout"

type RowEditorProps = {
  columns: DataStoreColumnInfo[]
  initialData?: Record<string, unknown>
  initialFocusColumnName?: string | null
  onSave: (data: Record<string, unknown>) => Promise<void> | void
  onCancel: () => void
}

type RowEditorHandle = {
  save: () => Promise<void>
}

const ROW_EDITOR_EDITABLE_CELL_CLASS = `${DATA_TABLE_COLUMN_CLASS} bg-foreground/5 focus-within:bg-foreground/10 has-[[data-state=open]]:bg-foreground/10`

const RowEditor = forwardRef<RowEditorHandle, RowEditorProps>(function RowEditor(
  {
    columns,
    initialData,
    initialFocusColumnName,
    onSave,
    onCancel,
  },
  ref,
) {
  const editableColumns = useMemo(() => columns.filter((c) => !c.primaryKey && !c.system), [columns])
  const systemTimeColumns = useMemo(() => columns.filter((c) => c.system && !c.primaryKey), [columns])
  const initialValues = useMemo(() => {
    const init: Record<string, string> = {}
    for (const col of editableColumns) {
      const val = initialData?.[col.name]
      if (col.type.toUpperCase() === "MULTI_ENUM" && Array.isArray(val)) {
        init[col.name] = JSON.stringify(val)
      } else {
        init[col.name] = val != null ? String(val) : ""
      }
    }
    return init
  }, [editableColumns, initialData])
  const inputRefs = useRef<Record<string, HTMLInputElement | null>>({})
  const activeColumnNameRef = useRef<string | null>(initialFocusColumnName ?? editableColumns[0]?.name ?? null)
  const savePromiseRef = useRef<Promise<void> | null>(null)
  const [isSaving, setIsSaving] = useState(false)
  const [values, setValues] = useState<Record<string, string>>(() => initialValues)
  const isDirty = useMemo(
    () => editableColumns.some((col) => (values[col.name] ?? "") !== (initialValues[col.name] ?? "")),
    [editableColumns, initialValues, values],
  )

  const handleChange = useCallback((colName: string, value: string) => {
    setValues((prev) => ({ ...prev, [colName]: value }))
  }, [])

  const handleCancel = useCallback(() => {
    if (isSaving) {
      return
    }

    onCancel()
  }, [isSaving, onCancel])

  const handleSave = useCallback(() => {
    if (savePromiseRef.current) {
      return savePromiseRef.current
    }

    if (!isDirty) {
      onCancel()
      return Promise.resolve()
    }

    const data: Record<string, unknown> = {}
    for (const col of editableColumns) {
      const raw = values[col.name] ?? ""
      const upper = col.type.toUpperCase()
      if (upper === "INTEGER") {
        data[col.name] = raw ? parseInt(raw, 10) : null
      } else if (upper === "REAL") {
        data[col.name] = raw ? parseFloat(raw) : null
      } else if (upper === "JSON") {
        try {
          data[col.name] = raw ? JSON.parse(raw) : null
        } catch {
          data[col.name] = raw
        }
      } else if (upper === "BOOLEAN") {
        if (raw === "true") data[col.name] = true
        else if (raw === "false") data[col.name] = false
        else data[col.name] = null
      } else if (upper === "MULTI_ENUM") {
        try {
          const parsed = raw ? JSON.parse(raw) : []
          data[col.name] = Array.isArray(parsed) ? parsed : []
        } catch {
          data[col.name] = []
        }
      } else {
        data[col.name] = raw || null
      }
    }

    setIsSaving(true)
    const savePromise = Promise.resolve(onSave(data))
      .catch((error) => {
        const targetColumnName = activeColumnNameRef.current ?? initialFocusColumnName ?? editableColumns[0]?.name ?? null
        const input = targetColumnName ? inputRefs.current[targetColumnName] : null
        input?.focus()
        input?.select()
        throw error
      })
      .finally(() => {
        savePromiseRef.current = null
        setIsSaving(false)
      })
    savePromiseRef.current = savePromise
    return savePromise
  }, [editableColumns, initialFocusColumnName, isDirty, onCancel, onSave, values])

  useImperativeHandle(ref, () => ({ save: handleSave }), [handleSave])

  useEffect(() => {
    const targetColumnName = initialFocusColumnName ?? editableColumns[0]?.name
    if (!targetColumnName) return
    const input = inputRefs.current[targetColumnName]
    if (!input) return
    input.focus()
    input.select()
  }, [editableColumns, initialFocusColumnName])

  const handleInputKeyDown = useCallback(
    (event: React.KeyboardEvent<HTMLInputElement>) => {
      if (event.key === "Enter") {
        event.preventDefault()
        void handleSave().catch(() => {})
        return
      }

      if (event.key === "Escape") {
        event.preventDefault()
        handleCancel()
      }
    },
    [handleCancel, handleSave],
  )

  return (
    <TableRow
      data-row-editor="true"
      className="bg-muted/40 hover:bg-muted/40"
    >
      <TableCell className={`${DATA_TABLE_COLUMN_CLASS} font-mono text-muted-foreground`}>
        {initialData?.id != null ? String(initialData.id) : ""}
      </TableCell>
      {editableColumns.map((col) => {
        const upper = col.type.toUpperCase()
        const isEnum = upper === "ENUM" && col.enumValues && col.enumValues.length > 0
        const isMultiEnum = upper === "MULTI_ENUM" && col.enumValues && col.enumValues.length > 0
        const isBool = upper === "BOOLEAN"

        if (isMultiEnum) {
          let selected: string[] = []
          try { selected = JSON.parse(values[col.name] || "[]") } catch { /* empty */ }
          if (!Array.isArray(selected)) selected = []
          return (
            <TableCell key={col.name} className={ROW_EDITOR_EDITABLE_CELL_CLASS}>
              <DataTableCellEnum
                multiple
                value={selected}
                options={col.enumValues!}
                disabled={isSaving}
                onChange={(next) => handleChange(col.name, JSON.stringify(next))}
                onFocus={() => {
                  activeColumnNameRef.current = col.name
                }}
              />
            </TableCell>
          )
        }

        if (isEnum || isBool) {
          const options = isBool
            ? [{ value: "true", label: "true" }, { value: "false", label: "false" }]
            : col.enumValues!.map((v) => ({ value: v, label: v }))
          return (
            <TableCell key={col.name} className={ROW_EDITOR_EDITABLE_CELL_CLASS}>
              <DataTableCellEnum
                value={values[col.name] ?? ""}
                options={options}
                disabled={isSaving}
                onChange={(next) => handleChange(col.name, next)}
                onFocus={() => {
                  activeColumnNameRef.current = col.name
                }}
              />
            </TableCell>
          )
        }

        return (
          <TableCell key={col.name} className={ROW_EDITOR_EDITABLE_CELL_CLASS}>
            <DataTableCellInput
              ref={(node) => {
                inputRefs.current[col.name] = node
              }}
              disabled={isSaving}
              value={values[col.name] ?? ""}
              onChange={(e) => handleChange(col.name, e.target.value)}
              onFocus={() => {
                activeColumnNameRef.current = col.name
              }}
              onKeyDown={handleInputKeyDown}
            />
          </TableCell>
        )
      })}
      {systemTimeColumns.map((col) => (
        <TableCell
          key={col.name}
          className={`${DATA_TABLE_COLUMN_CLASS} truncate font-mono text-muted-foreground`}
        >
          {formatCellValue(initialData?.[col.name], col.type, col.name)}
        </TableCell>
      ))}
      <TableCell className={`${DATA_TABLE_STICKY_ACTION_COLUMN_CLASS} py-0.5`}>
        <div className="flex items-center gap-1">
          <Button
            variant="default"
            size="icon-xs"
            className="rounded-sm"
            disabled={isSaving}
            onClick={() => {
              void handleSave().catch(() => {})
            }}
          >
            <Check className="size-3.5" />
          </Button>
          <Button
            variant="outline"
            size="icon-xs"
            className="rounded-sm"
            disabled={isSaving}
            onClick={handleCancel}
          >
            <X className="size-3.5" />
          </Button>
        </div>
      </TableCell>
    </TableRow>
  )
})

export { RowEditor }
export type { RowEditorHandle }
