import {
  Fragment,
  forwardRef,
  useCallback,
  useEffect,
  useImperativeHandle,
  useMemo,
  useRef,
  useState,
  type MouseEvent,
  type Ref,
} from "react"
import { FileOutput, Funnel, Pencil, SlidersHorizontal, Trash2 } from "lucide-react"
import { toast } from "sonner"
import { Button } from "@/components/ui/button"
import { Menubar } from "@/components/ui/menubar"
import {
  Tooltip,
  TooltipContent,
  TooltipProvider,
  TooltipTrigger,
} from "@/components/ui/tooltip"
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table"
import { ScrollArea } from "@/components/ui/scroll-area"
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
import { createRendererLogger } from "@/app-shell/logging"
import { shouldBypassDeleteConfirm } from "@/lib/delete-confirm-bypass"
import {
  debounce,
  sanitizeTrackRecord,
  sanitizeTrackValue,
  track,
} from "@/lib/ui-tracking"
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
import type { Column, DatabaseTableSchema, DatabaseWhereGroup } from "@/types/database"
import { SCHEMA_COPY_FORMATS, SCHEMA_COPY_GROUPS } from "./schema-copy-formats"
import { downloadTableContent, formatTableContent } from "./table-content-formats"
import type { TableContentFormat, TableDownloadFormat } from "./table-content-formats"

const logger = createRendererLogger("database.table")

