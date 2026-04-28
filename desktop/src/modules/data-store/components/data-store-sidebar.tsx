import { useMemo, useState } from "react"
import { FileInput, Table2 } from "lucide-react"
import { Button } from "@/components/ui/button"
import {
  ModuleSidebar,
  ModuleSidebarHeader,
  ModuleSidebarItem,
  ModuleSidebarList,
} from "@/components/module-sidebar"
import type { DataStoreTableInfo } from "@/types/data-store"

type DataStoreSidebarProps = {
  tables: DataStoreTableInfo[]
  activeTable: string | null
  onTableSelect: (name: string) => void
  onCreateTable: () => void
  onImportTable: () => void
}

function filterDataStoreTables(
  tables: DataStoreTableInfo[],
  searchQuery: string,
): DataStoreTableInfo[] {
  const query = searchQuery.trim().toLowerCase()
  if (!query) return tables

  return tables.filter((table) => {
    const description = table.description.trim().toLowerCase()
    return table.name.toLowerCase().includes(query)
      || (description ? description.includes(query) : false)
  })
}

function DataStoreSidebar({
  tables,
  activeTable,
  onTableSelect,
  onCreateTable,
  onImportTable,
}: DataStoreSidebarProps) {
  const [searchQuery, setSearchQuery] = useState("")

  const filteredTables = useMemo(
    () => filterDataStoreTables(tables, searchQuery),
    [tables, searchQuery],
  )

  return (
    <ModuleSidebar variant="bare">
      <ModuleSidebarHeader
        searchValue={searchQuery}
        onSearchChange={setSearchQuery}
        searchPlaceholder="搜索数据表或备注"
        onAddClick={onCreateTable}
        addTitle="新建表"
        actions={(
          <Button
            variant="outline"
            size="icon"
            onClick={onImportTable}
            title="导入表"
          >
            <FileInput />
            <span className="sr-only">导入表</span>
          </Button>
        )}
      />
      <ModuleSidebarList>
        {filteredTables.length === 0 ? (
          <div className="px-3 py-2 text-sm text-muted-foreground">
            {tables.length === 0 ? "(无表)" : "未找到匹配的数据表"}
          </div>
        ) : (
          filteredTables.map((table) => (
            <ModuleSidebarItem
              key={table.name}
              active={table.name === activeTable}
              icon={Table2}
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

export { DataStoreSidebar, filterDataStoreTables }
