import {
  forwardRef,
  useCallback,
  useImperativeHandle,
  useRef,
  useState,
} from "react"
import { ClipboardCopy, Pencil, Plus, SlidersHorizontal, Trash2 } from "lucide-react"
import { toast } from "sonner"
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
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu"
import { RowEditor } from "./row-editor"
import type { RowEditorHandle } from "./row-editor"
import {
  DATA_TABLE_ACTION_COLUMN_CLASS,
  DATA_TABLE_ID_COLUMN_CLASS,
  DATA_TABLE_VALUE_COLUMN_CLASS,
} from "./data-table-layout"
import type { DataStoreColumnInfo, DataStoreTableSchema } from "@/types/data-store"
import { SCHEMA_COPY_FORMATS } from "./schema-copy-formats"

type DataTableViewProps = {
  tableName: string
  columns: DataStoreColumnInfo[]
  schema: DataStoreTableSchema | null
  rows: Record<string, unknown>[]
  total: number
  page: number
  pageSize: number
  onPageChange: (page: number) => void
  onInsert: (data: Record<string, unknown>) => Promise<void> | void
  onUpdate: (id: number, data: Record<string, unknown>) => Promise<void> | void
  onDelete: (id: number) => void
  onShowSchema: () => void
}

type DataTableViewHandle = {
  commitPendingChanges: () => Promise<void>
}

