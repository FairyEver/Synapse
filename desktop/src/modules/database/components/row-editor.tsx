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
import type { Column } from "@/types/database"
import { DataTableCellChoice } from "./data-table-cell-choice"
import { DataTableCellInput } from "./data-table-cell-input"
import {
  DATA_TABLE_COLUMN_CLASS,
  DATA_TABLE_STICKY_ACTION_COLUMN_CLASS,
  formatCellValue,
} from "./data-table-layout"
import { parseRowEditorCellValue } from "./row-editor-values"

type RowEditorProps = {
  columns: Column[]
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
      if (col.kind === "multi_choice" && Array.isArray(val)) {
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
  const [validationError, setValidationError] = useState<string | null>(null)
  const [invalidColumnName, setInvalidColumnName] = useState<string | null>(null)
  const isDirty = useMemo(
    () => editableColumns.some((col) => (values[col.name] ?? "") !== (initialValues[col.name] ?? "")),
    [editableColumns, initialValues, values],
  )

  const handleChange = useCallback((colName: string, value: string) => {
    if (invalidColumnName === colName) {
      setInvalidColumnName(null)
      setValidationError(null)
    }
    setValues((prev) => ({ ...prev, [colName]: value }))
  }, [invalidColumnName])

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
      try {
        data[col.name] = parseRowEditorCellValue(col, raw)
      } catch (error) {
        const message = error instanceof Error ? error.message : "输入不合法"
        setInvalidColumnName(col.name)
        setValidationError(message)
        const input = inputRefs.current[col.name]
        input?.focus()
        input?.select()
        return Promise.reject(error)
      }
    }

    setInvalidColumnName(null)
    setValidationError(null)
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
    <>
      <TableRow
        data-row-editor="true"
        className="bg-muted/40 hover:bg-muted/40"
      >
        <TableCell className={`${DATA_TABLE_COLUMN_CLASS} font-mono text-muted-foreground`}>
          {initialData?.id != null ? String(initialData.id) : ""}
        </TableCell>
        {editableColumns.map((col) => {
          const isSingleChoice = col.kind === "single_choice" && col.choices && col.choices.length > 0
          const isMultiChoice = col.kind === "multi_choice" && col.choices && col.choices.length > 0
          const isBool = col.kind === "boolean"

          if (isMultiChoice) {
            let selected: string[] = []
            try { selected = JSON.parse(values[col.name] || "[]") } catch { /* empty */ }
            if (!Array.isArray(selected)) selected = []
            return (
              <TableCell key={col.name} className={ROW_EDITOR_EDITABLE_CELL_CLASS}>
                <DataTableCellChoice
                  multiple
                  data-track="database-row-cell-choice"
                  value={selected}
                  options={col.choices!}
                  disabled={isSaving}
                  onChange={(next) => handleChange(col.name, JSON.stringify(next))}
                  onFocus={() => {
                    activeColumnNameRef.current = col.name
                  }}
                />
              </TableCell>
            )
          }

          if (isSingleChoice || isBool) {
            const options = isBool
              ? [{ value: "true", label: "true" }, { value: "false", label: "false" }]
              : col.choices!.map((v) => ({ value: v, label: v }))
            return (
              <TableCell key={col.name} className={ROW_EDITOR_EDITABLE_CELL_CLASS}>
                <DataTableCellChoice
                  data-track="database-row-cell-choice"
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
                aria-invalid={invalidColumnName === col.name}
                data-track="database-row-cell-input"
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
            {formatCellValue(initialData?.[col.name], col.kind, col.name)}
          </TableCell>
        ))}
        <TableCell className={`${DATA_TABLE_STICKY_ACTION_COLUMN_CLASS} py-0.5`}>
          <div className="flex items-center gap-1">
            <Button
              variant="default"
              size="icon-xs"
              className="rounded-sm"
              disabled={isSaving}
              data-track="database-row-save"
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
              data-track="database-row-cancel"
              onClick={handleCancel}
            >
              <X className="size-3.5" />
            </Button>
          </div>
        </TableCell>
      </TableRow>
      {validationError ? (
        <TableRow>
          <TableCell
            colSpan={1 + editableColumns.length + systemTimeColumns.length + 1}
            className="bg-background text-sm text-destructive"
          >
            {validationError}
          </TableCell>
        </TableRow>
      ) : null}
    </>
  )
})

export { RowEditor, parseRowEditorCellValue }
export type { RowEditorHandle }
