import { useCallback, useEffect, useRef, useState } from "react"
import { LoaderCircle, Package, TriangleAlert } from "lucide-react"
import { Button } from "@/components/ui/button"
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
import { SidebarContentLayout } from "@/components/sidebar-content-layout"
import { createRendererLogger } from "@/app-shell/logging"
import { useAppNotifications } from "@/app-shell/notifications"
import { getSynapseBridge } from "@/lib/electron-bridge"
import { sanitizeTrackRecord, sanitizeTrackValue } from "@/lib/ui-tracking"
import { DataStoreSidebar } from "./components/data-store-sidebar"
import { DataTableView } from "./components/data-table-view"
import type { DataTableViewHandle } from "./components/data-table-view"
import { CreateTableDialog } from "./components/create-table-dialog"
import { TableSchemaSheet } from "./components/table-schema-sheet"
import {
  addColumn,
  createTable,
  deleteRow,
  dropTable,
  exportTable,
  importTable,
  inspectTableImport,
  insertRow,
  updateTableDescription,
  updateColumnDescription,
  updateColumnChoices,
  updateRow,
  useDataStoreQuery,
  useDataStoreSchema,
  useDataStoreTables,
} from "./hooks/use-data-store"
import type { Column, ColumnKind, DataStoreWhereGroup } from "@/types/data-store"
import type { DataStoreTableImportInspection } from "@/types/data-store"

const logger = createRendererLogger("data-store")

