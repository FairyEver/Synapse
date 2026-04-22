import { useCallback, useState } from "react"
import { Pencil, Plus, SlidersHorizontal, Trash2 } from "lucide-react"
import { Button } from "@/components/ui/button"
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
} from "@/components/ui/alert-dialog"
import { RowEditor } from "./row-editor"
import type { DataStoreColumnInfo } from "@/types/data-store"

type DataTableViewProps = {
  tableName: string
  columns: DataStoreColumnInfo[]
  rows: Record<string, unknown>[]
  total: number
  page: number
  pageSize: number
  onPageChange: (page: number) => void
  onInsert: (data: Record<string, unknown>) => void
  onUpdate: (id: number, data: Record<string, unknown>) => void
  onDelete: (id: number) => void
  onShowSchema: () => void
}

function DataTableView({
  tableName,
  columns,
  rows,
  total,
  page,
  pageSize,
  onPageChange,
  onInsert,
  onUpdate,
  onDelete,
  onShowSchema,
}: DataTableViewProps) {
  const [editingId, setEditingId] = useState<number | null>(null)
  const [isAdding, setIsAdding] = useState(false)
  const [deleteId, setDeleteId] = useState<number | null>(null)

  const editableColumns = columns.filter((c) => !c.primaryKey)
  const totalPages = Math.max(1, Math.ceil(total / pageSize))

  const handleSaveEdit = useCallback(
    (data: Record<string, unknown>) => {
      if (editingId != null) {
        onUpdate(editingId, data)
        setEditingId(null)
      }
    },
    [editingId, onUpdate],
  )

  const handleSaveNew = useCallback(
    (data: Record<string, unknown>) => {
      onInsert(data)
      setIsAdding(false)
    },
    [onInsert],
  )

  const handleConfirmDelete = useCallback(() => {
    if (deleteId != null) {
      onDelete(deleteId)
      setDeleteId(null)
    }
  }, [deleteId, onDelete])

  return (
    <div className="flex h-full flex-col gap-3">
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-2">
          <h2 className="text-lg font-semibold">{tableName}</h2>
          <Button variant="ghost" size="icon" className="size-7" onClick={onShowSchema}>
            <SlidersHorizontal className="size-4" />
          </Button>
        </div>
        <Button variant="outline" size="sm" onClick={() => setIsAdding(true)} disabled={isAdding}>
          <Plus className="mr-1 size-4" />
          新增行
        </Button>
      </div>

      <div className="min-h-0 flex-1 overflow-auto rounded-lg border">
        <Table className="text-xs [&_td]:px-3 [&_td]:py-1 [&_th]:h-7 [&_th]:px-3">
          <TableHeader>
            <TableRow className="hover:bg-transparent">
              <TableHead className="w-14 text-xs font-medium text-muted-foreground">id</TableHead>
              {editableColumns.map((col) => (
                <TableHead key={col.name} className="text-xs font-medium text-muted-foreground">
                  {col.name}
                </TableHead>
              ))}
              <TableHead className="w-16" />
            </TableRow>
          </TableHeader>
          <TableBody>
            {rows.map((row) => {
              const rowId = row.id as number

              if (editingId === rowId) {
                return (
                  <RowEditor
                    key={rowId}
                    columns={columns}
                    initialData={row}
                    onSave={handleSaveEdit}
                    onCancel={() => setEditingId(null)}
                  />
                )
              }

              return (
                <TableRow key={rowId} className="group">
                  <TableCell className="font-mono text-muted-foreground">{rowId}</TableCell>
                  {editableColumns.map((col) => (
                    <TableCell key={col.name} className="max-w-48 truncate">
                      {formatCellValue(row[col.name])}
                    </TableCell>
                  ))}
                  <TableCell className="py-0.5">
                    <div className="flex items-center gap-0.5 opacity-0 transition-opacity group-hover:opacity-100">
                      <Button
                        variant="ghost"
                        size="icon"
                        className="size-6"
                        onClick={() => setEditingId(rowId)}
                      >
                        <Pencil className="size-3" />
                      </Button>
                      <Button
                        variant="ghost"
                        size="icon"
                        className="size-6"
                        onClick={() => setDeleteId(rowId)}
                      >
                        <Trash2 className="size-3" />
                      </Button>
                    </div>
                  </TableCell>
                </TableRow>
              )
            })}

            {isAdding ? (
              <RowEditor
                columns={columns}
                onSave={handleSaveNew}
                onCancel={() => setIsAdding(false)}
              />
            ) : null}

            {rows.length === 0 && !isAdding ? (
              <TableRow>
                <TableCell colSpan={columns.length + 1} className="h-20 text-center text-muted-foreground">
                  暂无数据
                </TableCell>
              </TableRow>
            ) : null}
          </TableBody>
        </Table>
      </div>

      <div className="flex items-center justify-end gap-2 text-sm text-muted-foreground">
        <Button
          variant="outline"
          size="sm"
          disabled={page <= 1}
          onClick={() => onPageChange(page - 1)}
        >
          ◂
        </Button>
        <span>{page} / {totalPages}</span>
        <Button
          variant="outline"
          size="sm"
          disabled={page >= totalPages}
          onClick={() => onPageChange(page + 1)}
        >
          ▸
        </Button>
        <span className="ml-2">共 {total} 条</span>
      </div>

      <AlertDialog open={deleteId != null} onOpenChange={(open) => { if (!open) setDeleteId(null) }}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>确认删除</AlertDialogTitle>
            <AlertDialogDescription>
              确定要删除 id={deleteId} 的记录吗？此操作不可撤销。
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>取消</AlertDialogCancel>
            <AlertDialogAction onClick={handleConfirmDelete}>删除</AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </div>
  )
}

function formatCellValue(value: unknown): string {
  if (value == null) return ""
  if (typeof value === "object") return JSON.stringify(value)
  return String(value)
}

export { DataTableView }
