import { useCallback, useState } from "react"
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
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select"
import type { DataStoreColumnDef, DataStoreColumnType } from "@/types/data-store"
import {
  DATA_STORE_COLUMN_TYPES,
  getDataStoreColumnTypeLabel,
} from "./data-store-column-types"

type ColumnRow = {
  key: number
  name: string
  type: DataStoreColumnType
  description: string
  enumValues: string
}

type CreateTableDialogProps = {
  open: boolean
  onOpenChange: (open: boolean) => void
  onSubmit: (name: string, columns: DataStoreColumnDef[], description?: string) => void
}

const NAME_PATTERN = /^[a-zA-Z][a-zA-Z0-9_]*$/

let nextKey = 0

function CreateTableDialog({ open, onOpenChange, onSubmit }: CreateTableDialogProps) {
  const [name, setName] = useState("")
  const [description, setDescription] = useState("")
  const [columns, setColumns] = useState<ColumnRow[]>([
    { key: ++nextKey, name: "", type: "TEXT", description: "", enumValues: "" },
  ])
  const [error, setError] = useState("")

  const reset = useCallback(() => {
    setName("")
    setDescription("")
    setColumns([{ key: ++nextKey, name: "", type: "TEXT", description: "", enumValues: "" }])
    setError("")
  }, [])

  const handleOpenChange = useCallback(
    (next: boolean) => {
      if (!next) reset()
      onOpenChange(next)
    },
    [onOpenChange, reset],
  )

  const addColumn = useCallback(() => {
    setColumns((prev) => [...prev, { key: ++nextKey, name: "", type: "TEXT", description: "", enumValues: "" }])
  }, [])

  const removeColumn = useCallback((key: number) => {
    setColumns((prev) => prev.filter((c) => c.key !== key))
  }, [])

  const updateColumn = useCallback((key: number, field: "name" | "type" | "description" | "enumValues", value: string) => {
    setColumns((prev) =>
      prev.map((c) => (c.key === key ? { ...c, [field]: value } : c)),
    )
  }, [])

  const handleSubmit = useCallback(() => {
    setError("")

    const trimmedName = name.trim()
    if (!trimmedName) {
      setError("请输入表名")
      return
    }
    if (!NAME_PATTERN.test(trimmedName)) {
      setError("表名须以英文字母开头，只能包含字母、数字、下划线")
      return
    }

    const validColumns = columns.filter((c) => c.name.trim())
    if (validColumns.length === 0) {
      setError("至少需要一列")
      return
    }

    const badCol = validColumns.find((c) => !NAME_PATTERN.test(c.name.trim()))
    if (badCol) {
      setError(`列名 "${badCol.name.trim()}" 不合法，须以英文字母开头，只能包含字母、数字、下划线`)
      return
    }

    const dupCol = validColumns.find((c) => c.name.trim().toLowerCase() === "id")
    if (dupCol) {
      setError(`列名 "id" 为系统保留字段`)
      return
    }

    const emptyEnum = validColumns.find((c) => c.type === "ENUM" && !c.enumValues.trim())
    if (emptyEnum) {
      setError(`枚举列 "${emptyEnum.name.trim()}" 需要填写允许的值`)
      return
    }

    onSubmit(
      trimmedName,
      validColumns.map((c) => {
        const def: DataStoreColumnDef = {
          name: c.name.trim(),
          type: c.type,
          description: c.description.trim() || undefined,
        }
        if (c.type === "ENUM" && c.enumValues.trim()) {
          def.enumValues = c.enumValues.split(",").map((v) => v.trim()).filter(Boolean)
        }
        return def
      }),
      description.trim() || undefined,
    )
    handleOpenChange(false)
  }, [name, description, columns, onSubmit, handleOpenChange])

  return (
    <Dialog open={open} onOpenChange={handleOpenChange}>
      <DialogContent className="max-w-lg">
        <DialogHeader>
          <DialogTitle>新建表</DialogTitle>
        </DialogHeader>

        <div className="flex flex-col gap-4">
          <div className="flex flex-col gap-2">
            <Label htmlFor="table-name">表名</Label>
            <Input
              id="table-name"
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
              value={description}
              onChange={(e) => setDescription(e.target.value)}
              placeholder="可选"
            />
          </div>

          <div className="flex flex-col gap-2">
            <Label>列定义</Label>
            <p className="text-xs text-muted-foreground">列名须以英文字母开头，只能包含字母、数字、下划线，id 为系统保留字段</p>
            <div className="flex flex-col gap-2">
              {columns.map((col) => (
                <div key={col.key} className="flex flex-col gap-1.5 rounded-md border p-2">
                  <div className="flex items-center gap-2">
                    <Input
                      className="flex-1"
                      value={col.name}
                      onChange={(e) => updateColumn(col.key, "name", e.target.value)}
                      placeholder="列名"
                    />
                    <Select
                      value={col.type}
                      onValueChange={(v) => updateColumn(col.key, "type", v)}
                    >
                      <SelectTrigger className="w-28">
                        <SelectValue>{getDataStoreColumnTypeLabel(col.type)}</SelectValue>
                      </SelectTrigger>
                      <SelectContent>
                        {DATA_STORE_COLUMN_TYPES.map((t) => (
                          <SelectItem key={t} value={t}>
                            {getDataStoreColumnTypeLabel(t)}
                          </SelectItem>
                        ))}
                      </SelectContent>
                    </Select>
                    <Button
                      variant="ghost"
                      size="icon"
                      onClick={() => removeColumn(col.key)}
                      disabled={columns.length <= 1}
                    >
                      <Trash2 className="size-4" />
                    </Button>
                  </div>
                  <Input
                    className="text-xs"
                    value={col.description}
                    onChange={(e) => updateColumn(col.key, "description", e.target.value)}
                    placeholder="用途说明，帮助 AI 理解此列"
                  />
                  {col.type === "ENUM" ? (
                    <Input
                      className="text-xs"
                      value={col.enumValues}
                      onChange={(e) => updateColumn(col.key, "enumValues", e.target.value)}
                      placeholder="允许的值，用逗号分隔，如：收入, 支出"
                    />
                  ) : null}
                </div>
              ))}
            </div>
            <Button variant="outline" size="sm" onClick={addColumn}>
              + 添加列
            </Button>
          </div>

          {error ? <p className="text-sm text-destructive">{error}</p> : null}
        </div>

        <DialogFooter>
          <Button variant="outline" onClick={() => handleOpenChange(false)}>
            取消
          </Button>
          <Button onClick={handleSubmit}>创建</Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}

export { CreateTableDialog }