function DataStoreModule() {
  const { tables, loading: tablesLoading, error: tablesError, refresh: refreshTables } = useDataStoreTables()
  const { error: showError, success: showSuccess, promise } = useAppNotifications()

  const [activeTable, setActiveTable] = useState<string | null>(null)
  const [page, setPage] = useState(1)
  const [filter, setFilter] = useState<DataStoreWhereGroup | null>(null)
  const [isCreateDialogOpen, setIsCreateDialogOpen] = useState(false)
  const [isSchemaSheetOpen, setIsSchemaSheetOpen] = useState(false)
  const [pendingImport, setPendingImport] = useState<DataStoreTableImportInspection | null>(null)
  const dataTableViewRef = useRef<DataTableViewHandle | null>(null)

  const selectedTable = activeTable ?? tables[0]?.name ?? null
  const { rows, total, error: queryError, refresh: refreshQuery, pageSize } = useDataStoreQuery(selectedTable, page, filter)
  const { schema, error: schemaError, refresh: refreshSchema } = useDataStoreSchema(selectedTable)
  const loadError = tablesError ?? queryError ?? schemaError
  const isLoadingSelection = tablesLoading || Boolean(selectedTable && !schema && !loadError)

  const handleTableSelect = useCallback(
    async (name: string) => {
      if (name === selectedTable) {
        return
      }

      await dataTableViewRef.current?.commitPendingChanges()
      logger.info("Table selected.", {
        from: selectedTable,
        to: name,
      })
      setActiveTable(name)
      setPage(1)
      setFilter(null)
    },
    [selectedTable],
  )

  const handleFilterChange = useCallback((nextFilter: DataStoreWhereGroup | null) => {
    logger.info("Table filter state applied.", {
      table: selectedTable,
      active: nextFilter !== null,
      conditionCount: nextFilter?.conditions.length ?? 0,
    })
    setFilter(nextFilter)
    setPage(1)
  }, [selectedTable])

  const handleOpenCreateDialog = useCallback(async () => {
    await dataTableViewRef.current?.commitPendingChanges()
    logger.info("Create table dialog opened.")
    setIsCreateDialogOpen(true)
  }, [])

  const handleExportTable = useCallback(async () => {
    if (!selectedTable) return
    try {
      await promise(
        async () => {
          const result = await exportTable(selectedTable)
          if (!result.success) return
          logger.info("Table exported.", {
            table: selectedTable,
            path: sanitizeTrackValue("exportPath", result.path),
          })
          return result
        },
        { loading: "正在导出...", success: (result) => result?.success ? "已导出" : null },
      )
    } catch (error) {
      logger.error("Table export failed.", { error })
    }
  }, [promise, selectedTable])

  const handleChooseImportTable = useCallback(async () => {
    await dataTableViewRef.current?.commitPendingChanges()
    logger.info("Table import picker opened.")
    try {
      const result = await inspectTableImport()
      if (!result.success) return
      logger.info("Table import inspected.", {
        table: result.tableName,
        exists: result.exists,
        sourcePath: sanitizeTrackValue("sourcePath", result.sourcePath),
      })
      setPendingImport({
        tableName: result.tableName,
        exists: result.exists,
        sourcePath: result.sourcePath,
      })
    } catch (error) {
      logger.error("Table import inspection failed.", { error })
      showError(error instanceof Error ? error.message : "导入失败")
    }
  }, [showError])

  const handleConfirmImportTable = useCallback(async () => {
    if (!pendingImport) return
    const sourcePath = pendingImport.sourcePath
    try {
      await promise(
        async () => {
          const result = await importTable(sourcePath)
          if (!result.success || !result.tableName) {
            throw new Error("导入失败")
          }
          await refreshTables()
          setActiveTable(result.tableName)
          setPage(1)
          setFilter(null)
          logger.info("Table imported.", {
            table: result.tableName,
            sourcePath: sanitizeTrackValue("sourcePath", sourcePath),
          })
        },
        { loading: "正在导入...", success: "已导入" },
      )
      setPendingImport(null)
    } catch (error) {
      logger.error("Table import failed.", { error })
    }
  }, [pendingImport, promise, refreshTables])

  const handleCreateTable = useCallback(
    async (name: string, columns: Column[], description?: string) => {
      await promise(
        async () => {
          await createTable(name, columns, description)
          logger.info("Table created.", {
            name,
            columnCount: columns.length,
            columnNames: columns.map((column) => column.name),
            description: sanitizeTrackValue("description", description ?? ""),
          })
          await refreshTables()
          setActiveTable(name)
          setPage(1)
          setFilter(null)
        },
        { loading: "正在创建表...", success: `表 "${name}" 已创建` },
      )
    },
    [promise, refreshTables],
  )

  const handleDropTable = useCallback(async () => {
    if (!selectedTable) return
    await promise(
      async () => {
        await dropTable(selectedTable)
        logger.info("Table dropped.", { name: selectedTable })
        setIsSchemaSheetOpen(false)
        setActiveTable(null)
        await refreshTables()
      },
      { loading: "正在删除表...", success: `表 "${selectedTable}" 已删除` },
    )
  }, [selectedTable, promise, refreshTables])

  const handleUpdateTableDescription = useCallback(
    async (description: string) => {
      if (!selectedTable) return

      try {
        await updateTableDescription(selectedTable, description)
        logger.info("Table description updated.", {
          table: selectedTable,
          description: sanitizeTrackValue("description", description),
        })
        await refreshSchema()
        await refreshTables()
      } catch (error) {
        logger.error("Table description update failed.", { error })
        showError(error instanceof Error ? error.message : "保存失败")
      }
    },
    [refreshSchema, refreshTables, selectedTable, showError],
  )

  const handleAddColumn = useCallback(
    async (name: string, kind: ColumnKind, description?: string, choices?: string[]) => {
      if (!selectedTable) return
      await promise(
        async () => {
          await addColumn(selectedTable, { name, kind, description, choices })
          logger.info("Column added.", {
            table: selectedTable,
            column: name,
            kind,
            description: sanitizeTrackValue("description", description ?? ""),
            choiceCount: choices?.length ?? 0,
          })
          await refreshSchema()
          await refreshQuery()
        },
        { loading: "正在添加列...", success: `列 "${name}" 已添加` },
      )
    },
    [selectedTable, promise, refreshSchema, refreshQuery],
  )

  const handleUpdateColumnDescription = useCallback(
    async (column: string, description: string) => {
      if (!selectedTable) return
      await updateColumnDescription(selectedTable, column, description)
      logger.info("Column description updated.", {
        table: selectedTable,
        column,
        description: sanitizeTrackValue(column, description),
      })
      await refreshSchema()
    },
    [selectedTable, refreshSchema],
  )

  const handleUpdateColumnChoices = useCallback(
    async (column: string, choices: string[]) => {
      if (!selectedTable) return
      await promise(
        async () => {
          await updateColumnChoices(selectedTable, column, choices)
          logger.info("Column choices updated.", {
            table: selectedTable,
            column,
            choiceCount: choices.length,
            choices: choices.map((choice) => sanitizeTrackValue(column, choice)),
          })
          await refreshSchema()
        },
        { loading: "正在更新选项...", success: "选项已更新" },
      )
    },
    [selectedTable, promise, refreshSchema],
  )

  const handleInsert = useCallback(
    async (data: Record<string, unknown>) => {
      if (!selectedTable) return
      try {
        await insertRow(selectedTable, data)
        logger.info("Row inserted.", {
          table: selectedTable,
          columns: Object.keys(data),
          values: sanitizeTrackRecord(data),
        })
        await refreshQuery()
        await refreshTables()
        showSuccess("已添加一行")
      } catch (error) {
        logger.error("Insert failed.", { error })
        showError(error instanceof Error ? error.message : "新增失败，请稍后重试。")
        throw error
      }
    },
    [refreshQuery, refreshTables, selectedTable, showError, showSuccess],
  )

  const handleUpdate = useCallback(
    async (id: number, data: Record<string, unknown>) => {
      if (!selectedTable) return
      try {
        await updateRow(selectedTable, id, data)
        logger.info("Row updated.", {
          table: selectedTable,
          rowId: id,
          columns: Object.keys(data),
          values: sanitizeTrackRecord(data),
        })
        await refreshQuery()
      } catch (error) {
        logger.error("Update failed.", { error })
        showError(error instanceof Error ? error.message : "保存失败，请稍后重试。")
        throw error
      }
    },
    [refreshQuery, selectedTable, showError],
  )

  const handleDelete = useCallback(
    async (id: number) => {
      if (!selectedTable) return
      try {
        await deleteRow(selectedTable, id)
        logger.info("Row deleted.", {
          table: selectedTable,
          rowId: id,
        })
        await refreshQuery()
        await refreshTables()
        showSuccess("已删除一行")
      } catch (error) {
        logger.error("Delete failed.", { error })
        showError(error instanceof Error ? error.message : "删除失败，请稍后重试。")
      }
    },
    [selectedTable, refreshQuery, refreshTables, showSuccess, showError],
  )

  useEffect(() => {
    const bridge = getSynapseBridge()
    if (!bridge) return
    let timer: ReturnType<typeof setTimeout> | null = null
    const runRefresh = () => {
      timer = null
      void refreshTables()
      void refreshQuery()
      void refreshSchema()
    }
    const unsubscribe = bridge.dataStore.onChanged(() => {
      if (timer !== null) return
      timer = setTimeout(runRefresh, 150)
    })
    return () => {
      if (timer !== null) clearTimeout(timer)
      unsubscribe()
    }
  }, [refreshTables, refreshQuery, refreshSchema])

  const sidebar = (
    <DataStoreSidebar
      tables={tables}
      activeTable={selectedTable}
      onTableSelect={(name) => {
        void handleTableSelect(name).catch(() => {})
      }}
      onCreateTable={() => {
        void handleOpenCreateDialog().catch(() => {})
      }}
      onImportTable={() => {
        void handleChooseImportTable()
      }}
    />
  )

  const handleRetryLoad = () => {
    void refreshTables()
    void refreshQuery()
    void refreshSchema()
  }

  return (
    <SidebarContentLayout sidebar={sidebar} contentScrollable={false}>
      {loadError ? (
        <div className="flex h-full flex-col">
          <div className="flex flex-1 items-center justify-center">
            <div className="flex flex-col items-center gap-3 text-center">
              <TriangleAlert className="size-10 text-muted-foreground/50" />
              <p className="text-sm text-muted-foreground">读取失败</p>
              <p className="text-xs text-muted-foreground">{loadError.message}</p>
              <Button
                variant="outline"
                size="sm"
                onClick={handleRetryLoad}
              >
                重试
              </Button>
            </div>
          </div>
        </div>
      ) : selectedTable && schema ? (
        <div className="flex h-full flex-col">
          <div className="min-h-0 flex-1">
            <DataTableView
              ref={dataTableViewRef}
              tableName={selectedTable}
              columns={schema.columns}
              schema={schema}
              rows={rows}
              total={total}
              page={page}
              pageSize={pageSize}
              onPageChange={setPage}
              onInsert={handleInsert}
              onUpdate={handleUpdate}
              onDelete={handleDelete}
              onShowSchema={() => setIsSchemaSheetOpen(true)}
              onExportTable={handleExportTable}
              filter={filter}
              onFilterChange={handleFilterChange}
            />
          </div>
        </div>
      ) : isLoadingSelection ? (
        <div className="flex h-full flex-col">
          <div className="flex flex-1 items-center justify-center">
            <div className="flex flex-col items-center gap-3 text-center">
              <LoaderCircle className="size-10 animate-spin text-muted-foreground/50" />
              <p className="text-sm text-muted-foreground">正在加载</p>
            </div>
          </div>
        </div>
      ) : (
        <div className="flex h-full flex-col">
          <div className="flex flex-1 items-center justify-center">
            <div className="flex flex-col items-center gap-3 text-center">
              <Package className="size-10 text-muted-foreground/50" />
              <p className="text-sm text-muted-foreground">还没有数据表</p>
              <p className="text-xs text-muted-foreground">创建一张表开始使用</p>
              <Button
                variant="outline"
                size="sm"
                onClick={() => {
                  void handleOpenCreateDialog().catch(() => {})
                }}
              >
                新建表
              </Button>
            </div>
          </div>
        </div>
      )}

      <CreateTableDialog
        open={isCreateDialogOpen}
        onOpenChange={setIsCreateDialogOpen}
        onSubmit={handleCreateTable}
      />

      <TableSchemaSheet
        open={isSchemaSheetOpen}
        onOpenChange={setIsSchemaSheetOpen}
        schema={schema}
        onAddColumn={handleAddColumn}
        onUpdateTableDescription={handleUpdateTableDescription}
        onUpdateColumnDescription={handleUpdateColumnDescription}
        onUpdateColumnChoices={handleUpdateColumnChoices}
        onDropTable={handleDropTable}
      />

      <AlertDialog open={pendingImport !== null} onOpenChange={(open) => { if (!open) setPendingImport(null) }}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>{pendingImport?.exists ? "替换数据表" : "导入数据表"}</AlertDialogTitle>
            <AlertDialogDescription>
              {pendingImport?.exists
                ? "将删除本地同名表并导入文件中的数据。"
                : `导入 ${pendingImport?.tableName ?? ""}`}
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>取消</AlertDialogCancel>
            <AlertDialogAction
              onClick={() => {
                void handleConfirmImportTable()
              }}
            >
              {pendingImport?.exists ? "替换导入" : "导入"}
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </SidebarContentLayout>
  )
}

export { DataStoreModule }
