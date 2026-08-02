import { useCallback, useEffect, useRef, useState } from "react"
import type { ReactNode } from "react"
import { LoaderCircle, Package, TriangleAlert } from "lucide-react"
import { Button } from "@/components/ui/button"
import { ScrollArea } from "@/components/ui/scroll-area"
import { Tabs, TabsContent } from "@/components/ui/tabs"
import { SystemAppWindowShell } from "@/modules/apps/components/system-app-window-shell"
import {
  AlertDialog,
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
import { DatabaseSidebar } from "./components/database-sidebar"
import type { DatabaseFolderOperationAction } from "./components/database-sidebar"
import { DataTableView } from "./components/data-table-view"
import type { DataTableViewHandle } from "./components/data-table-view"
import { CreateTableDialog } from "./components/create-table-dialog"
import { TableSchemaSheet } from "./components/table-schema-sheet"
import { useDatabaseFolders } from "./hooks/use-database-folders"
import type { DisplayMode } from "./components/database-sidebar-toolbar"
import {
  databaseColumnCreate,
  databaseTableCreate,
  databaseRowDelete,
  databaseTableDelete,
  databaseTableExport,
  databaseTableImport,
  databaseTableImportInspect,
  databaseRowCreate,
  databaseTableUpdate,
  databaseColumnUpdate,
  databaseChoiceUpdate,
  databaseRowUpdate,
  useDatabaseQuery,
  useDatabaseStatus,
  useDatabaseSchema,
  useDatabaseTables,
} from "./hooks/use-database"
import { DatabaseManagementCard, DatabaseServiceStatusCard } from "@/modules/settings/components/database-settings-panel"
import type { Column, ColumnKind, DatabaseWhereGroup } from "@/types/database"
import type { DatabaseTableImportInspection } from "@/types/database"
import type { DatabaseAppViewId } from "@/modules/apps/types"

const logger = createRendererLogger("database")
const ROW_NOT_FOUND_MESSAGE = "该行已不存在，已刷新列表。"
const DATABASE_APP_TABS: readonly { readonly id: DatabaseAppViewId; readonly label: string }[] = [
  { id: "tables", label: "数据表" },
  { id: "status", label: "服务状态" },
  { id: "management", label: "管理" },
]

function getStoredDisplayMode(): DisplayMode {
  const stored = localStorage.getItem("synapse:app:database:operation:displayMode")
  if (stored === "title" || stored === "desc" || stored === "title+desc") return stored
  return "title+desc"
}

function DatabaseTablesView() {
  const { tables, loading: tablesLoading, error: tablesError, refresh: refreshTables } = useDatabaseTables()
  const { error: showError, success: showSuccess, promise } = useAppNotifications()
  const {
    folders,
    error: foldersError,
    refresh: refreshFolders,
    createFolder,
    renameFolder,
    deleteFolder,
    moveTable,
  } = useDatabaseFolders()
  const [displayMode, setDisplayMode] = useState<DisplayMode>(getStoredDisplayMode)

  const [activeTable, setActiveTable] = useState<string | null>(null)
  const [page, setPage] = useState(1)
  const [filter, setFilter] = useState<DatabaseWhereGroup | null>(null)
  const [isCreateDialogOpen, setIsCreateDialogOpen] = useState(false)
  const [isSchemaSheetOpen, setIsSchemaSheetOpen] = useState(false)
  const [pendingImport, setPendingImport] = useState<DatabaseTableImportInspection | null>(null)
  const dataTableViewRef = useRef<DataTableViewHandle | null>(null)

  const selectedTable = activeTable ?? tables[0]?.name ?? null
  const { rows, total, error: queryError, refresh: refreshQuery, pageSize } = useDatabaseQuery(selectedTable, page, filter)
  const { schema, error: schemaError, refresh: refreshSchema } = useDatabaseSchema(selectedTable)
  const loadError = tablesError ?? queryError ?? schemaError ?? (foldersError ? new Error(foldersError) : null)
  const isLoadingSelection = tablesLoading || Boolean(selectedTable && !schema && !loadError)

  const handleTableSelect = useCallback(
    async (name: string) => {
      if (name === selectedTable) {
        return
      }

      try {
        await dataTableViewRef.current?.commitPendingChanges()
      } catch (err) {
        logger.warn("Failed to commit pending changes before table switch.", { from: selectedTable, to: name, error: err instanceof Error ? err.message : String(err) })
        return
      }
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

  const handleFilterChange = useCallback((nextFilter: DatabaseWhereGroup | null) => {
    logger.info("Table filter state applied.", {
      table: selectedTable,
      active: nextFilter !== null,
      conditionCount: nextFilter?.conditions.length ?? 0,
    })
    setFilter(nextFilter)
    setPage(1)
  }, [selectedTable])

  const handleDisplayModeChange = useCallback((mode: DisplayMode) => {
    setDisplayMode(mode)
    localStorage.setItem("synapse:app:database:operation:displayMode", mode)
  }, [])

  const handleFolderOperationError = useCallback((action: DatabaseFolderOperationAction, error: unknown) => {
    logger.error("Database folder operation failed.", { action, error })
    showError(error instanceof Error ? error.message : "操作失败，请稍后重试。")
  }, [showError])

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
          const result = await databaseTableExport(selectedTable)
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
    try {
      await dataTableViewRef.current?.commitPendingChanges()
    } catch (error) {
      logger.error("Failed to commit pending changes before import.", { error })
      showError(error instanceof Error ? error.message : "保存当前编辑失败")
      return
    }
    logger.info("Table import picker opened.")
    try {
      const result = await databaseTableImportInspect()
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
        sourceDigest: result.sourceDigest,
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
          const result = await databaseTableImport({ sourcePath, sourceDigest: pendingImport.sourceDigest })
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
          await databaseTableCreate(name, columns, description)
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
        await databaseTableDelete(selectedTable)
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
        await databaseTableUpdate(selectedTable, description)
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
          await databaseColumnCreate(selectedTable, { name, kind, description, choices })
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
      try {
        await databaseColumnUpdate(selectedTable, column, description)
        logger.info("Column description updated.", {
          table: selectedTable,
          column,
          description: sanitizeTrackValue(column, description),
        })
        await refreshSchema()
      } catch (updateError) {
        logger.error("Failed to update column description.", { error: updateError })
        showError(updateError instanceof Error ? updateError.message : "更新列描述失败。")
      }
    },
    [selectedTable, refreshSchema, showError],
  )

  const handleUpdateColumnChoices = useCallback(
    async (column: string, choices: string[]) => {
      if (!selectedTable) return
      await promise(
        async () => {
          await databaseChoiceUpdate(selectedTable, column, choices)
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
        await databaseRowCreate(selectedTable, data)
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
        const result = await databaseRowUpdate(selectedTable, id, data)
        if (result.affected === 0) {
          await refreshQuery()
          await refreshTables()
          throw new Error(ROW_NOT_FOUND_MESSAGE)
        }
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
    [refreshQuery, refreshTables, selectedTable, showError],
  )

  const handleDelete = useCallback(
    async (id: number) => {
      if (!selectedTable) return
      try {
        const result = await databaseRowDelete(selectedTable, id)
        if (result.affected === 0) {
          await refreshQuery()
          await refreshTables()
          throw new Error(ROW_NOT_FOUND_MESSAGE)
        }
        logger.info("Row deleted.", {
          table: selectedTable,
          rowId: id,
        })
        if (rows.length === 1 && page > 1) {
          setPage(page - 1)
        } else {
          await refreshQuery()
        }
        await refreshTables()
        showSuccess("已删除一行")
      } catch (error) {
        logger.error("Delete failed.", { error })
        showError(error instanceof Error ? error.message : "删除失败，请稍后重试。")
        throw error
      }
    },
    [selectedTable, rows.length, page, refreshQuery, refreshTables, showSuccess, showError],
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
    const unsubscribe = bridge.database.operation.onChanged(() => {
      if (timer !== null) return
      timer = setTimeout(runRefresh, 150)
    })
    return () => {
      if (timer !== null) clearTimeout(timer)
      unsubscribe()
    }
  }, [refreshTables, refreshQuery, refreshSchema])

  const sidebar = (
    <DatabaseSidebar
      tables={tables}
      folders={folders}
      activeTable={selectedTable}
      displayMode={displayMode}
      onDisplayModeChange={handleDisplayModeChange}
      onTableSelect={(name) => {
        void handleTableSelect(name).catch((error) => {
          logger.warn("Table select failed.", { error })
        })
      }}
      onCreateTable={() => {
        void handleOpenCreateDialog().catch((error) => {
          logger.warn("Open create dialog failed.", { error })
        })
      }}
      onImportTable={() => {
        void handleChooseImportTable()
      }}
      onCreateFolder={createFolder}
      onRenameFolder={renameFolder}
      onDeleteFolder={deleteFolder}
      onMoveTable={moveTable}
      onFolderOperationError={handleFolderOperationError}
    />
  )

  const handleRetryLoad = () => {
    void refreshTables()
    void refreshQuery()
    void refreshSchema()
    void refreshFolders()
  }

  return (
    <SidebarContentLayout
      sidebar={sidebar}
      contentScrollable={false}
      contentClassName="bg-surface"
      sidebarResizable
      sidebarPersistenceId="database"
    >
      <div className="h-full min-h-0">
        {loadError ? (
          <div className="flex h-full flex-col">
            <div className="flex flex-1 items-center justify-center">
              <div className="flex flex-col items-center gap-2 text-center">
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
              <div className="flex flex-col items-center gap-2 text-center">
                <LoaderCircle className="size-10 animate-spin text-muted-foreground/50" />
                <p className="text-sm text-muted-foreground">正在加载</p>
              </div>
            </div>
          </div>
        ) : (
          <div className="flex h-full flex-col">
            <div className="flex flex-1 items-center justify-center">
              <div className="flex flex-col items-center gap-2 text-center">
                <Package className="size-10 text-muted-foreground/50" />
                <p className="text-sm text-muted-foreground">还没有数据表</p>
                <p className="text-xs text-muted-foreground">创建一张表开始使用</p>
                <Button
                  variant="outline"
                  size="sm"
                  onClick={() => {
                    void handleOpenCreateDialog().catch((error) => {
                      logger.warn("Open create dialog failed.", { error })
                    })
                  }}
                >
                  新建表
                </Button>
              </div>
            </div>
          </div>
        )}
      </div>

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
            <Button
              onClick={() => {
                void handleConfirmImportTable()
              }}
            >
              {pendingImport?.exists ? "替换导入" : "导入"}
            </Button>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </SidebarContentLayout>
  )
}

function DatabaseSettingsTabContent({ children }: { readonly children: ReactNode }) {
  return (
    <ScrollArea className="h-full min-h-0">
      <div className="min-h-full px-3 py-3">
        <div className="mx-auto flex max-w-3xl flex-col gap-2">
          {children}
        </div>
      </div>
    </ScrollArea>
  )
}

function DatabaseServiceStatusView() {
  const { status } = useDatabaseStatus()

  return (
    <DatabaseSettingsTabContent>
      <DatabaseServiceStatusCard status={status} />
    </DatabaseSettingsTabContent>
  )
}

function DatabaseManagementView() {
  const { status, refresh } = useDatabaseStatus()

  return (
    <DatabaseSettingsTabContent>
      <DatabaseManagementCard status={status} onRefreshStatus={refresh} />
    </DatabaseSettingsTabContent>
  )
}

function DatabaseModule() {
  const [view, setView] = useState<DatabaseAppViewId>("tables")

  return (
    <SystemAppWindowShell tabs={DATABASE_APP_TABS} value={view} onValueChange={setView}>
      <Tabs value={view} className="contents">
        <TabsContent value="tables" className="m-0 h-full data-[state=inactive]:hidden">
          <DatabaseTablesView />
        </TabsContent>
        <TabsContent value="status" className="m-0 h-full data-[state=inactive]:hidden">
          <DatabaseServiceStatusView />
        </TabsContent>
        <TabsContent value="management" className="m-0 h-full data-[state=inactive]:hidden">
          <DatabaseManagementView />
        </TabsContent>
      </Tabs>
    </SystemAppWindowShell>
  )
}

export { DatabaseModule }
