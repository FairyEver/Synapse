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
}

type CreateTableDialogProps = {
  open: boolean
  onOpenChange: (open: boolean) => void
  onSubmit: (name: string, columns: DataStoreColumnDef[], description?: string) => void
}

let nextKey = 0

function CreateTableDialog({ open, onOpenChange, onSubmit }: CreateTableDialogProps) {
  const [name, setName] = useState("")
  const [description, setDescription] = useState("")
  const [columns, setColumns] = useState<ColumnRow[]>([
    { key: ++nextKey, name: "", type: "TEXT" },
  ])
  const [error, setError] = useState("")

  const reset = useCallback(() => {
    setName("")
    setDescription("")
    setColumns([{ key: ++nextKey, name: "", type: "TEXT" }])
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
    setColumns((prev) => [...prev, { key: ++nextKey, name: "", type: "TEXT" }])
  }, [])

  const removeColumn = useCallback((key: number) => {
    setColumns((prev) => prev.filter((c) => c.key !== key))
  }, [])

  const updateColumn = useCallback((key: number, field: "name" | "type", value: string) => {
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

    const validColumns = columns.filter((c) => c.name.trim())
    if (validColumns.length === 0) {
      setError("至少需要一列")
      return
    }

    onSubmit(
      trimmedName,
      validColumns.map((c) => ({ name: c.name.trim(), type: c.type })),
      description.trim() || undefined,
    )
    handleOpenChange(false)
  }, [name, description, columns, onSubmit, handleOpenChange])

  return (
    <Dialog open={open} onOpenChange={handleOpenChange}>
      <DialogContent className="max-w-md">
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
            <div className="flex flex-col gap-2">
              {columns.map((col) => (
                <div key={col.key} className="flex items-center gap-2">
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