type DataTableViewProps = {
  tableName: string
  columns: Column[]
  schema: DatabaseTableSchema | null
  rows: Record<string, unknown>[]
  total: number
  page: number
  pageSize: number
  onPageChange: (page: number) => void
  onInsert: (data: Record<string, unknown>) => Promise<void> | void
  onUpdate: (id: number, data: Record<string, unknown>) => Promise<void> | void
  onDelete: (id: number) => void
  onShowSchema: () => void
  onExportTable: () => Promise<void> | void
  filter: DatabaseWhereGroup | null
  onFilterChange: (filter: DatabaseWhereGroup | null) => void
  schemaButtonRef?: Ref<HTMLButtonElement>
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
    onExportTable,
    filter,
    onFilterChange,
    schemaButtonRef,
  },
  ref,
) {
  const [editingId, setEditingId] = useState<number | null>(null)
  const [editingColumnName, setEditingColumnName] = useState<string | null>(null)
  const [isAdding, setIsAdding] = useState(false)
  const [deleteId, setDeleteId] = useState<number | null>(null)
  const [isFilterDialogOpen, setIsFilterDialogOpen] = useState(false)
  const [shouldRestoreAddRowFocus, setShouldRestoreAddRowFocus] = useState(false)
  const [resizedColumnWidths, setResizedColumnWidths] = useState<Record<string, number>>({})
  const rowEditorRef = useRef<RowEditorHandle | null>(null)
  const addRowButtonRef = useRef<HTMLButtonElement | null>(null)
  const filterButtonRef = useRef<HTMLButtonElement | null>(null)
  const deleteTriggerRef = useRef<HTMLElement | null>(null)
  const logTableScroll = useMemo(
    () => debounce((snapshot: {
      clientHeight: number
      direction: "down" | "up"
      percent: number
      scrollHeight: number
      scrollTop: number
    }) => {
      logger.info("Table scrolled.", {
        table: tableName,
        ...snapshot,
      })
    }, 500),
    [tableName],
  )
  const lastTableScrollTopRef = useRef(0)
  const resizePointerMoveRef = useRef<((e: PointerEvent) => void) | null>(null)
  const resizePointerUpRef = useRef<((e: PointerEvent) => void) | null>(null)

  const editableColumns = useMemo(() => columns.filter((c) => !c.primaryKey && !c.system), [columns])
  const systemTimeColumns = useMemo(() => columns.filter((c) => c.system && !c.primaryKey), [columns])
  const visibleColumns = useMemo(
    () => [...editableColumns, ...systemTimeColumns],
    [editableColumns, systemTimeColumns],
  )
  const columnWidths = useMemo(() => {
    const widths: Record<string, number> = {}
    for (const col of visibleColumns) {
      widths[col.name] = resizedColumnWidths[col.name] ?? getDefaultColumnWidth(col)
    }
    return widths
  }, [resizedColumnWidths, visibleColumns])
  const tableWidth = useMemo(
    () => visibleColumns.reduce(
      (width, col) => width + columnWidths[col.name],
      DATA_TABLE_ID_COLUMN_WIDTH + DATA_TABLE_ACTION_COLUMN_WIDTH,
    ),
    [columnWidths, visibleColumns],
  )
  const totalPages = Math.max(1, Math.ceil(total / pageSize))
  const contentColumns = useMemo(
    () => [{ name: "id", kind: "integer" as const }, ...visibleColumns],
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

  useEffect(() => {
    return () => {
      if (resizePointerMoveRef.current) {
        document.removeEventListener("pointermove", resizePointerMoveRef.current)
      }
      if (resizePointerUpRef.current) {
        document.removeEventListener("pointerup", resizePointerUpRef.current)
      }
    }
  }, [])

  const restoreAddRowFocus = useCallback(() => {
    setShouldRestoreAddRowFocus(true)
  }, [])

  useEffect(() => {
    if (!shouldRestoreAddRowFocus || isAdding || editingId != null) {
      return
    }
    addRowButtonRef.current?.focus()
    setShouldRestoreAddRowFocus(false)
  }, [editingId, isAdding, shouldRestoreAddRowFocus])

  const handleSaveEdit = useCallback(
    async (data: Record<string, unknown>) => {
      if (editingId != null) {
        await onUpdate(editingId, data)
        logger.info("Row edit saved.", {
          table: tableName,
          rowId: editingId,
          changedColumns: Object.keys(data),
          values: sanitizeTrackRecord(data),
        })
        setEditingId(null)
        setEditingColumnName(null)
        restoreAddRowFocus()
      }
    },
    [editingId, onUpdate, restoreAddRowFocus, tableName],
  )

  const handleSaveNew = useCallback(
    async (data: Record<string, unknown>) => {
      await onInsert(data)
      logger.info("Row insert saved.", {
        table: tableName,
        columns: Object.keys(data),
        values: sanitizeTrackRecord(data),
      })
      setIsAdding(false)
      restoreAddRowFocus()
    },
    [onInsert, restoreAddRowFocus, tableName],
  )

  const deleteRow = useCallback(async (targetId: number) => {
      logger.info("Row delete confirmed.", {
        table: tableName,
        rowId: targetId,
      })
      try {
        await onDelete(targetId)
        setDeleteId(null)
        restoreAddRowFocus()
      } catch {
        // Dialog stays open on failure for retry
      }
  }, [onDelete, restoreAddRowFocus, tableName])

  const handleConfirmDelete = useCallback(async () => {
    if (deleteId != null) {
      await deleteRow(deleteId)
    }
  }, [deleteId, deleteRow])

  const handleDeleteStart = useCallback((rowId: number, event: MouseEvent<HTMLElement>) => {
    if (shouldBypassDeleteConfirm(event)) {
      void deleteRow(rowId)
      return
    }
    deleteTriggerRef.current = event.currentTarget
    setDeleteId(rowId)
  }, [deleteRow])

  const commitPendingChanges = useCallback(async () => {
    if (editingId != null || isAdding) {
      await rowEditorRef.current?.save()
    }
  }, [editingId, isAdding])

  useImperativeHandle(ref, () => ({ commitPendingChanges }), [commitPendingChanges])

  const beginRowEdit = useCallback(
    async (rowId: number, columnName: string | null, source: "button" | "cell") => {
      if ((editingId != null && editingId !== rowId) || isAdding) {
        await commitPendingChanges()
      }

      logger.info("Row edit started.", {
        table: tableName,
        rowId,
        column: columnName,
        source,
      })
      setEditingId(rowId)
      setEditingColumnName(columnName)
    },
    [commitPendingChanges, editingId, isAdding, tableName],
  )

  const handlePageChange = useCallback(
    async (nextPage: number) => {
      if (nextPage === page) {
        return
      }

      await commitPendingChanges()
      logger.info("Page changed.", {
        table: tableName,
        from: page,
        to: nextPage,
        totalPages,
      })
      onPageChange(nextPage)
    },
    [commitPendingChanges, onPageChange, page, tableName, totalPages],
  )

  const handleShowSchema = useCallback(async () => {
    await commitPendingChanges()
    logger.info("Schema dialog opened from table view.", {
      table: tableName,
    })
    onShowSchema()
  }, [commitPendingChanges, onShowSchema, tableName])

  const handleExportTable = useCallback(async () => {
    await commitPendingChanges()
    logger.info("Table export requested from table view.", {
      table: tableName,
    })
    await onExportTable()
  }, [commitPendingChanges, onExportTable, tableName])

  const handleOpenFilterDialog = useCallback(async () => {
    await commitPendingChanges()
    logger.info("Filter dialog opened from table view.", {
      table: tableName,
      active: filter !== null,
    })
    setIsFilterDialogOpen(true)
  }, [commitPendingChanges, filter, tableName])

  const handleStartAdding = useCallback(async () => {
    if (isAdding) {
      return
    }

    await commitPendingChanges()
    logger.info("Row insert started.", {
      table: tableName,
    })
    setIsAdding(true)
  }, [commitPendingChanges, isAdding, tableName])

  const handleCopySchema = useCallback(
    async (formatKey: string) => {
      if (!schema) return
      const format = SCHEMA_COPY_FORMATS.find((f) => f.key === formatKey)
      if (!format) return
      const text = format.generate(schema)
      await navigator.clipboard.writeText(text)
      logger.info("Schema copied.", {
        table: tableName,
        format: formatKey,
        columnCount: schema.columns.length,
      })
      toast(`已复制 ${format.label}`)
    },
    [schema, tableName],
  )

  const handleCopyContent = useCallback(
    async (format: TableContentFormat) => {
      try {
        await commitPendingChanges()
        await navigator.clipboard.writeText(formatTableContent(tableContentData, format))
        logger.info("Table content copied.", {
          table: tableName,
          format,
          rowCount: rows.length,
          columnCount: contentColumns.length,
        })
        toast(format === "csv" ? "已复制 CSV" : "已复制 Markdown 表格")
      } catch (error) {
        logger.error("Failed to copy table content.", { error, table: tableName, format })
        toast("复制失败。")
      }
    },
    [commitPendingChanges, contentColumns.length, rows.length, tableContentData, tableName],
  )

  const handleDownloadContent = useCallback(
    async (format: TableDownloadFormat) => {
      try {
        await commitPendingChanges()
        downloadTableContent(tableContentData, format)
        logger.info("Table content downloaded.", {
          table: tableName,
          format,
          rowCount: rows.length,
          columnCount: contentColumns.length,
        })
        toast(format === "csv" ? "已下载 CSV" : "已下载 Excel")
      } catch (error) {
        logger.error("Failed to download table content.", { error, table: tableName, format })
        toast("下载失败。")
      }
    },
    [commitPendingChanges, contentColumns.length, rows.length, tableContentData, tableName],
  )

  const handleFilterChange = useCallback(
    (nextFilter: DatabaseWhereGroup | null) => {
      logger.info("Filter changed.", {
        table: tableName,
        active: nextFilter !== null,
        combinator: nextFilter?.combinator ?? null,
        conditions: nextFilter?.conditions.map((condition) => ({
          field: condition.field,
          op: condition.op,
          value: sanitizeTrackValue(condition.field, condition.value),
        })) ?? [],
      })
      onFilterChange(nextFilter)
    },
    [onFilterChange, tableName],
  )

  const handleResizeColumn = useCallback(
    (columnName: string, startClientX: number) => {
      if (resizePointerMoveRef.current) {
        document.removeEventListener("pointermove", resizePointerMoveRef.current)
      }
      if (resizePointerUpRef.current) {
        document.removeEventListener("pointerup", resizePointerUpRef.current)
      }
      const startWidth = columnWidths[columnName]
      let nextWidth = startWidth

      const handlePointerMove = (event: PointerEvent) => {
        nextWidth = Math.max(
          DATA_TABLE_MIN_VALUE_COLUMN_WIDTH,
          startWidth + event.clientX - startClientX,
        )
        setResizedColumnWidths((current) => ({ ...current, [columnName]: nextWidth }))
      }

      const handlePointerUp = () => {
        document.removeEventListener("pointermove", handlePointerMove)
        document.removeEventListener("pointerup", handlePointerUp)
        resizePointerMoveRef.current = null
        resizePointerUpRef.current = null
        logger.info("Column resized.", {
          table: tableName,
          column: columnName,
          from: startWidth,
          to: nextWidth,
        })
        track({
          component: "database",
          name: "database.column.resize",
          action: "resize",
          eventKey: "database.column.resize",
        })
      }

      resizePointerMoveRef.current = handlePointerMove
      resizePointerUpRef.current = handlePointerUp

      document.addEventListener("pointermove", handlePointerMove)
      document.addEventListener("pointerup", handlePointerUp)
    },
    [columnWidths, tableName],
  )

  return (
    <div className="flex h-full min-h-0 flex-col">
      <div className="flex shrink-0 flex-wrap items-center justify-between gap-2 px-2 py-2.5">
        <div className="flex items-center gap-2">
          <h2 className="text-lg font-semibold">{tableName}</h2>
          <Button
            ref={schemaButtonRef}
            variant="ghost"
            size="icon"
            className="size-7"
            aria-label="表结构"
            data-track="database-schema-open"
            onClick={() => {
              void handleShowSchema().catch((error) => {
                logger.warn("Show schema failed.", { error })
              })
            }}
          >
            <SlidersHorizontal className="size-4" />
          </Button>
          <Button
            ref={filterButtonRef}
            variant={filter ? "secondary" : "ghost"}
            size="icon"
            className="size-7"
            data-track="database-filter-open"
            onClick={() => {
              void handleOpenFilterDialog().catch((error) => {
                logger.warn("Open filter dialog failed.", { error })
              })
            }}
          >
            <Funnel className="size-4" />
            <span className="sr-only">筛选</span>
          </Button>
          <TooltipProvider>
            <Tooltip>
              <TooltipTrigger asChild>
                <Button
                  type="button"
                  variant="ghost"
                  size="icon-sm"
                  aria-label="导出表"
                  data-track="database-table-export"
                  onClick={() => {
                    void handleExportTable().catch((error) => {
                      toast(error instanceof Error ? error.message : "导出失败")
                    })
                  }}
                >
                  <FileOutput />
                </Button>
              </TooltipTrigger>
              <TooltipContent>导出表</TooltipContent>
            </Tooltip>
          </TooltipProvider>
        </div>
        <Menubar className="w-fit">
          <DropdownMenu data-track="database-copy-schema-menu">
            <DropdownMenuTrigger asChild>
              <Button type="button" variant="ghost" size="sm" className="rounded-sm px-1.5 font-normal" data-track="database-copy-schema-menu">
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
                        data-track="database-copy-schema-format"
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
          <DropdownMenu data-track="database-copy-content-menu">
            <DropdownMenuTrigger asChild>
              <Button type="button" variant="ghost" size="sm" className="rounded-sm px-1.5 font-normal" data-track="database-copy-content-menu">
                复制内容
              </Button>
            </DropdownMenuTrigger>
            <DropdownMenuContent align="end" className="w-48">
              <DropdownMenuItem
                data-track="database-copy-content-csv"
                onSelect={() => {
                  void handleCopyContent("csv")
                }}
              >
                复制为 CSV（当前页）
              </DropdownMenuItem>
              <DropdownMenuItem
                data-track="database-copy-content-markdown"
                onSelect={() => {
                  void handleCopyContent("markdown")
                }}
              >
                复制为 Markdown 表格（当前页）
              </DropdownMenuItem>
            </DropdownMenuContent>
          </DropdownMenu>
          <DropdownMenu data-track="database-download-menu">
            <DropdownMenuTrigger asChild>
              <Button type="button" variant="ghost" size="sm" className="rounded-sm px-1.5 font-normal" data-track="database-download-menu">
                下载
              </Button>
            </DropdownMenuTrigger>
            <DropdownMenuContent align="end" className="w-40">
              <DropdownMenuItem
                data-track="database-download-csv"
                onSelect={() => {
                  void handleDownloadContent("csv")
                }}
              >
                下载为 CSV（当前页）
              </DropdownMenuItem>
              <DropdownMenuItem
                data-track="database-download-xlsx"
                onSelect={() => {
                  void handleDownloadContent("xlsx")
                }}
              >
                下载为 XLSX（当前页）
              </DropdownMenuItem>
            </DropdownMenuContent>
          </DropdownMenu>
          <Button
            ref={addRowButtonRef}
            type="button"
            variant="ghost"
            size="sm"
            className="rounded-sm px-1.5"
            data-track="database-row-add-start"
            onClick={() => {
              void handleStartAdding().catch((error) => {
                logger.warn("Start adding row failed.", { error })
              })
            }}
            disabled={isAdding}
          >
            新增行
          </Button>
        </Menubar>
      </div>

      <div className="min-h-0 flex-1 px-2 pb-2 pt-0">
        <div className="flex h-full min-h-0 flex-col gap-2">
          <ScrollArea
            className="min-h-0 flex-1 rounded-lg bg-card"
            data-track="database-table-scroll"
            scrollbars="both"
            trackScroll={false}
            onViewportScroll={(event) => {
              const target = event.currentTarget
              const scrollTop = target.scrollTop
              const scrollable = Math.max(1, target.scrollHeight - target.clientHeight)
              const direction = scrollTop >= lastTableScrollTopRef.current ? "down" : "up"
              lastTableScrollTopRef.current = scrollTop
              logTableScroll({
                clientHeight: target.clientHeight,
                direction,
                percent: Math.round((scrollTop / scrollable) * 100),
                scrollHeight: target.scrollHeight,
                scrollTop,
              })
            }}
          >
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
                    data-track="database-column-resize"
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
                    data-track="database-column-resize"
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
                      restoreAddRowFocus()
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
                        void beginRowEdit(rowId, col.name, "cell").catch((error) => {
                          logger.warn("Begin row edit (cell) failed.", { error })
                        })
                      }}
                    >
                      {formatCellValue(row[col.name], col.kind, col.name)}
                    </TableCell>
                  ))}
                  {systemTimeColumns.map((col) => (
                    <TableCell
                      key={col.name}
                      className={`${DATA_TABLE_COLUMN_CLASS} truncate font-mono text-muted-foreground`}
                    >
                      {formatCellValue(row[col.name], col.kind, col.name)}
                    </TableCell>
                  ))}
                  <TableCell className={`${DATA_TABLE_STICKY_ACTION_COLUMN_CLASS} py-0.5`}>
                    <div className="flex items-center gap-1">
                      <Button
                        variant="ghost"
                        size="icon-xs"
                        className="rounded-sm"
                        aria-label="编辑行"
                        data-track="database-row-edit-start"
                        onClick={() => {
                          void beginRowEdit(rowId, editableColumns[0]?.name ?? null, "button").catch((error) => {
                            logger.warn("Begin row edit (button) failed.", { error })
                          })
                        }}
                      >
                        <Pencil className="size-3" />
                      </Button>
                      <Button
                        variant="ghost"
                        size="icon-xs"
                        className="rounded-sm"
                        aria-label="删除行"
                        data-track="database-row-delete-open"
                        onClick={(event) => handleDeleteStart(rowId, event)}
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
                onCancel={() => {
                  setIsAdding(false)
                  restoreAddRowFocus()
                }}
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
          </ScrollArea>

          <div className="flex items-center justify-end gap-2 text-sm text-muted-foreground">
            <Button
              variant="outline"
              size="sm"
              disabled={page <= 1}
              data-track="database-page-prev"
              onClick={() => {
                void handlePageChange(page - 1).catch((error) => {
                  logger.warn("Page change failed.", { error })
                })
              }}
            >
              ◂
            </Button>
            <span>{page} / {totalPages}</span>
            <Button
              variant="outline"
              size="sm"
              disabled={page >= totalPages}
              data-track="database-page-next"
              onClick={() => {
                void handlePageChange(page + 1).catch((error) => {
                  logger.warn("Page change failed.", { error })
                })
              }}
            >
              ▸
            </Button>
            <span className="ml-2">共 {total} 条</span>
          </div>
        </div>
      </div>

      <AlertDialog open={deleteId != null} onOpenChange={(open) => { if (!open) setDeleteId(null) }} data-track="database-row-delete-dialog">
        <AlertDialogContent
          onCloseAutoFocus={(event) => {
            const trigger = deleteTriggerRef.current
            if (!trigger?.isConnected) {
              return
            }
            event.preventDefault()
            window.setTimeout(() => trigger.focus())
          }}
        >
          <AlertDialogHeader>
            <AlertDialogTitle>确认删除</AlertDialogTitle>
            <AlertDialogDescription>
              确定要删除 id={deleteId} 的记录吗？此操作不可撤销。
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>取消</AlertDialogCancel>
            <AlertDialogAction data-track="database-row-delete-confirm" onClick={handleConfirmDelete}>删除</AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>

      <DataTableFilterDialog
        open={isFilterDialogOpen}
        onOpenChange={setIsFilterDialogOpen}
        columns={columns}
        value={filter}
        onApply={handleFilterChange}
        restoreFocusRef={filterButtonRef}
      />
    </div>
  )
})

export { DataTableView }
export type { DataTableViewHandle }
