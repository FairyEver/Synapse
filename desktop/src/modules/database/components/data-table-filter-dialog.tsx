import { useCallback, useEffect, useMemo, useState, type RefObject } from "react"
import { Plus, X } from "lucide-react"
import { Button } from "@/components/ui/button"
import { Checkbox } from "@/components/ui/checkbox"
import {
  Dialog,
  DialogContent,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog"
import { Input } from "@/components/ui/input"
import {
  Select,
  SelectContent,
  SelectGroup,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select"
import type {
  Column,
  DatabaseWhereCondition,
  DatabaseWhereGroup,
} from "@/types/database"

type DataTableFilterDialogProps = {
  open: boolean
  onOpenChange: (open: boolean) => void
  columns: Column[]
  value: DatabaseWhereGroup | null
  onApply: (filter: DatabaseWhereGroup | null) => void
  restoreFocusRef?: RefObject<HTMLButtonElement | null>
}

type DraftCondition = {
  id: string
  field: string
  op: DatabaseWhereCondition["op"]
  value: string | boolean
}

const TEXT_OPERATORS: Array<{ value: DatabaseWhereCondition["op"]; label: string }> = [
  { value: "=", label: "等于" },
  { value: "!=", label: "不等于" },
  { value: "LIKE", label: "包含" },
]

const NUMBER_OPERATORS: Array<{ value: DatabaseWhereCondition["op"]; label: string }> = [
  { value: "=", label: "等于" },
  { value: "!=", label: "不等于" },
  { value: ">", label: "大于" },
  { value: ">=", label: "大于等于" },
  { value: "<", label: "小于" },
  { value: "<=", label: "小于等于" },
]

const BOOLEAN_OPERATORS: Array<{ value: DatabaseWhereCondition["op"]; label: string }> = [
  { value: "=", label: "等于" },
  { value: "!=", label: "不等于" },
]

const DEFAULT_COMBINATOR: DatabaseWhereGroup["combinator"] = "all"

function createCondition(column: Column): DraftCondition {
  return {
    id: crypto.randomUUID(),
    field: column.name,
    op: getDefaultOperator(column),
    value: column.kind === "boolean" ? false : "",
  }
}

function getDefaultOperator(column: Column): DatabaseWhereCondition["op"] {
  return column.kind === "multi_choice" ? "CONTAINS" : "="
}

function getOperators(column: Column) {
  if (column.kind === "integer" || column.kind === "decimal" || column.kind === "date" || column.kind === "timestamp") {
    return NUMBER_OPERATORS
  }
  if (column.kind === "boolean") {
    return BOOLEAN_OPERATORS
  }
  if (column.kind === "multi_choice") {
    return [{ value: "CONTAINS" as const, label: "包含" }]
  }
  return TEXT_OPERATORS
}

function normalizeOperator(column: Column, op: DatabaseWhereCondition["op"]) {
  const operators = getOperators(column)
  return operators.some((item) => item.value === op) ? op : operators[0].value
}

function parseDraftValue(column: Column, value: string | boolean) {
  if (column.kind === "boolean") {
    return Boolean(value)
  }
  if (column.kind === "integer") {
    return Number.parseInt(String(value), 10)
  }
  if (column.kind === "decimal") {
    return Number.parseFloat(String(value))
  }
  if (column.kind === "multi_choice") {
    return String(value)
  }
  if (column.kind === "json") {
    try {
      return JSON.parse(String(value))
    } catch {
      return String(value)
    }
  }
  if (column.kind === "text" && typeof value === "string") {
    return value
  }
  return value
}

function formatDraftValue(column: Column, value: unknown) {
  if (column.kind === "boolean") {
    return Boolean(value)
  }
  if (typeof value === "string") {
    return value
  }
  if (value === null || value === undefined) {
    return ""
  }
  if (typeof value === "object") {
    return JSON.stringify(value)
  }
  return String(value)
}

function isEmptyDraftValue(column: Column, value: string | boolean) {
  if (column.kind === "boolean") {
    return false
  }
  return String(value).trim() === ""
}

function DataTableFilterDialog({
  open,
  onOpenChange,
  columns,
  value,
  onApply,
  restoreFocusRef,
}: DataTableFilterDialogProps) {
  const filterableColumns = useMemo(() => columns.filter((column) => !column.primaryKey), [columns])
  const firstColumn = filterableColumns[0]
  const [combinator, setCombinator] = useState<DatabaseWhereGroup["combinator"]>(DEFAULT_COMBINATOR)
  const [conditions, setConditions] = useState<DraftCondition[]>([])

  useEffect(() => {
    if (!open) {
      return
    }

    setCombinator(value?.combinator ?? DEFAULT_COMBINATOR)
    setConditions(() => {
      if (!value || value.conditions.length === 0) {
        return firstColumn ? [createCondition(firstColumn)] : []
      }
      return value.conditions.flatMap((condition) => {
        const column = filterableColumns.find((item) => item.name === condition.field)
        if (!column) {
          return []
        }
        return [{
          id: crypto.randomUUID(),
          field: condition.field,
          op: normalizeOperator(column, condition.op),
          value: formatDraftValue(column, condition.value),
        }]
      })
    })
  }, [filterableColumns, firstColumn, open, value])

  const handleAddCondition = useCallback(() => {
    if (!firstColumn) {
      return
    }
    setConditions((current) => [...current, createCondition(firstColumn)])
  }, [firstColumn])

  const handleFieldChange = useCallback(
    (id: string, field: string) => {
      const column = filterableColumns.find((item) => item.name === field)
      if (!column) {
        return
      }
      setConditions((current) => current.map((condition) => (
        condition.id === id
          ? { ...condition, field, op: getDefaultOperator(column), value: column.kind === "boolean" ? false : "" }
          : condition
      )))
    },
    [filterableColumns],
  )

  const handleApply = useCallback(() => {
    const nextConditions = conditions.flatMap((condition) => {
      const column = filterableColumns.find((item) => item.name === condition.field)
      if (!column || isEmptyDraftValue(column, condition.value)) {
        return []
      }
      const parsedValue = parseDraftValue(column, condition.value)
      if ((column.kind === "integer" || column.kind === "decimal") && Number.isNaN(parsedValue)) {
        return []
      }
      const queryValue = condition.op === "LIKE" ? `%${String(parsedValue)}%` : parsedValue
      return [{ field: condition.field, op: condition.op, value: queryValue }]
    })

    onApply(nextConditions.length > 0 ? { combinator, conditions: nextConditions } : null)
    onOpenChange(false)
  }, [combinator, conditions, filterableColumns, onApply, onOpenChange])

  return (
    <Dialog open={open} onOpenChange={onOpenChange} data-track="database-filter-dialog">
      <DialogContent
        className="overflow-hidden gap-2 p-3 sm:max-w-md"
        onCloseAutoFocus={(event) => {
          if (!restoreFocusRef?.current) {
            return
          }
          event.preventDefault()
          window.setTimeout(() => restoreFocusRef.current?.focus())
        }}
      >
        <DialogHeader>
          <DialogTitle>设置筛选条件</DialogTitle>
        </DialogHeader>

        <div className="flex flex-col gap-2">
          <div className="flex items-center justify-end gap-2 text-sm text-muted-foreground">
            <span>符合以下</span>
              <Select
                data-track="database-filter-combinator"
                value={combinator}
                onValueChange={(nextValue) => setCombinator(nextValue as DatabaseWhereGroup["combinator"])}
              >
                <SelectTrigger size="sm">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectGroup>
                    <SelectItem value="all">所有</SelectItem>
                    <SelectItem value="any">任一</SelectItem>
                  </SelectGroup>
                </SelectContent>
              </Select>
            <span>条件</span>
          </div>

          <div className="flex flex-col gap-2">
            {conditions.map((condition) => {
              const column = filterableColumns.find((item) => item.name === condition.field) ?? firstColumn
              if (!column) {
                return null
              }
              const operators = getOperators(column)
              return (
                <div key={condition.id} className="grid min-w-0 grid-cols-[minmax(0,1fr)_5.5rem_minmax(0,1fr)_1.75rem] items-center gap-1.5">
                  <Select
                    data-track="database-filter-field"
                    value={condition.field}
                    onValueChange={(field) => handleFieldChange(condition.id, field)}
                  >
                    <SelectTrigger size="sm" className="w-full">
                      <SelectValue />
                    </SelectTrigger>
                    <SelectContent>
                      <SelectGroup>
                        {filterableColumns.map((item) => (
                          <SelectItem key={item.name} value={item.name}>{item.name}</SelectItem>
                        ))}
                      </SelectGroup>
                    </SelectContent>
                  </Select>

                  <Select
                    data-track="database-filter-operator"
                    value={condition.op}
                    onValueChange={(op) => {
                      setConditions((current) => current.map((item) => (
                        item.id === condition.id
                          ? { ...item, op: op as DatabaseWhereCondition["op"] }
                          : item
                      )))
                    }}
                  >
                    <SelectTrigger size="sm" className="w-full">
                      <SelectValue />
                    </SelectTrigger>
                    <SelectContent>
                      <SelectGroup>
                        {operators.map((operator) => (
                          <SelectItem key={operator.value} value={operator.value}>{operator.label}</SelectItem>
                        ))}
                      </SelectGroup>
                    </SelectContent>
                  </Select>

                  {column.kind === "boolean" ? (
                    <label className="flex h-7 items-center gap-2 rounded-lg border border-input px-2.5 text-sm">
                      <Checkbox
                        data-track="database-filter-boolean-value"
                        checked={Boolean(condition.value)}
                        onCheckedChange={(checked) => {
                          setConditions((current) => current.map((item) => (
                            item.id === condition.id ? { ...item, value: checked === true } : item
                          )))
                        }}
                      />
                      已勾选
                    </label>
                  ) : column.choices && column.choices.length > 0 ? (
                    <Select
                      data-track="database-filter-choice-value"
                      value={String(condition.value)}
                      onValueChange={(nextValue) => {
                        setConditions((current) => current.map((item) => (
                          item.id === condition.id ? { ...item, value: nextValue } : item
                        )))
                      }}
                    >
                      <SelectTrigger size="sm" className="w-full">
                        <SelectValue placeholder="选择值" />
                      </SelectTrigger>
                      <SelectContent>
                        <SelectGroup>
                          {column.choices.map((choice) => (
                            <SelectItem key={choice} value={choice}>{choice}</SelectItem>
                          ))}
                        </SelectGroup>
                      </SelectContent>
                    </Select>
                  ) : (
                    <Input
                      className="h-7"
                      data-track="database-filter-text-value"
                      value={String(condition.value)}
                      type={column.kind === "integer" || column.kind === "decimal" ? "number" : "text"}
                      placeholder="输入值"
                      onChange={(event) => {
                        setConditions((current) => current.map((item) => (
                          item.id === condition.id ? { ...item, value: event.target.value } : item
                        )))
                      }}
                    />
                  )}

                  <Button
                    variant="ghost"
                    size="icon-sm"
                    disabled={conditions.length <= 1}
                    data-track="database-filter-condition-remove"
                    onClick={() => {
                      setConditions((current) => current.filter((item) => item.id !== condition.id))
                    }}
                  >
                    <X />
                    <span className="sr-only">删除条件</span>
                  </Button>
                </div>
              )
            })}
          </div>

          <Button variant="ghost" size="sm" className="w-fit px-2" data-track="database-filter-condition-add" onClick={handleAddCondition} disabled={!firstColumn}>
            <Plus />
            添加条件
          </Button>
        </div>

        <DialogFooter className="-mx-3 -mb-3 px-3 py-2">
          <Button variant="outline" data-track="database-filter-clear" onClick={() => onApply(null)}>清除</Button>
          <Button data-track="database-filter-apply" onClick={handleApply}>应用</Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}

export { DataTableFilterDialog }
