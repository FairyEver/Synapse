import { useCallback, useEffect, useRef, useState, type RefObject } from "react"
import { Trash2 } from "lucide-react"
import { Button } from "@/components/ui/button"
import {
  Dialog,
  DialogContent,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog"
import { Input } from "@/components/ui/input"
import { Label } from "@/components/ui/label"
import { TagInput } from "@/components/ui/tag-input"
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select"
import type { Column, ColumnKind } from "@/types/database"
import { formatCreateTableSubmitError } from "@/modules/database/utils"
import {
  COLUMN_KINDS,
  getColumnKindLabel,
} from "./database-column-types"

type ColumnRow = {
  key: number
  name: string
  kind: ColumnKind
  description: string
  choices: string[]
}

type CreateTableDialogProps = {
  open: boolean
  onOpenChange: (open: boolean) => void
  onSubmit: (name: string, columns: Column[], description?: string) => Promise<void> | void
  restoreFocusRef?: RefObject<HTMLButtonElement | null>
}

const NAME_PATTERN = /^[a-zA-Z][a-zA-Z0-9_]*$/

let nextKey = 0

function CreateTableDialog({ open, onOpenChange, onSubmit, restoreFocusRef }: CreateTableDialogProps) {
  const [name, setName] = useState("")
  const [description, setDescription] = useState("")
  const [columns, setColumns] = useState<ColumnRow[]>([
    { key: ++nextKey, name: "", kind: "text", description: "", choices: [] },
  ])
  const [error, setError] = useState("")
  const [isSubmitting, setIsSubmitting] = useState(false)
  const [focusTarget, setFocusTarget] = useState<"name" | number | null>(null)
  const nameInputRef = useRef<HTMLInputElement>(null)
  const columnNameInputRefs = useRef(new Map<number, HTMLInputElement>())

  useEffect(() => {
    if (focusTarget === null) return
    const target = focusTarget === "name"
      ? nameInputRef.current
      : columnNameInputRefs.current.get(focusTarget)
    if (!target) return
    target.focus()
    setFocusTarget(null)
  }, [focusTarget])

  const showNameError = useCallback((message: string) => {
    setError(message)
    setFocusTarget("name")
  }, [])

  const showColumnError = useCallback((message: string, key: number) => {
    setError(message)
    setFocusTarget(key)
  }, [])

  const reset = useCallback(() => {
    setName("")
    setDescription("")
    setColumns([{ key: ++nextKey, name: "", kind: "text", description: "", choices: [] }])
    setError("")
    setIsSubmitting(false)
    setFocusTarget(null)
  }, [])

  const handleOpenChange = useCallback(
    (next: boolean) => {
      if (!next) reset()
      onOpenChange(next)
    },
    [onOpenChange, reset],
  )

  const databaseColumnCreate = useCallback(() => {
    setColumns((prev) => [...prev, { key: ++nextKey, name: "", kind: "text", description: "", choices: [] }])
  }, [])

  const removeColumn = useCallback((key: number) => {
    setColumns((prev) => prev.filter((c) => c.key !== key))
  }, [])

  const updateColumn = useCallback((key: number, field: keyof Omit<ColumnRow, "key">, value: string | string[]) => {
    setColumns((prev) =>
      prev.map((c) => (c.key === key ? { ...c, [field]: value } : c)),
    )
  }, [])

  const handleSubmit = useCallback(async () => {
    if (isSubmitting) {
      return
    }

    setError("")

    const trimmedName = name.trim()
    if (!trimmedName) {
      showNameError("请输入表名")
      return
    }
    if (!NAME_PATTERN.test(trimmedName)) {
      showNameError("表名须以英文字母开头，只能包含字母、数字、下划线")
      return
    }

    const validColumns = columns.filter((c) => c.name.trim())
    if (validColumns.length === 0) {
      showColumnError("至少需要一列", columns[0].key)
      return
    }

    const badCol = validColumns.find((c) => !NAME_PATTERN.test(c.name.trim()))
    if (badCol) {
      showColumnError(`列名 "${badCol.name.trim()}" 不合法，须以英文字母开头，只能包含字母、数字、下划线`, badCol.key)
      return
    }

    const dupCol = validColumns.find((c) => {
      const lower = c.name.trim().toLowerCase()
      return lower === "id" || lower === "created_at" || lower === "updated_at"
    })
    if (dupCol) {
      showColumnError(`列名 "${dupCol.name.trim()}" 为系统保留字段`, dupCol.key)
      return
    }

    const seenColumnNames = new Set<string>()
    const repeatedColumn = validColumns.find((c) => {
      const lower = c.name.trim().toLowerCase()
      if (seenColumnNames.has(lower)) return true
      seenColumnNames.add(lower)
      return false
    })
    if (repeatedColumn) {
      showColumnError(`列名 "${repeatedColumn.name.trim()}" 重复`, repeatedColumn.key)
      return
    }

    const emptyChoices = validColumns.find((c) => (c.kind === "single_choice" || c.kind === "multi_choice") && c.choices.length === 0)
    if (emptyChoices) {
      showColumnError(`列 "${emptyChoices.name.trim()}" 需要填写选项`, emptyChoices.key)
      return
    }

    const definitions = validColumns.map((c) => {
      const def: Column = {
        name: c.name.trim(),
        kind: c.kind,
        description: c.description.trim() || undefined,
      }
      if ((c.kind === "single_choice" || c.kind === "multi_choice") && c.choices.length > 0) {
        def.choices = c.choices
      }
      return def
    })

    setIsSubmitting(true)
    try {
      await onSubmit(trimmedName, definitions, description.trim() || undefined)
      handleOpenChange(false)
    } catch (submitError) {
      const formattedError = formatCreateTableSubmitError(submitError)
      const rejectedColumnName = submitError instanceof Error
        ? submitError.message.match(/Column "([^"]+)"/)?.[1]
        : undefined
      const rejectedColumn = rejectedColumnName
        ? validColumns.find((column) => column.name.trim() === rejectedColumnName)
        : undefined
      if (rejectedColumn) {
        showColumnError(formattedError, rejectedColumn.key)
      } else {
        showNameError(formattedError)
      }
    } finally {
      setIsSubmitting(false)
    }
  }, [name, description, columns, onSubmit, handleOpenChange, isSubmitting, showColumnError, showNameError])

  return (
    <Dialog open={open} onOpenChange={handleOpenChange} data-track="database-create-table-dialog">
      <DialogContent
        className="max-w-lg"
        onCloseAutoFocus={(event) => {
          if (!restoreFocusRef?.current) return
          event.preventDefault()
          restoreFocusRef.current.focus()
        }}
      >
        <DialogHeader>
          <DialogTitle>新建表</DialogTitle>
        </DialogHeader>

        <div className="flex flex-col gap-2">
          <div className="flex flex-col gap-2">
            <Label htmlFor="table-name">表名</Label>
            <Input
              ref={nameInputRef}
              id="table-name"
              data-track="database-create-table-name"
              value={name}
              onChange={(e) => setName(e.target.value)}
              placeholder="my_table"
            />
            <p className="text-xs text-muted-foreground">英文字母开头，只能包含字母、数字、下划线</p>
          </div>

          <div className="flex flex-col gap-2">
            <Label htmlFor="table-desc">描述</Label>
            <Input
              id="table-desc"
              data-track="database-create-table-description"
              value={description}
              onChange={(e) => setDescription(e.target.value)}
              placeholder="可选"
            />
          </div>

          <div className="flex flex-col gap-2">
            <Label>列定义</Label>
            <p className="text-xs text-muted-foreground">以下系统列会自动创建，无需手动添加</p>
            <div className="flex flex-col gap-1 rounded-md border bg-muted/50 p-2 text-xs text-muted-foreground">
              <div className="flex items-center gap-2">
                <span className="w-28 font-mono">id</span>
                <span className="w-28">整数（自增主键）</span>
              </div>
              <div className="flex items-center gap-2">
                <span className="w-28 font-mono">created_at</span>
                <span className="w-28">创建时间</span>
              </div>
              <div className="flex items-center gap-2">
                <span className="w-28 font-mono">updated_at</span>
                <span className="w-28">更新时间</span>
              </div>
            </div>
            <p className="text-xs text-muted-foreground">自定义列名须以英文字母开头，只能包含字母、数字、下划线</p>
            <div className="flex flex-col gap-2">
              {columns.map((col) => (
                <div key={col.key} className="flex flex-col gap-1.5 rounded-md border p-2">
                  <div className="flex items-center gap-2">
                    <Input
                      ref={(element) => {
                        if (element) {
                          columnNameInputRefs.current.set(col.key, element)
                        } else {
                          columnNameInputRefs.current.delete(col.key)
                        }
                      }}
                      className="flex-1"
                      data-track="database-create-column-name"
                      value={col.name}
                      onChange={(e) => updateColumn(col.key, "name", e.target.value)}
                      placeholder="列名"
                    />
                    <Select
                      data-track="database-create-column-kind"
                      value={col.kind}
                      onValueChange={(v) => updateColumn(col.key, "kind", v)}
                    >
                      <SelectTrigger className="w-28">
                        <SelectValue>{getColumnKindLabel(col.kind)}</SelectValue>
                      </SelectTrigger>
                      <SelectContent>
                        {COLUMN_KINDS.map((t) => (
                          <SelectItem key={t} value={t}>
                            {getColumnKindLabel(t)}
                          </SelectItem>
                        ))}
                      </SelectContent>
                    </Select>
                    <Button
                      variant="ghost"
                      size="icon"
                      data-track="database-create-column-remove"
                      onClick={() => removeColumn(col.key)}
                      disabled={columns.length <= 1}
                    >
                      <Trash2 className="size-4" />
                    </Button>
                  </div>
                  <Input
                    className="text-xs"
                    data-track="database-create-column-description"
                    value={col.description}
                    onChange={(e) => updateColumn(col.key, "description", e.target.value)}
                    placeholder="可选说明"
                  />
                  {col.kind === "single_choice" || col.kind === "multi_choice" ? (
                    <TagInput
                      className="text-xs"
                      data-track="database-create-column-choices"
                      value={col.choices}
                      onChange={(v) => updateColumn(col.key, "choices", v)}
                      placeholder="输入后按回车添加"
                    />
                  ) : null}
                </div>
              ))}
            </div>
            <Button variant="outline" size="sm" data-track="database-create-column-add" onClick={databaseColumnCreate}>
              + 添加列
            </Button>
          </div>

          {error ? <p className="text-sm text-destructive">{error}</p> : null}
        </div>

        <DialogFooter>
          <Button variant="outline" disabled={isSubmitting} data-track="database-create-table-cancel" onClick={() => handleOpenChange(false)}>
            取消
          </Button>
          <Button disabled={isSubmitting} data-track="database-create-table-submit" onClick={() => void handleSubmit()}>
            {isSubmitting ? "创建中..." : "创建"}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}

export { CreateTableDialog }
