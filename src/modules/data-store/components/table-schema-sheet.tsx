import { useCallback, useState } from "react"
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
  Sheet,
  SheetContent,
  SheetFooter,
  SheetHeader,
  SheetTitle,
} from "@/components/ui/sheet"
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
import type { DataStoreColumnType, DataStoreTableSchema } from "@/types/data-store"

const COLUMN_TYPES: DataStoreColumnType[] = ["TEXT", "INTEGER", "REAL", "BLOB", "JSON"]

type TableSchemaSheetProps = {
  open: boolean
  onOpenChange: (open: boolean) => void
  schema: DataStoreTableSchema | null
  onAddColumn: (name: string, type: DataStoreColumnType) => void
  onDropTable: () => void
}

function TableSchemaSheet({
  open,
  onOpenChange,
  schema,
  onAddColumn,
  onDropTable,
}: TableSchemaSheetProps) {
  const [newColName, setNewColName] = useState("")
  const [newColType, setNewColType] = useState<DataStoreColumnType>("TEXT")

  const handleAddColumn = useCallback(() => {
    const trimmed = newColName.trim()
    if (!trimmed) return
    onAddColumn(trimmed, newColType)
    setNewColName("")
    setNewColType("TEXT")
  }, [newColName, newColType, onAddColumn])

  if (!schema) return null

  return (
    <Sheet open={open} onOpenChange={onOpenChange}>
      <SheetContent>
        <SheetHeader>
          <SheetTitle>{schema.name} 表结构</SheetTitle>
        </SheetHeader>

        <div className="flex flex-col gap-4 px-4 py-4">
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
                  <TableCell>{col.type}</TableCell>
                  <TableCell className="text-muted-foreground">
                    {col.primaryKey ? "自增主键" : ""}
                  </TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>

          <div className="flex flex-col gap-2">
            <Label>添加列</Label>
            <div className="flex items-center gap-2">
              <Input
                className="flex-1"
                value={newColName}
                onChange={(e) => setNewColName(e.target.value)}
                placeholder="列名"
              />
              <Select value={newColType} onValueChange={(v) => setNewColType(v as DataStoreColumnType)}>
                <SelectTrigger className="w-28">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  {COLUMN_TYPES.map((t) => (
                    <SelectItem key={t} value={t}>{t}</SelectItem>
                  ))}
                </SelectContent>
              </Select>
              <Button size="sm" onClick={handleAddColumn} disabled={!newColName.trim()}>
                添加
              </Button>
            </div>
          </div>
        </div>

        <SheetFooter>
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
        </SheetFooter>
      </SheetContent>
    </Sheet>
  )
}

export { TableSchemaSheet }
