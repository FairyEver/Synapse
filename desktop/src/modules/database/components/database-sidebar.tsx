import { useMemo, useState } from "react"
import { Input } from "@/components/ui/input"
import {
  ContextMenu,
  ContextMenuContent,
  ContextMenuItem,
  ContextMenuSub,
  ContextMenuSubContent,
  ContextMenuSubTrigger,
  ContextMenuTrigger,
} from "@/components/ui/context-menu"
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
  ModuleSidebar,
  ModuleSidebarHeader,
  ModuleSidebarItem,
  ModuleSidebarList,
} from "@/components/module-sidebar"
import type { DatabaseTableInfo } from "@/types/database"
import type { DatabaseFolder } from "@/types/database"
import { DatabaseSidebarToolbar, type DisplayMode } from "./database-sidebar-toolbar"
import { DatabaseTableFolder } from "./database-table-folder"

type DatabaseSidebarProps = {
  tables: DatabaseTableInfo[]
  folders: DatabaseFolder[]
  activeTable: string | null
  displayMode: DisplayMode
  onDisplayModeChange: (mode: DisplayMode) => void
  onTableSelect: (name: string) => void
  onCreateTable: () => void
  onImportTable: () => void
  onCreateFolder: (name: string) => void
  onRenameFolder: (id: number, name: string) => void
  onDeleteFolder: (id: number) => void
  onMoveTable: (tableName: string, folderId: number | null) => void
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
  folders,
  activeTable,
  displayMode,
  onDisplayModeChange,
  onTableSelect,
  onCreateTable,
  onImportTable,
  onCreateFolder,
  onRenameFolder,
  onDeleteFolder,
  onMoveTable,
}: DatabaseSidebarProps) {
  const [searchQuery, setSearchQuery] = useState("")
  const [creatingFolder, setCreatingFolder] = useState(false)
  const [newFolderName, setNewFolderName] = useState("")
  const [renamingFolderId, setRenamingFolderId] = useState<number | null>(null)
  const [renameValue, setRenameValue] = useState("")
  const [deletingFolder, setDeletingFolder] = useState<{ id: number; name: string; memberCount: number } | null>(null)
  const normalizedSearchQuery = searchQuery.trim()

  const filteredTables = useMemo(
    () => filterDatabaseTables(tables, normalizedSearchQuery),
    [tables, normalizedSearchQuery],
  )

  const isSearching = normalizedSearchQuery.length > 0

  const folderMemberSet = useMemo(() => {
    const set = new Set<string>()
    for (const folder of folders) {
      for (const member of folder.members) {
        set.add(member.tableName)
      }
    }
    return set
  }, [folders])

  const ungroupedTables = useMemo(
    () => filteredTables.filter((t) => !folderMemberSet.has(t.name)),
    [filteredTables, folderMemberSet],
  )

  const tablesByName = useMemo(() => {
    const map = new Map<string, DatabaseTableInfo>()
    for (const t of filteredTables) map.set(t.name, t)
    return map
  }, [filteredTables])

  function handleCreateFolderStart() {
    setCreatingFolder(true)
    setNewFolderName("")
  }

  function handleCreateFolderConfirm() {
    const trimmed = newFolderName.trim()
    if (trimmed) {
      onCreateFolder(trimmed)
    }
    setCreatingFolder(false)
  }

  function handleCreateFolderCancel() {
    setCreatingFolder(false)
  }

  function handleRenameFolderStart(id: number) {
    const folder = folders.find((f) => f.id === id)
    if (!folder) return
    setRenamingFolderId(id)
    setRenameValue(folder.name)
  }

  function handleRenameFolderConfirm() {
    const trimmed = renameValue.trim()
    if (trimmed && renamingFolderId !== null) {
      onRenameFolder(renamingFolderId, trimmed)
    }
    setRenamingFolderId(null)
  }

  function handleDeleteFolderStart(id: number) {
    const folder = folders.find((f) => f.id === id)
    if (!folder) return
    if (folder.members.length === 0) {
      onDeleteFolder(id)
    } else {
      setDeletingFolder({ id, name: folder.name, memberCount: folder.members.length })
    }
  }

  function handleDeleteFolderConfirm() {
    if (deletingFolder) {
      onDeleteFolder(deletingFolder.id)
      setDeletingFolder(null)
    }
  }


  function renderTableItem(table: DatabaseTableInfo) {
    const label = displayMode === "desc" && table.description.trim()
      ? table.description.trim()
      : table.name
    const description = displayMode === "title+desc" && table.description.trim()
      ? table.description.trim()
      : undefined

    return (
      <ContextMenu key={table.name}>
        <ContextMenuTrigger asChild>
          <div
            draggable
            onDragStart={(e) => {
              e.dataTransfer.setData("application/x-synapse-table", table.name)
              e.dataTransfer.effectAllowed = "move"
            }}
          >
            <ModuleSidebarItem
              active={table.name === activeTable}
              data-track="database-table-select"
              trackValue={table.name}
              onClick={() => onTableSelect(table.name)}
              description={description}
              trailing={
                <span className="text-xs text-muted-foreground">
                  {table.rowCount}
                </span>
              }
            >
              {label}
            </ModuleSidebarItem>
          </div>
        </ContextMenuTrigger>
        <ContextMenuContent>
          {folders.length > 0 ? (
            <ContextMenuSub>
              <ContextMenuSubTrigger>移动到文件夹</ContextMenuSubTrigger>
              <ContextMenuSubContent>
                {folders.map((folder) => (
                  <ContextMenuItem
                    key={folder.id}
                    onClick={() => onMoveTable(table.name, folder.id)}
                  >
                    {folder.name}
                  </ContextMenuItem>
                ))}
              </ContextMenuSubContent>
            </ContextMenuSub>
          ) : (
            <ContextMenuItem disabled>移动到文件夹</ContextMenuItem>
          )}
          {folderMemberSet.has(table.name) && (
            <ContextMenuItem onClick={() => onMoveTable(table.name, null)}>
              移出文件夹
            </ContextMenuItem>
          )}
        </ContextMenuContent>
      </ContextMenu>
    )
  }


  function handleRootDragOver(event: React.DragEvent) {
    if (event.dataTransfer.types.includes("application/x-synapse-table")) {
      event.preventDefault()
      event.dataTransfer.dropEffect = "move"
    }
  }

  function handleRootDrop(event: React.DragEvent) {
    const tableName = event.dataTransfer.getData("application/x-synapse-table")
    if (tableName && folderMemberSet.has(tableName)) {
      onMoveTable(tableName, null)
    }
  }

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
      />
      <DatabaseSidebarToolbar
        displayMode={displayMode}
        onDisplayModeChange={onDisplayModeChange}
        onImportTable={onImportTable}
        onCreateFolder={handleCreateFolderStart}
      />
      <ModuleSidebarList data-track="database-table-list">
        {creatingFolder && (
          <div className="px-1.5 py-0.5">
            <Input
              value={newFolderName}
              onChange={(e) => setNewFolderName(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === "Enter") handleCreateFolderConfirm()
                if (e.key === "Escape") handleCreateFolderCancel()
              }}
              onBlur={handleCreateFolderConfirm}
              placeholder="文件夹名称"
              className="h-8 text-sm"
              autoFocus
            />
          </div>
        )}

        {!isSearching && folders.map((folder) => {
          if (renamingFolderId === folder.id) {
            return (
              <div key={folder.id} className="px-1.5 py-0.5">
                <Input
                  value={renameValue}
                  onChange={(e) => setRenameValue(e.target.value)}
                  onKeyDown={(e) => {
                    if (e.key === "Enter") handleRenameFolderConfirm()
                    if (e.key === "Escape") setRenamingFolderId(null)
                  }}
                  onBlur={handleRenameFolderConfirm}
                  className="h-8 text-sm"
                  autoFocus
                />
              </div>
            )
          }
          const folderTables = folder.members
            .map((m) => tablesByName.get(m.tableName))
            .filter((t): t is DatabaseTableInfo => t !== undefined)
          return (
            <DatabaseTableFolder
              key={folder.id}
              folder={folder}
              onRename={handleRenameFolderStart}
              onDelete={handleDeleteFolderStart}
              onDrop={(tableName) => onMoveTable(tableName, folder.id)}
            >
              {folderTables.map((table) => renderTableItem(table))}
            </DatabaseTableFolder>
          )
        })}

        <div
          onDragOver={handleRootDragOver}
          onDrop={handleRootDrop}
          className="flex min-h-8 flex-col"
        >
          {isSearching ? (
            filteredTables.length === 0 ? (
              <div className="px-3 py-2 text-sm text-muted-foreground">
                未找到匹配的数据表
              </div>
            ) : (
              filteredTables.map((table) => renderTableItem(table))
            )
          ) : (
            ungroupedTables.length === 0 && folders.length === 0 ? (
              <div className="px-3 py-2 text-sm text-muted-foreground">
                (无表)
              </div>
            ) : (
              ungroupedTables.map((table) => renderTableItem(table))
            )
          )}
        </div>
      </ModuleSidebarList>

      <AlertDialog open={deletingFolder !== null} onOpenChange={(open) => { if (!open) setDeletingFolder(null) }}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>删除文件夹</AlertDialogTitle>
            <AlertDialogDescription>
              删除文件夹「{deletingFolder?.name}」？文件夹内的 {deletingFolder?.memberCount} 张表不会被删除。
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>取消</AlertDialogCancel>
            <AlertDialogAction onClick={handleDeleteFolderConfirm}>删除</AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </ModuleSidebar>
  )
}

export { DatabaseSidebar, filterDatabaseTables }