const DataTableView = forwardRef<DataTableViewHandle, DataTableViewProps>(function DataTableView(
  {
    tableName,
    columns,
    schema,
    rows,
    total,
    page,
    pageSize,
    onPageChange,
    onInsert,
    onUpdate,
    onDelete,
    onShowSchema,
  },
  ref,
) {
  const [editingId, setEditingId] = useState<number | null>(null)
  const [editingColumnName, setEditingColumnName] = useState<string | null>(null)
  const [isAdding, setIsAdding] = useState(false)
  const [deleteId, setDeleteId] = useState<number | null>(null)
  const rowEditorRef = useRef<RowEditorHandle | null>(null)

  const editableColumns = columns.filter((c) => !c.primaryKey)
  const totalPages = Math.max(1, Math.ceil(total / pageSize))

  const handleSaveEdit = useCallback(
    async (data: Record<string, unknown>) => {
      if (editingId != null) {
        await onUpdate(editingId, data)
        setEditingId(null)
        setEditingColumnName(null)
      }
    },
    [editingId, onUpdate],
  )

  const handleSaveNew = useCallback(
    async (data: Record<string, unknown>) => {
      await onInsert(data)
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

  const commitPendingChanges = useCallback(async () => {
    if (editingId != null || isAdding) {
      await rowEditorRef.current?.save()
    }
  }, [editingId, isAdding])

  useImperativeHandle(ref, () => ({ commitPendingChanges }), [commitPendingChanges])

  const beginRowEdit = useCallback(
    async (rowId: number, columnName: string | null) => {
      if ((editingId != null && editingId !== rowId) || isAdding) {
        await commitPendingChanges()
      }

      setEditingId(rowId)
      setEditingColumnName(columnName)
    },
    [commitPendingChanges, editingId, isAdding],
  )

  const handlePageChange = useCallback(
    async (nextPage: number) => {
      if (nextPage === page) {
        return
      }

      await commitPendingChanges()
      onPageChange(nextPage)
    },
    [commitPendingChanges, onPageChange, page],
  )

  const handleShowSchema = useCallback(async () => {
    await commitPendingChanges()
    onShowSchema()
  }, [commitPendingChanges, onShowSchema])

  const handleStartAdding = useCallback(async () => {
    if (isAdding) {
      return
    }

    await commitPendingChanges()
    setIsAdding(true)
  }, [commitPendingChanges, isAdding])

  const handleCopySchema = useCallback(
    async (formatKey: string) => {
      if (!schema) return
      const format = SCHEMA_COPY_FORMATS.find((f) => f.key === formatKey)
      if (!format) return
      const text = format.generate(schema)
      await navigator.clipboard.writeText(text)
      toast(`已复制 ${format.label}`)
    },
    [schema],
  )

  return (
    <div className="flex h-full flex-col gap-2.5">
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-2">
          <h2 className="text-lg font-semibold">{tableName}</h2>
          <Button
            variant="ghost"
            size="icon"
            className="size-7"
            onClick={() => {
              void handleShowSchema().catch(() => {})
            }}
          >
            <SlidersHorizontal className="size-4" />
          </Button>
        </div>
        <div className="flex items-center gap-2">
          <DropdownMenu>
            <DropdownMenuTrigger asChild>
              <Button variant="outline" size="sm">
                <ClipboardCopy className="mr-1 size-4" />
                复制结构
              </Button>
            </DropdownMenuTrigger>
            <DropdownMenuContent align="end" className="w-64">
              {SCHEMA_COPY_FORMATS.map((format) => (
                <DropdownMenuItem
                  key={format.key}
                  onSelect={() => {
                    void handleCopySchema(format.key)
                  }}
                >
                  <span className="flex flex-col">
                    <span>{format.label}</span>
                    <span className="text-xs text-muted-foreground">{format.description}</span>
                  </span>
                </DropdownMenuItem>
              ))}
            </DropdownMenuContent>
          </DropdownMenu>
          <Button
            variant="outline"
            size="sm"
            onClick={() => {
              void handleStartAdding().catch(() => {})
            }}
            disabled={isAdding}
          >
            <Plus className="mr-1 size-4" />
            新增行
          </Button>
        </div>
      </div>

      <div className="min-h-0 flex-1 overflow-auto rounded-md border">
        <Table className="table-fixed text-xs [&_td]:px-3 [&_td]:py-1 [&_th]:h-7 [&_th]:px-3">
          <TableHeader>
            <TableRow className="hover:bg-transparent">
              <TableHead
                className={`${DATA_TABLE_ID_COLUMN_CLASS} text-xs font-medium text-muted-foreground`}
              >
                id
              </TableHead>
              {editableColumns.map((col) => (
                <TableHead
                  key={col.name}
                  className={`${DATA_TABLE_VALUE_COLUMN_CLASS} text-xs font-medium text-muted-foreground`}
                >
                  {col.name}
                </TableHead>
              ))}
              <TableHead className={DATA_TABLE_ACTION_COLUMN_CLASS} />
            </TableRow>
          </TableHeader>
          <TableBody className="[&_tr:last-child]:border-b">
            {rows.map((row) => {
              const rowId = row.id as number

              if (editingId === rowId) {
                return (
                  <RowEditor
                    ref={rowEditorRef}
                    key={rowId}
                    columns={columns}
                    initialData={row}
                    initialFocusColumnName={editingColumnName}
                    onSave={handleSaveEdit}
                    onCancel={() => {
                      setEditingId(null)
                      setEditingColumnName(null)
                    }}
                  />
                )
              }

              return (
                <TableRow key={rowId}>
                  <TableCell
                    className={`${DATA_TABLE_ID_COLUMN_CLASS} font-mono text-muted-foreground`}
                  >
                    {rowId}
                  </TableCell>
                  {editableColumns.map((col) => (
                    <TableCell
                      key={col.name}
                      className={`${DATA_TABLE_VALUE_COLUMN_CLASS} truncate`}
                      onDoubleClick={() => {
                        void beginRowEdit(rowId, col.name).catch(() => {})
                      }}
                    >
                      {formatCellValue(row[col.name])}
                    </TableCell>
                  ))}
                  <TableCell className={`${DATA_TABLE_ACTION_COLUMN_CLASS} py-0.5`}>
                    <div className="flex items-center gap-0.5">
                      <Button
                        variant="ghost"
                        size="icon"
                        className="size-6"
                        onClick={() => {
                          void beginRowEdit(rowId, editableColumns[0]?.name ?? null).catch(() => {})
                        }}
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
                initialFocusColumnName={editableColumns[0]?.name ?? null}
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
          onClick={() => {
            void handlePageChange(page - 1).catch(() => {})
          }}
        >
          ◂
        </Button>
        <span>{page} / {totalPages}</span>
        <Button
          variant="outline"
          size="sm"
          disabled={page >= totalPages}
          onClick={() => {
            void handlePageChange(page + 1).catch(() => {})
          }}
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
})

function formatCellValue(value: unknown): string {
  if (value == null) return ""
  if (typeof value === "object") return JSON.stringify(value)
  return String(value)
}

export { DataTableView }
export type { DataTableViewHandle }
