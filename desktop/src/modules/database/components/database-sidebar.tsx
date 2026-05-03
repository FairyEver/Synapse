import { useMemo, useState } from "react"
import { FileInput } from "lucide-react"
import { Button } from "@/components/ui/button"
import {
  ModuleSidebar,
  ModuleSidebarHeader,
  ModuleSidebarItem,
  ModuleSidebarList,
} from "@/components/module-sidebar"
import type { DatabaseTableInfo } from "@/types/database"

type DatabaseSidebarProps = {
  tables: DatabaseTableInfo[]
  activeTable: string | null
  onTableSelect: (name: string) => void
  onCreateTable: () => void
  onImportTable: () => void
}

function filterDatabaseTables(
  tables: DatabaseTableInfo[],
  searchQuery: string,
): DatabaseTableInfo[] {
  const query = searchQuery.trim().toLowerCase()
  if (!query) return tables

  return tables.filter((table) => {
    const description = table.description.trim().toLowerCase()
    return table.name.toLowerCase().includes(query)
      || (description ? description.includes(query) : false)
  })
}

function DatabaseSidebar({
  tables,
  activeTable,
  onTableSelect,
  onCreateTable,
  onImportTable,
}: DatabaseSidebarProps) {
  const [searchQuery, setSearchQuery] = useState("")

  const filteredTables = useMemo(
    () => filterDatabaseTables(tables, searchQuery),
    [tables, searchQuery],
  )

  return (
    <ModuleSidebar variant="bare">
      <ModuleSidebarHeader
        searchValue={searchQuery}
        onSearchChange={setSearchQuery}
        searchPlaceholder="搜索数据表或备注"
        searchTrackName="database-table-search"
        onAddClick={onCreateTable}
        addTrackName="database-create-table-open"
        addTitle="新建表"
        actions={(
          <Button
            variant="outline"
            size="icon"
            data-track="database-import-table-open"
            onClick={onImportTable}
            title="导入表"
          >
            <FileInput />
            <span className="sr-only">导入表</span>
          </Button>
        )}
      />
      <ModuleSidebarList data-track="database-table-list">
        {filteredTables.length === 0 ? (
          <div className="px-3 py-2 text-sm text-muted-foreground">
            {tables.length === 0 ? "(无表)" : "未找到匹配的数据表"}
          </div>
        ) : (
          filteredTables.map((table) => (
            <ModuleSidebarItem
              key={table.name}
              active={table.name === activeTable}
              data-track="database-table-select"
              trackValue={table.name}
              onClick={() => onTableSelect(table.name)}
              description={table.description.trim() || undefined}
              trailing={
                <span className="text-xs text-muted-foreground">
                  {table.rowCount}
                </span>
              }
            >
              {table.name}
            </ModuleSidebarItem>
          ))
        )}
      </ModuleSidebarList>
    </ModuleSidebar>
  )
}

export { DatabaseSidebar, filterDatabaseTables }
