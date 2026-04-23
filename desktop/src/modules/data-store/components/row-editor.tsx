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
import { DataTableCellInput } from "./data-table-cell-input"
import {
  DATA_TABLE_ACTION_COLUMN_CLASS,
  DATA_TABLE_ID_COLUMN_CLASS,
  DATA_TABLE_VALUE_COLUMN_CLASS,
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
  const editableColumns = useMemo(() => columns.filter((c) => !c.primaryKey), [columns])
  const initialValues = useMemo(() => {
    const init: Record<string, string> = {}
    for (const col of editableColumns) {
      const val = initialData?.[col.name]
      init[col.name] = val != null ? String(val) : ""
    }
    return init
  }, [editableColumns, initialData])
  const inputRefs = useRef<Record<string, HTMLInputElement | null>>({})
  const activeColumnNameRef = useRef<string | null>(initialFocusColumnName ?? editableColumns[0]?.name ?? null)
  const lastPointerDownTargetRef = useRef<EventTarget | null>(null)
  const rowRef = useRef<HTMLTableRowElement | null>(null)
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

  useEffect(() => {
    const handlePointerDown = (event: PointerEvent) => {
      lastPointerDownTargetRef.current = event.target
    }

    document.addEventListener("pointerdown", handlePointerDown, true)
    return () => {
      document.removeEventListener("pointerdown", handlePointerDown, true)
    }
  }, [])

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

  const handleRowBlurCapture = useCallback(
    (event: React.FocusEvent<HTMLTableRowElement>) => {
      if (isSaving) {
        return
      }

      const row = rowRef.current
      const nextTarget = event.relatedTarget
      if (row && nextTarget instanceof Node && row.contains(nextTarget)) {
        return
      }

      const pointerTarget = lastPointerDownTargetRef.current
      if (row && pointerTarget instanceof Node && row.contains(pointerTarget)) {
        return
      }

      void handleSave().catch(() => {})
    },
    [handleSave, isSaving],
  )

  return (
    <TableRow
      ref={rowRef}
      data-row-editor="true"
      className="bg-muted/40 hover:bg-muted/40"
      onBlurCapture={handleRowBlurCapture}
    >
      <TableCell className={`${DATA_TABLE_ID_COLUMN_CLASS} font-mono text-muted-foreground`}>
        {initialData?.id != null ? String(initialData.id) : ""}
      </TableCell>
      {editableColumns.map((col) => (
        <TableCell key={col.name} className={DATA_TABLE_VALUE_COLUMN_CLASS}>
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
      ))}
      <TableCell className={`${DATA_TABLE_ACTION_COLUMN_CLASS} py-0.5`}>
        <div className="flex items-center gap-0.5">
          <Button
            variant="ghost"
            size="icon"
            className="size-6"
            disabled={isSaving}
            onClick={() => {
              void handleSave().catch(() => {})
            }}
          >
            <Check className="size-3.5" />
          </Button>
          <Button
            variant="ghost"
            size="icon"
            className="size-6"
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
