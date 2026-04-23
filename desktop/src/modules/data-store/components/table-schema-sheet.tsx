import { useCallback, useRef, useState } from "react"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { Label } from "@/components/ui/label"
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select"
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table"
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
  AlertDialogTrigger,
} from "@/components/ui/alert-dialog"
import {
  Dialog,
  DialogClose,
  DialogContent,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog"
import type { DataStoreColumnType, DataStoreTableSchema } from "@/types/data-store"
import {
  DATA_STORE_COLUMN_TYPES,
  getDataStoreColumnTypeDisplayName,
  getDataStoreColumnTypeLabel,
} from "./data-store-column-types"

type TableSchemaSheetProps = {
  open: boolean
  onOpenChange: (open: boolean) => void
  schema: DataStoreTableSchema | null
  onAddColumn: (name: string, type: DataStoreColumnType, description?: string) => void
  onUpdateColumnDescription: (column: string, description: string) => void
  onDropTable: () => void
}

function TableSchemaSheet({
  open,
  onOpenChange,
  schema,
  onAddColumn,
  onUpdateColumnDescription,
  onDropTable,
}: TableSchemaSheetProps) {
  const [newColName, setNewColName] = useState("")
  const [newColType, setNewColType] = useState<DataStoreColumnType>("TEXT")
  const [newColDesc, setNewColDesc] = useState("")
  const [editingCol, setEditingCol] = useState<string | null>(null)
  const [editingDesc, setEditingDesc] = useState("")
  const editInputRef = useRef<HTMLInputElement>(null)

  const handleAddColumn = useCallback(() => {
    const trimmed = newColName.trim()
    if (!trimmed) return
    onAddColumn(trimmed, newColType, newColDesc.trim() || undefined)
    setNewColName("")
    setNewColType("TEXT")
    setNewColDesc("")
  }, [newColName, newColType, newColDesc, onAddColumn])

  const startEditDescription = useCallback((colName: string, currentDesc: string) => {
    setEditingCol(colName)
    setEditingDesc(currentDesc)
    setTimeout(() => editInputRef.current?.focus(), 0)
  }, [])

  const commitEditDescription = useCallback(() => {
    if (editingCol) {
      onUpdateColumnDescription(editingCol, editingDesc.trim())
      setEditingCol(null)
    }
  }, [editingCol, editingDesc, onUpdateColumnDescription])

  if (!schema) return null

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-3xl gap-0 overflow-hidden p-0">
        <DialogHeader className="px-5 pt-5">
          <DialogTitle>{schema.name} 表结构</DialogTitle>
        </DialogHeader>

        <div className="flex max-h-[calc(100vh-12rem)] min-h-0 flex-col gap-5 overflow-y-auto px-5 py-4">
          <div className="min-h-0 overflow-auto rounded-md border">
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>列名</TableHead>
                  <TableHead>类型</TableHead>
                  <TableHead>说明</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {schema.columns.map((col) => (
                  <TableRow key={col.name}>
                    <TableCell className="font-mono text-sm">{col.name}</TableCell>
                    <TableCell>{getDataStoreColumnTypeDisplayName(col.type)}</TableCell>
                    <TableCell className="text-muted-foreground">
                      {col.primaryKey ? (
                        "自增主键"
                      ) : editingCol === col.name ? (
                        <Input
                          ref={editInputRef}
                          className="h-7 text-xs"
                          value={editingDesc}
                          onChange={(e) => setEditingDesc(e.target.value)}
                          onBlur={commitEditDescription}
                          onKeyDown={(e) => {
                            if (e.key === "Enter") commitEditDescription()
                            if (e.key === "Escape") setEditingCol(null)
                          }}
                          placeholder="列说明"
                        />
                      ) : (
                        <span
                          className="cursor-pointer rounded px-1 py-0.5 hover:bg-muted"
                          onClick={() => startEditDescription(col.name, col.description)}
                        >
                          {col.description || "点击添加说明"}
                        </span>
                      )}
                    </TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          </div>

          <div className="flex flex-col gap-2">
            <Label>添加列</Label>
            <div className="grid gap-2 sm:grid-cols-[minmax(0,1fr)_7.5rem_auto]">
              <Input
                value={newColName}
                onChange={(e) => setNewColName(e.target.value)}
                placeholder="列名"
              />
              <Select value={newColType} onValueChange={(v) => setNewColType(v as DataStoreColumnType)}>
                <SelectTrigger className="w-full">
                  <SelectValue>{getDataStoreColumnTypeLabel(newColType)}</SelectValue>
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
                size="sm"
                className="w-full sm:w-auto"
                onClick={handleAddColumn}
                disabled={!newColName.trim()}
              >
                添加
              </Button>
            </div>
            <Input
              value={newColDesc}
              onChange={(e) => setNewColDesc(e.target.value)}
              placeholder="用途说明，帮助 AI 理解此列"
              className="text-xs"
            />
          </div>
        </div>

        <DialogFooter className="mx-0 mb-0 shrink-0 rounded-none rounded-b-xl px-5 py-4 sm:items-center sm:justify-between">
          <AlertDialog>
            <AlertDialogTrigger asChild>
              <Button variant="destructive">删除此表</Button>
            </AlertDialogTrigger>
            <AlertDialogContent>
              <AlertDialogHeader>
                <AlertDialogTitle>确认删除</AlertDialogTitle>
                <AlertDialogDescription>
                  确定要删除表 "{schema.name}" 吗？此操作不可撤销，所有数据将被永久删除。
                </AlertDialogDescription>
              </AlertDialogHeader>
              <AlertDialogFooter>
                <AlertDialogCancel>取消</AlertDialogCancel>
                <AlertDialogAction onClick={onDropTable}>删除</AlertDialogAction>
              </AlertDialogFooter>
            </AlertDialogContent>
          </AlertDialog>
          <DialogClose asChild>
            <Button variant="outline">关闭</Button>
          </DialogClose>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}

export { TableSchemaSheet }
