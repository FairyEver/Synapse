import { useMemo, useState } from "react"
import { Table2 } from "lucide-react"
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
}

function DataStoreSidebar({
  tables,
  activeTable,
  onTableSelect,
  onCreateTable,
}: DataStoreSidebarProps) {
  const [searchQuery, setSearchQuery] = useState("")

  const filteredTables = useMemo(() => {
    const query = searchQuery.trim().toLowerCase()
    if (!query) return tables
    return tables.filter((table) => table.name.toLowerCase().includes(query))
  }, [tables, searchQuery])

  return (
    <ModuleSidebar variant="bare">
      <div className="pb-2">
        <ModuleSidebarHeader
          searchValue={searchQuery}
          onSearchChange={setSearchQuery}
          searchPlaceholder="搜索数据表"
          onAddClick={onCreateTable}
          addTitle="新建表"
        />
      </div>
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

export { DataStoreSidebar }
