import { useCallback, useRef, useState } from "react"
import { Package } from "lucide-react"
import { Button } from "@/components/ui/button"
import { SidebarContentLayout } from "@/components/sidebar-content-layout"
import { createRendererLogger } from "@/app-shell/logging"
import { useAppNotifications } from "@/app-shell/notifications"
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
  insertRow,
  updateColumnDescription,
  updateColumnEnumValues,
  updateRow,
  useDataStoreQuery,
  useDataStoreSchema,
  useDataStoreTables,
} from "./hooks/use-data-store"
import type { DataStoreColumnDef, DataStoreColumnType } from "@/types/data-store"

const logger = createRendererLogger("data-store")

function DataStoreModule() {
  const { tables, refresh: refreshTables } = useDataStoreTables()
  const { error: showError, success: showSuccess, promise } = useAppNotifications()

  const [activeTable, setActiveTable] = useState<string | null>(null)
  const [page, setPage] = useState(1)
  const [isCreateDialogOpen, setIsCreateDialogOpen] = useState(false)
  const [isSchemaSheetOpen, setIsSchemaSheetOpen] = useState(false)
  const dataTableViewRef = useRef<DataTableViewHandle | null>(null)

  const selectedTable = activeTable ?? tables[0]?.name ?? null
  const { rows, total, refresh: refreshQuery, pageSize } = useDataStoreQuery(selectedTable, page)
  const { schema, refresh: refreshSchema } = useDataStoreSchema(selectedTable)

  const handleTableSelect = useCallback(
    async (name: string) => {
      if (name === selectedTable) {
        return
      }

      await dataTableViewRef.current?.commitPendingChanges()
      setActiveTable(name)
      setPage(1)
    },
    [selectedTable],
  )

  const handleOpenCreateDialog = useCallback(async () => {
    await dataTableViewRef.current?.commitPendingChanges()
    setIsCreateDialogOpen(true)
  }, [])

  const handleCreateTable = useCallback(
    async (name: string, columns: DataStoreColumnDef[], description?: string) => {
      await promise(
        async () => {
          await createTable(name, columns, description)
          logger.info("Table created.", { name })
          await refreshTables()
          setActiveTable(name)
          setPage(1)
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

  const handleAddColumn = useCallback(
    async (name: string, type: DataStoreColumnType, description?: string, enumValues?: string[]) => {
      if (!selectedTable) return
      await promise(
        async () => {
          await addColumn(selectedTable, { name, type, description, enumValues })
          logger.info("Column added.", { table: selectedTable, column: name })
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
      await refreshSchema()
    },
    [selectedTable, refreshSchema],
  )

  const handleUpdateColumnEnumValues = useCallback(
    async (column: string, values: string[]) => {
      if (!selectedTable) return
      await promise(
        async () => {
          await updateColumnEnumValues(selectedTable, column, values)
          await refreshSchema()
        },
        { loading: "正在更新枚举值...", success: "枚举值已更新" },
      )
    },
    [selectedTable, promise, refreshSchema],
  )

  const handleInsert = useCallback(
    async (data: Record<string, unknown>) => {
      if (!selectedTable) return
      try {
        await insertRow(selectedTable, data)
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
    />
  )

  return (
    <SidebarContentLayout sidebar={sidebar} contentScrollable={false}>
      {selectedTable && schema ? (
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
            />
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
        onUpdateColumnDescription={handleUpdateColumnDescription}
        onUpdateColumnEnumValues={handleUpdateColumnEnumValues}
        onDropTable={handleDropTable}
      />
    </SidebarContentLayout>
  )
}

export { DataStoreModule }
