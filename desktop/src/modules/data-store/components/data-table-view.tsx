import {
  Fragment,
  forwardRef,
  useCallback,
  useEffect,
  useImperativeHandle,
  useMemo,
  useRef,
  useState,
} from "react"
import { Funnel, Pencil, SlidersHorizontal, Trash2 } from "lucide-react"
import { toast } from "sonner"
import { Button } from "@/components/ui/button"
import { Menubar } from "@/components/ui/menubar"
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
  DropdownMenuGroup,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu"
import { RowEditor } from "./row-editor"
import type { RowEditorHandle } from "./row-editor"
import { DataTableFilterDialog } from "./data-table-filter-dialog"
import {
  DATA_TABLE_ACTION_COLUMN_WIDTH,
  DATA_TABLE_COLUMN_CLASS,
  DATA_TABLE_ID_COLUMN_WIDTH,
  DATA_TABLE_MIN_VALUE_COLUMN_WIDTH,
  DATA_TABLE_RESIZABLE_HEAD_CLASS,
  DATA_TABLE_STICKY_ACTION_COLUMN_CLASS,
  formatCellValue,
  getColumnWidthStyle,
  getDefaultColumnWidth,
} from "./data-table-layout"
import type { DataStoreColumnInfo, DataStoreTableSchema, DataStoreWhereGroup } from "@/types/data-store"
import { SCHEMA_COPY_FORMATS, SCHEMA_COPY_GROUPS } from "./schema-copy-formats"
import { downloadTableContent, formatTableContent } from "./table-content-formats"
import type { TableContentFormat, TableDownloadFormat } from "./table-content-formats"

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
  filter: DataStoreWhereGroup | null
  onFilterChange: (filter: DataStoreWhereGroup | null) => void
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
    filter,
    onFilterChange,
  },
  ref,
) {
  const [editingId, setEditingId] = useState<number | null>(null)
  const [editingColumnName, setEditingColumnName] = useState<string | null>(null)
  const [isAdding, setIsAdding] = useState(false)
  const [deleteId, setDeleteId] = useState<number | null>(null)
  const [isFilterDialogOpen, setIsFilterDialogOpen] = useState(false)
  const [resizedColumnWidths, setResizedColumnWidths] = useState<Record<string, number>>({})
  const rowEditorRef = useRef<RowEditorHandle | null>(null)

  const editableColumns = useMemo(() => columns.filter((c) => !c.primaryKey && !c.system), [columns])
  const systemTimeColumns = useMemo(() => columns.filter((c) => c.system && !c.primaryKey), [columns])
  const visibleColumns = useMemo(
    () => [...editableColumns, ...systemTimeColumns],
    [editableColumns, systemTimeColumns],
  )
  const columnWidths = useMemo(() => {
    const widths: Record<string, number> = {}
    for (const col of visibleColumns) {
      widths[col.name] = resizedColumnWidths[col.name] ?? getDefaultColumnWidth(col, rows)
    }
    return widths
  }, [resizedColumnWidths, rows, visibleColumns])
  const tableWidth = useMemo(
    () => visibleColumns.reduce(
      (width, col) => width + columnWidths[col.name],
      DATA_TABLE_ID_COLUMN_WIDTH + DATA_TABLE_ACTION_COLUMN_WIDTH,
    ),
    [columnWidths, visibleColumns],
  )
  const totalPages = Math.max(1, Math.ceil(total / pageSize))
  const contentColumns = useMemo(
    () => [{ name: "id", type: "INTEGER" as const }, ...visibleColumns],
    [visibleColumns],
  )
  const tableContentData = useMemo(
    () => ({ tableName, columns: contentColumns, rows }),
    [contentColumns, rows, tableName],
  )
  useEffect(() => {
    setResizedColumnWidths((current) => {
      const visibleColumnNames = new Set(visibleColumns.map((col) => col.name))
      const next: Record<string, number> = {}
      for (const [columnName, width] of Object.entries(current)) {
        if (visibleColumnNames.has(columnName)) {
          next[columnName] = width
        }
      }
      return next
    })
  }, [visibleColumns])

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

  const handleCopyContent = useCallback(
    async (format: TableContentFormat) => {
      await commitPendingChanges()
      await navigator.clipboard.writeText(formatTableContent(tableContentData, format))
      toast(format === "csv" ? "已复制 CSV" : "已复制 Markdown 表格")
    },
    [commitPendingChanges, tableContentData],
  )

  const handleDownloadContent = useCallback(
    async (format: TableDownloadFormat) => {
      await commitPendingChanges()
      downloadTableContent(tableContentData, format)
      toast(format === "csv" ? "已下载 CSV" : "已下载 Excel")
    },
    [commitPendingChanges, tableContentData],
  )

  const handleResizeColumn = useCallback(
    (columnName: string, startClientX: number) => {
      const startWidth = columnWidths[columnName]

      const handlePointerMove = (event: PointerEvent) => {
        const nextWidth = Math.max(
          DATA_TABLE_MIN_VALUE_COLUMN_WIDTH,
          startWidth + event.clientX - startClientX,
        )
        setResizedColumnWidths((current) => ({ ...current, [columnName]: nextWidth }))
      }

      const handlePointerUp = () => {
        document.removeEventListener("pointermove", handlePointerMove)
        document.removeEventListener("pointerup", handlePointerUp)
      }

      document.addEventListener("pointermove", handlePointerMove)
      document.addEventListener("pointerup", handlePointerUp)
    },
    [columnWidths],
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
          <Button
            variant={filter ? "secondary" : "ghost"}
            size="icon"
            className="size-7"
            onClick={() => {
              void commitPendingChanges().finally(() => setIsFilterDialogOpen(true))
            }}
          >
            <Funnel className="size-4" />
            <span className="sr-only">筛选</span>
          </Button>
        </div>
        <Menubar className="w-fit">
          <DropdownMenu>
            <DropdownMenuTrigger asChild>
              <Button type="button" variant="ghost" size="sm" className="rounded-sm px-1.5 font-normal">
                复制结构
              </Button>
            </DropdownMenuTrigger>
            <DropdownMenuContent align="end" className="w-64">
              {SCHEMA_COPY_GROUPS.map((group, groupIndex) => (
                <Fragment key={group.key}>
                  {groupIndex > 0 ? <DropdownMenuSeparator /> : null}
                  <DropdownMenuGroup>
                    <DropdownMenuLabel>{group.label}</DropdownMenuLabel>
                    {group.formats.map((format) => (
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
                  </DropdownMenuGroup>
                </Fragment>
              ))}
            </DropdownMenuContent>
          </DropdownMenu>
          <DropdownMenu>
            <DropdownMenuTrigger asChild>
              <Button type="button" variant="ghost" size="sm" className="rounded-sm px-1.5 font-normal">
                复制内容
              </Button>
            </DropdownMenuTrigger>
            <DropdownMenuContent align="end" className="w-48">
              <DropdownMenuItem
                onSelect={() => {
                  void handleCopyContent("csv")
                }}
              >
                复制为 CSV
              </DropdownMenuItem>
              <DropdownMenuItem
                onSelect={() => {
                  void handleCopyContent("markdown")
                }}
              >
                复制为 Markdown 表格
              </DropdownMenuItem>
            </DropdownMenuContent>
          </DropdownMenu>
          <DropdownMenu>
            <DropdownMenuTrigger asChild>
              <Button type="button" variant="ghost" size="sm" className="rounded-sm px-1.5 font-normal">
                下载
              </Button>
            </DropdownMenuTrigger>
            <DropdownMenuContent align="end" className="w-40">
              <DropdownMenuItem
                onSelect={() => {
                  void handleDownloadContent("csv")
                }}
              >
                下载为 CSV
              </DropdownMenuItem>
              <DropdownMenuItem
                onSelect={() => {
                  void handleDownloadContent("xlsx")
                }}
              >
                下载为 XLSX
              </DropdownMenuItem>
            </DropdownMenuContent>
          </DropdownMenu>
          <Button
            type="button"
            variant="ghost"
            size="sm"
            className="rounded-sm px-1.5"
            onClick={() => {
              void handleStartAdding().catch(() => {})
            }}
            disabled={isAdding}
          >
            新增行
          </Button>
        </Menubar>
      </div>

      <div className="min-h-0 flex-1 overflow-auto rounded-md border">
        <Table
          className="table-fixed text-xs [&_td]:px-3 [&_td]:py-1 [&_th]:h-7 [&_th]:px-3"
          style={{ width: tableWidth }}
        >
          <colgroup>
            <col style={getColumnWidthStyle(DATA_TABLE_ID_COLUMN_WIDTH)} />
            {visibleColumns.map((col) => (
              <col key={col.name} style={getColumnWidthStyle(columnWidths[col.name])} />
            ))}
            <col style={getColumnWidthStyle(DATA_TABLE_ACTION_COLUMN_WIDTH)} />
          </colgroup>
          <TableHeader>
            <TableRow className="hover:bg-transparent">
              <TableHead
                className={`${DATA_TABLE_COLUMN_CLASS} text-xs font-medium text-muted-foreground`}
              >
                id
              </TableHead>
              {editableColumns.map((col) => (
                <TableHead
                  key={col.name}
                  className={`${DATA_TABLE_COLUMN_CLASS} ${DATA_TABLE_RESIZABLE_HEAD_CLASS} text-xs font-medium text-muted-foreground`}
                >
                  <span className="truncate pr-2">{col.name}</span>
                  <button
                    type="button"
                    aria-label={`调整 ${col.name} 列宽`}
                    className="absolute inset-y-1 right-0 w-2 cursor-col-resize border-r border-border"
                    onPointerDown={(event) => {
                      event.preventDefault()
                      handleResizeColumn(col.name, event.clientX)
                    }}
                  />
                </TableHead>
              ))}
              {systemTimeColumns.map((col) => (
                <TableHead
                  key={col.name}
                  className={`${DATA_TABLE_COLUMN_CLASS} ${DATA_TABLE_RESIZABLE_HEAD_CLASS} text-xs font-medium text-muted-foreground`}
                >
                  <span className="truncate pr-2">{col.name}</span>
                  <button
                    type="button"
                    aria-label={`调整 ${col.name} 列宽`}
                    className="absolute inset-y-1 right-0 w-2 cursor-col-resize border-r border-border"
                    onPointerDown={(event) => {
                      event.preventDefault()
                      handleResizeColumn(col.name, event.clientX)
                    }}
                  />
                </TableHead>
              ))}
              <TableHead className={DATA_TABLE_STICKY_ACTION_COLUMN_CLASS} />
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
                    className={`${DATA_TABLE_COLUMN_CLASS} font-mono text-muted-foreground`}
                  >
                    {rowId}
                  </TableCell>
                  {editableColumns.map((col) => (
                    <TableCell
                      key={col.name}
                      className={`${DATA_TABLE_COLUMN_CLASS} truncate`}
                      onDoubleClick={() => {
                        void beginRowEdit(rowId, col.name).catch(() => {})
                      }}
                    >
                      {formatCellValue(row[col.name], col.type, col.name)}
                    </TableCell>
                  ))}
                  {systemTimeColumns.map((col) => (
                    <TableCell
                      key={col.name}
                      className={`${DATA_TABLE_COLUMN_CLASS} truncate font-mono text-muted-foreground`}
                    >
                      {formatCellValue(row[col.name], col.type, col.name)}
                    </TableCell>
                  ))}
                  <TableCell className={`${DATA_TABLE_STICKY_ACTION_COLUMN_CLASS} py-0.5`}>
                    <div className="flex items-center gap-1">
                      <Button
                        variant="ghost"
                        size="icon-xs"
                        className="rounded-sm"
                        onClick={() => {
                          void beginRowEdit(rowId, editableColumns[0]?.name ?? null).catch(() => {})
                        }}
                      >
                        <Pencil className="size-3" />
                      </Button>
                      <Button
                        variant="ghost"
                        size="icon-xs"
                        className="rounded-sm"
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
                <TableCell colSpan={1 + editableColumns.length + systemTimeColumns.length + 1} className="h-20 text-center text-muted-foreground">
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

      <DataTableFilterDialog
        open={isFilterDialogOpen}
        onOpenChange={setIsFilterDialogOpen}
        columns={columns}
        value={filter}
        onApply={onFilterChange}
      />
    </div>
  )
})

export { DataTableView }
export type { DataTableViewHandle }
