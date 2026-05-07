# Database Sidebar Redesign Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Redesign the database module sidebar to unify the header layout, add a ghost toolbar, and introduce a single-level folder system for organizing tables.

**Architecture:** Add two system tables (`_table_folders`, `_table_folder_members`) to the existing SQLite database. Expose folder CRUD via new IPC channels. Refactor the renderer sidebar into smaller components: toolbar, folder group, and table items with drag-and-drop support.

**Tech Stack:** SQLite (node:sqlite), Electron IPC (validated-ipc), React 19, Collapsible (radix-ui), ContextMenu (radix-ui), HTML5 Drag and Drop, Tailwind CSS, shadcn/ui Button (ghost variant)

---

### Task 1: System Tables Schema

**Files:**
- Modify: `desktop/electron/database/service.ts` (ensureSystemSchema method, ~line 499)
- Test: `desktop/electron/database/__tests__/folder-service.test.ts`

- [ ] **Step 1: Write the failing test**

```typescript
import { describe, expect, it, beforeEach, afterEach } from "vitest"
import { DatabaseSync } from "node:sqlite"

describe("folder system tables", () => {
  let db: DatabaseSync

  beforeEach(() => {
    db = new DatabaseSync(":memory:")
    db.exec("PRAGMA journal_mode=WAL")
  })

  afterEach(() => {
    db.close()
  })

  it("creates _table_folders and _table_folder_members tables", () => {
    db.exec(`
      CREATE TABLE IF NOT EXISTS "_table_folders" (
        "id" INTEGER PRIMARY KEY AUTOINCREMENT,
        "name" TEXT NOT NULL UNIQUE,
        "sort_order" INTEGER NOT NULL DEFAULT 0,
        "created_at" TEXT NOT NULL
      )
    `)
    db.exec(`
      CREATE TABLE IF NOT EXISTS "_table_folder_members" (
        "folder_id" INTEGER NOT NULL,
        "table_name" TEXT NOT NULL UNIQUE,
        "sort_order" INTEGER NOT NULL DEFAULT 0,
        PRIMARY KEY ("folder_id", "table_name"),
        FOREIGN KEY ("folder_id") REFERENCES "_table_folders"("id") ON DELETE CASCADE
      )
    `)

    const folders = db.prepare(`SELECT name FROM sqlite_master WHERE type='table' AND name='_table_folders'`).all()
    const members = db.prepare(`SELECT name FROM sqlite_master WHERE type='table' AND name='_table_folder_members'`).all()
    expect(folders).toHaveLength(1)
    expect(members).toHaveLength(1)
  })
})
```

- [ ] **Step 2: Run test to verify it passes (schema SQL validation)**

Run: `cd desktop && pnpm test -- --run electron/database/__tests__/folder-service.test.ts`
Expected: PASS

- [ ] **Step 3: Add system tables to ensureSystemSchema in service.ts**

In `desktop/electron/database/service.ts`, inside the `ensureSystemSchema()` method (after the `_operation_log` CREATE TABLE), add:

```typescript
    db.exec(`
      CREATE TABLE IF NOT EXISTS "_table_folders" (
        "id" INTEGER PRIMARY KEY AUTOINCREMENT,
        "name" TEXT NOT NULL UNIQUE,
        "sort_order" INTEGER NOT NULL DEFAULT 0,
        "created_at" TEXT NOT NULL
      )
    `)
    db.exec(`
      CREATE TABLE IF NOT EXISTS "_table_folder_members" (
        "folder_id" INTEGER NOT NULL,
        "table_name" TEXT NOT NULL UNIQUE,
        "sort_order" INTEGER NOT NULL DEFAULT 0,
        PRIMARY KEY ("folder_id", "table_name"),
        FOREIGN KEY ("folder_id") REFERENCES "_table_folders"("id") ON DELETE CASCADE
      )
    `)
```

- [ ] **Step 4: Run existing database tests to verify no regression**

Run: `cd desktop && pnpm test -- --run electron/database/__tests__/service.test.ts`
Expected: PASS

- [ ] **Step 5: Commit**

```bash
git add desktop/electron/database/service.ts desktop/electron/database/__tests__/folder-service.test.ts
git commit -m "feat(database): add _table_folders and _table_folder_members system tables"
```

---

### Task 2: Folder Service Methods

**Files:**
- Modify: `desktop/electron/database/service.ts` (add folder CRUD methods)
- Modify: `desktop/electron/database/__tests__/folder-service.test.ts`

- [ ] **Step 1: Write failing tests for folder CRUD**

Append to `desktop/electron/database/__tests__/folder-service.test.ts`:

```typescript
import { describe, expect, it, beforeEach, afterEach } from "vitest"
import { DatabaseSync } from "node:sqlite"

function createTestDb(): DatabaseSync {
  const db = new DatabaseSync(":memory:")
  db.exec("PRAGMA journal_mode=WAL")
  db.exec("PRAGMA foreign_keys=ON")
  db.exec(`
    CREATE TABLE IF NOT EXISTS "_table_folders" (
      "id" INTEGER PRIMARY KEY AUTOINCREMENT,
      "name" TEXT NOT NULL UNIQUE,
      "sort_order" INTEGER NOT NULL DEFAULT 0,
      "created_at" TEXT NOT NULL
    )
  `)
  db.exec(`
    CREATE TABLE IF NOT EXISTS "_table_folder_members" (
      "folder_id" INTEGER NOT NULL,
      "table_name" TEXT NOT NULL UNIQUE,
      "sort_order" INTEGER NOT NULL DEFAULT 0,
      PRIMARY KEY ("folder_id", "table_name"),
      FOREIGN KEY ("folder_id") REFERENCES "_table_folders"("id") ON DELETE CASCADE
    )
  `)
  return db
}

describe("folder CRUD operations", () => {
  let db: DatabaseSync

  beforeEach(() => {
    db = createTestDb()
  })

  afterEach(() => {
    db.close()
  })

  it("creates a folder", () => {
    const now = new Date().toISOString()
    const result = db.prepare(
      `INSERT INTO "_table_folders" ("name", "sort_order", "created_at") VALUES (?, 0, ?)`
    ).run("工作日志", now)
    expect(Number(result.lastInsertRowid)).toBeGreaterThan(0)
  })

  it("rejects duplicate folder names", () => {
    const now = new Date().toISOString()
    db.prepare(`INSERT INTO "_table_folders" ("name", "sort_order", "created_at") VALUES (?, 0, ?)`).run("工作日志", now)
    expect(() => {
      db.prepare(`INSERT INTO "_table_folders" ("name", "sort_order", "created_at") VALUES (?, 0, ?)`).run("工作日志", now)
    }).toThrow()
  })

  it("adds a table to a folder", () => {
    const now = new Date().toISOString()
    const { lastInsertRowid } = db.prepare(
      `INSERT INTO "_table_folders" ("name", "sort_order", "created_at") VALUES (?, 0, ?)`
    ).run("工作日志", now)
    db.prepare(
      `INSERT INTO "_table_folder_members" ("folder_id", "table_name", "sort_order") VALUES (?, ?, 0)`
    ).run(lastInsertRowid, "work_entry_index")
    const members = db.prepare(`SELECT * FROM "_table_folder_members" WHERE folder_id = ?`).all(lastInsertRowid)
    expect(members).toHaveLength(1)
  })

  it("enforces single-membership (UNIQUE on table_name)", () => {
    const now = new Date().toISOString()
    const { lastInsertRowid: f1 } = db.prepare(
      `INSERT INTO "_table_folders" ("name", "sort_order", "created_at") VALUES (?, 0, ?)`
    ).run("A", now)
    const { lastInsertRowid: f2 } = db.prepare(
      `INSERT INTO "_table_folders" ("name", "sort_order", "created_at") VALUES (?, 0, ?)`
    ).run("B", now)
    db.prepare(
      `INSERT INTO "_table_folder_members" ("folder_id", "table_name", "sort_order") VALUES (?, ?, 0)`
    ).run(f1, "my_table")
    expect(() => {
      db.prepare(
        `INSERT INTO "_table_folder_members" ("folder_id", "table_name", "sort_order") VALUES (?, ?, 0)`
      ).run(f2, "my_table")
    }).toThrow()
  })

  it("cascade deletes members when folder is deleted", () => {
    const now = new Date().toISOString()
    const { lastInsertRowid } = db.prepare(
      `INSERT INTO "_table_folders" ("name", "sort_order", "created_at") VALUES (?, 0, ?)`
    ).run("temp", now)
    db.prepare(
      `INSERT INTO "_table_folder_members" ("folder_id", "table_name", "sort_order") VALUES (?, ?, 0)`
    ).run(lastInsertRowid, "t1")
    db.prepare(`DELETE FROM "_table_folders" WHERE id = ?`).run(lastInsertRowid)
    const remaining = db.prepare(`SELECT * FROM "_table_folder_members" WHERE folder_id = ?`).all(lastInsertRowid)
    expect(remaining).toHaveLength(0)
  })
})
```

- [ ] **Step 2: Run tests**

Run: `cd desktop && pnpm test -- --run electron/database/__tests__/folder-service.test.ts`
Expected: PASS (these test raw SQL, not service methods yet)

- [ ] **Step 3: Add folder methods to DatabaseService class**

Add the following methods to the `DatabaseService` class in `desktop/electron/database/service.ts`:

```typescript
  folderList(): { id: number; name: string; sortOrder: number; members: { tableName: string; sortOrder: number }[] }[] {
    const db = this.getDb()
    const folders = db.prepare(`SELECT id, name, sort_order FROM "_table_folders" ORDER BY sort_order, id`).all() as {
      id: number | bigint
      name: string
      sort_order: number | bigint
    }[]
    const members = db.prepare(`SELECT folder_id, table_name, sort_order FROM "_table_folder_members" ORDER BY sort_order`).all() as {
      folder_id: number | bigint
      table_name: string
      sort_order: number | bigint
    }[]
    const membersByFolder = new Map<number, { tableName: string; sortOrder: number }[]>()
    for (const m of members) {
      const fid = toNumber(m.folder_id)
      const list = membersByFolder.get(fid) ?? []
      list.push({ tableName: m.table_name, sortOrder: toNumber(m.sort_order) })
      membersByFolder.set(fid, list)
    }
    return folders.map((f) => ({
      id: toNumber(f.id),
      name: f.name,
      sortOrder: toNumber(f.sort_order),
      members: membersByFolder.get(toNumber(f.id)) ?? [],
    }))
  }

  folderCreate(name: string): { id: number } {
    const db = this.getDb()
    const trimmed = name.trim()
    if (!trimmed) throw new Error("Folder name cannot be empty")
    const maxOrder = db.prepare(`SELECT MAX(sort_order) as m FROM "_table_folders"`).get() as { m: number | bigint | null }
    const sortOrder = (maxOrder?.m != null ? toNumber(maxOrder.m) : -1) + 1
    const now = new Date().toISOString()
    const result = db.prepare(
      `INSERT INTO "_table_folders" ("name", "sort_order", "created_at") VALUES (?, ?, ?)`
    ).run(trimmed, sortOrder, now)
    return { id: toNumber(result.lastInsertRowid) }
  }

  folderRename(id: number, name: string): void {
    const db = this.getDb()
    const trimmed = name.trim()
    if (!trimmed) throw new Error("Folder name cannot be empty")
    const result = db.prepare(`UPDATE "_table_folders" SET name = ? WHERE id = ?`).run(trimmed, id)
    if (result.changes === 0) throw new Error(`Folder not found: ${id}`)
  }

  folderDelete(id: number): void {
    const db = this.getDb()
    db.exec("PRAGMA foreign_keys=ON")
    const result = db.prepare(`DELETE FROM "_table_folders" WHERE id = ?`).run(id)
    if (result.changes === 0) throw new Error(`Folder not found: ${id}`)
  }

  folderMoveTable(tableName: string, folderId: number | null): void {
    const db = this.getDb()
    db.prepare(`DELETE FROM "_table_folder_members" WHERE table_name = ?`).run(tableName)
    if (folderId !== null) {
      const maxOrder = db.prepare(
        `SELECT MAX(sort_order) as m FROM "_table_folder_members" WHERE folder_id = ?`
      ).get(folderId) as { m: number | bigint | null }
      const sortOrder = (maxOrder?.m != null ? toNumber(maxOrder.m) : -1) + 1
      db.prepare(
        `INSERT INTO "_table_folder_members" ("folder_id", "table_name", "sort_order") VALUES (?, ?, ?)`
      ).run(folderId, tableName, sortOrder)
    }
  }

  folderReorder(folderId: number, tableNames: string[]): void {
    const db = this.getDb()
    const update = db.prepare(`UPDATE "_table_folder_members" SET sort_order = ? WHERE folder_id = ? AND table_name = ?`)
    for (let i = 0; i < tableNames.length; i++) {
      update.run(i, folderId, tableNames[i])
    }
  }

  folderReorderFolders(folderIds: number[]): void {
    const db = this.getDb()
    const update = db.prepare(`UPDATE "_table_folders" SET sort_order = ? WHERE id = ?`)
    for (let i = 0; i < folderIds.length; i++) {
      update.run(i, folderIds[i])
    }
  }

  folderCleanupOrphans(existingTableNames: string[]): void {
    const db = this.getDb()
    if (existingTableNames.length === 0) {
      db.exec(`DELETE FROM "_table_folder_members"`)
      return
    }
    const placeholders = existingTableNames.map(() => "?").join(",")
    db.prepare(
      `DELETE FROM "_table_folder_members" WHERE table_name NOT IN (${placeholders})`
    ).run(...existingTableNames)
  }
```

- [ ] **Step 4: Call folderCleanupOrphans in databaseTableList**

In the `databaseTableList()` method (line ~678), after getting the table list, add orphan cleanup:

```typescript
  databaseTableList(): DatabaseTableInfo[] {
    const tables = this.getSchemaManager().databaseTableList()
    this.folderCleanupOrphans(tables.map((t) => t.name))
    return tables
  }
```

- [ ] **Step 5: Sync folder members on table rename**

In the `databaseTableRename` method (line ~1073), after the rename, update folder membership:

```typescript
  databaseTableRename(from: string, to: string): void {
    this.getSchemaManager().databaseTableRename(from, to)
    const db = this.getDb()
    db.prepare(`UPDATE "_table_folder_members" SET table_name = ? WHERE table_name = ?`).run(to, from)
  }
```

- [ ] **Step 6: Run all database tests**

Run: `cd desktop && pnpm test -- --run electron/database/`
Expected: PASS

- [ ] **Step 7: Commit**

```bash
git add desktop/electron/database/service.ts desktop/electron/database/__tests__/folder-service.test.ts
git commit -m "feat(database): add folder CRUD methods to DatabaseService"
```

---

### Task 3: IPC Channels and Handlers for Folders

**Files:**
- Modify: `desktop/electron/database/channels.ts`
- Modify: `desktop/electron/database/ipc-handlers.ts`
- Modify: `desktop/src/types/bridge.ts`
- Modify: `desktop/src/types/database.ts`

- [ ] **Step 1: Add folder types to database types**

In `desktop/src/types/database.ts`, add:

```typescript
type DatabaseFolder = {
  id: number
  name: string
  sortOrder: number
  members: { tableName: string; sortOrder: number }[]
}
```

And add `DatabaseFolder` to the exports at the bottom of the file.

- [ ] **Step 2: Add IPC channels**

In `desktop/electron/database/channels.ts`, add before the closing `} as const`:

```typescript
  databaseFolderList: "synapse:database:folder:list",
  databaseFolderCreate: "synapse:database:folder:create",
  databaseFolderRename: "synapse:database:folder:rename",
  databaseFolderDelete: "synapse:database:folder:delete",
  databaseFolderMoveTable: "synapse:database:folder:move-table",
  databaseFolderReorder: "synapse:database:folder:reorder",
  databaseFolderReorderFolders: "synapse:database:folder:reorder-folders",
```

- [ ] **Step 3: Add IPC handlers**

In `desktop/electron/database/ipc-handlers.ts`, inside `registerDatabaseHandlers()`, add:

```typescript
  handleValidatedIpc(DATABASE_IPC_CHANNELS.databaseFolderList, async () => {
    return databaseService.folderList()
  })

  handleValidatedIpc(DATABASE_IPC_CHANNELS.databaseFolderCreate, async (_event, params: {
    name: string
  }) => {
    return databaseService.folderCreate(params.name)
  })

  handleValidatedIpc(DATABASE_IPC_CHANNELS.databaseFolderRename, async (_event, params: {
    id: number
    name: string
  }) => {
    databaseService.folderRename(params.id, params.name)
  })

  handleValidatedIpc(DATABASE_IPC_CHANNELS.databaseFolderDelete, async (_event, params: {
    id: number
  }) => {
    databaseService.folderDelete(params.id)
  })

  handleValidatedIpc(DATABASE_IPC_CHANNELS.databaseFolderMoveTable, async (_event, params: {
    tableName: string
    folderId: number | null
  }) => {
    databaseService.folderMoveTable(params.tableName, params.folderId)
  })

  handleValidatedIpc(DATABASE_IPC_CHANNELS.databaseFolderReorder, async (_event, params: {
    folderId: number
    tableNames: string[]
  }) => {
    databaseService.folderReorder(params.folderId, params.tableNames)
  })

  handleValidatedIpc(DATABASE_IPC_CHANNELS.databaseFolderReorderFolders, async (_event, params: {
    folderIds: number[]
  }) => {
    databaseService.folderReorderFolders(params.folderIds)
  })
```

- [ ] **Step 4: Add bridge type definitions**

In `desktop/src/types/bridge.ts`, inside the `database: { ... }` block, add:

```typescript
    databaseFolderList: () => Promise<DatabaseFolder[]>
    databaseFolderCreate: (params: { name: string }) => Promise<{ id: number }>
    databaseFolderRename: (params: { id: number; name: string }) => Promise<void>
    databaseFolderDelete: (params: { id: number }) => Promise<void>
    databaseFolderMoveTable: (params: { tableName: string; folderId: number | null }) => Promise<void>
    databaseFolderReorder: (params: { folderId: number; tableNames: string[] }) => Promise<void>
    databaseFolderReorderFolders: (params: { folderIds: number[] }) => Promise<void>
```

Also add `DatabaseFolder` to the import from `"./database"` at the top.

- [ ] **Step 5: Run typecheck**

Run: `cd desktop && pnpm typecheck`
Expected: PASS (no type errors)

- [ ] **Step 6: Commit**

```bash
git add desktop/electron/database/channels.ts desktop/electron/database/ipc-handlers.ts desktop/src/types/bridge.ts desktop/src/types/database.ts
git commit -m "feat(database): add folder IPC channels, handlers, and bridge types"
```

---

### Task 4: Renderer Hook for Folders

**Files:**
- Create: `desktop/src/modules/database/hooks/use-database-folders.ts`

- [ ] **Step 1: Create the hook**

```typescript
import { useCallback, useEffect, useState } from "react"
import { requireSynapseBridge } from "@/lib/electron-bridge"
import type { DatabaseFolder } from "@/types/database"

function useDatabaseFolders() {
  const [folders, setFolders] = useState<DatabaseFolder[]>([])
  const [loading, setLoading] = useState(true)

  const refresh = useCallback(async () => {
    setLoading(true)
    try {
      const result = await requireSynapseBridge().database.databaseFolderList()
      setFolders(result)
    } catch {
      setFolders([])
    } finally {
      setLoading(false)
    }
  }, [])

  useEffect(() => {
    void refresh()
  }, [refresh])

  const createFolder = useCallback(async (name: string) => {
    const result = await requireSynapseBridge().database.databaseFolderCreate({ name })
    await refresh()
    return result
  }, [refresh])

  const renameFolder = useCallback(async (id: number, name: string) => {
    await requireSynapseBridge().database.databaseFolderRename({ id, name })
    await refresh()
  }, [refresh])

  const deleteFolder = useCallback(async (id: number) => {
    await requireSynapseBridge().database.databaseFolderDelete({ id })
    await refresh()
  }, [refresh])

  const moveTable = useCallback(async (tableName: string, folderId: number | null) => {
    await requireSynapseBridge().database.databaseFolderMoveTable({ tableName, folderId })
    await refresh()
  }, [refresh])

  const reorderTables = useCallback(async (folderId: number, tableNames: string[]) => {
    await requireSynapseBridge().database.databaseFolderReorder({ folderId, tableNames })
    await refresh()
  }, [refresh])

  const reorderFolders = useCallback(async (folderIds: number[]) => {
    await requireSynapseBridge().database.databaseFolderReorderFolders({ folderIds })
    await refresh()
  }, [refresh])

  return {
    folders,
    loading,
    refresh,
    createFolder,
    renameFolder,
    deleteFolder,
    moveTable,
    reorderTables,
    reorderFolders,
  }
}

export { useDatabaseFolders }
```

- [ ] **Step 2: Run typecheck**

Run: `cd desktop && pnpm typecheck`
Expected: PASS

- [ ] **Step 3: Commit**

```bash
git add desktop/src/modules/database/hooks/use-database-folders.ts
git commit -m "feat(database): add useDatabaseFolders hook"
```

---

### Task 5: DatabaseSidebarToolbar Component

**Files:**
- Create: `desktop/src/modules/database/components/database-sidebar-toolbar.tsx`

- [ ] **Step 1: Create the toolbar component**

```typescript
import { FileInput, FolderPlus, AlignLeft, Type, Text } from "lucide-react"
import { Button } from "@/components/ui/button"
import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip"

type DisplayMode = "title+desc" | "title" | "desc"

const DISPLAY_MODE_CYCLE: DisplayMode[] = ["title+desc", "title", "desc"]
const DISPLAY_MODE_LABELS: Record<DisplayMode, string> = {
  "title+desc": "显示标题和介绍",
  "title": "仅显示标题",
  "desc": "仅显示介绍",
}
const DISPLAY_MODE_ICONS: Record<DisplayMode, typeof AlignLeft> = {
  "title+desc": AlignLeft,
  "title": Type,
  "desc": Text,
}

type DatabaseSidebarToolbarProps = {
  displayMode: DisplayMode
  onDisplayModeChange: (mode: DisplayMode) => void
  onImportTable: () => void
  onCreateFolder: () => void
}

function DatabaseSidebarToolbar({
  displayMode,
  onDisplayModeChange,
  onImportTable,
  onCreateFolder,
}: DatabaseSidebarToolbarProps) {
  const DisplayModeIcon = DISPLAY_MODE_ICONS[displayMode]

  function handleDisplayModeToggle() {
    const currentIndex = DISPLAY_MODE_CYCLE.indexOf(displayMode)
    const nextIndex = (currentIndex + 1) % DISPLAY_MODE_CYCLE.length
    onDisplayModeChange(DISPLAY_MODE_CYCLE[nextIndex])
  }

  return (
    <div className="flex items-center gap-0.5 px-1">
      <Tooltip>
        <TooltipTrigger asChild>
          <Button
            variant="ghost"
            size="icon"
            className="size-7"
            onClick={onImportTable}
            data-track="database-import-table-open"
          >
            <FileInput className="size-3.5" />
            <span className="sr-only">导入表</span>
          </Button>
        </TooltipTrigger>
        <TooltipContent>导入表</TooltipContent>
      </Tooltip>
      <Tooltip>
        <TooltipTrigger asChild>
          <Button
            variant="ghost"
            size="icon"
            className="size-7"
            onClick={onCreateFolder}
            data-track="database-create-folder"
          >
            <FolderPlus className="size-3.5" />
            <span className="sr-only">新建文件夹</span>
          </Button>
        </TooltipTrigger>
        <TooltipContent>新建文件夹</TooltipContent>
      </Tooltip>
      <Tooltip>
        <TooltipTrigger asChild>
          <Button
            variant="ghost"
            size="icon"
            className="size-7"
            onClick={handleDisplayModeToggle}
            data-track="database-display-mode-toggle"
          >
            <DisplayModeIcon className="size-3.5" />
            <span className="sr-only">{DISPLAY_MODE_LABELS[displayMode]}</span>
          </Button>
        </TooltipTrigger>
        <TooltipContent>{DISPLAY_MODE_LABELS[displayMode]}</TooltipContent>
      </Tooltip>
    </div>
  )
}

export { DatabaseSidebarToolbar, DISPLAY_MODE_CYCLE, DISPLAY_MODE_LABELS }
export type { DisplayMode }
```

- [ ] **Step 2: Run typecheck**

Run: `cd desktop && pnpm typecheck`
Expected: PASS

- [ ] **Step 3: Commit**

```bash
git add desktop/src/modules/database/components/database-sidebar-toolbar.tsx
git commit -m "feat(database): add DatabaseSidebarToolbar component"
```

---

### Task 6: DatabaseTableFolder Component

**Files:**
- Create: `desktop/src/modules/database/components/database-table-folder.tsx`

- [ ] **Step 1: Create the folder component**

```typescript
import { useState } from "react"
import { Folder, FolderOpen, X } from "lucide-react"
import {
  Collapsible,
  CollapsibleContent,
  CollapsibleTrigger,
} from "@/components/ui/collapsible"
import {
  ContextMenu,
  ContextMenuContent,
  ContextMenuItem,
  ContextMenuTrigger,
} from "@/components/ui/context-menu"
import { cn } from "@/lib/utils"
import type { DatabaseFolder } from "@/types/database"

type DatabaseTableFolderProps = {
  folder: DatabaseFolder
  children: React.ReactNode
  onRename: (id: number) => void
  onDelete: (id: number) => void
  onDrop: (tableName: string, folderId: number) => void
}

function DatabaseTableFolder({
  folder,
  children,
  onRename,
  onDelete,
  onDrop,
}: DatabaseTableFolderProps) {
  const [open, setOpen] = useState(true)
  const [dragOver, setDragOver] = useState(false)

  function handleDragOver(event: React.DragEvent) {
    const type = event.dataTransfer.types.includes("application/x-synapse-table")
    if (!type) return
    event.preventDefault()
    event.dataTransfer.dropEffect = "move"
    setDragOver(true)
  }

  function handleDragLeave() {
    setDragOver(false)
  }

  function handleDrop(event: React.DragEvent) {
    setDragOver(false)
    const tableName = event.dataTransfer.getData("application/x-synapse-table")
    if (tableName) {
      onDrop(tableName, folder.id)
    }
  }

  return (
    <ContextMenu>
      <ContextMenuTrigger asChild>
        <div
          onDragOver={handleDragOver}
          onDragLeave={handleDragLeave}
          onDrop={handleDrop}
        >
          <Collapsible open={open} onOpenChange={setOpen}>
            <div
              className={cn(
                "group/folder flex h-8 w-full items-center justify-between rounded-lg px-3 transition-colors",
                dragOver && "bg-accent",
              )}
            >
              <CollapsibleTrigger className="flex min-w-0 flex-1 items-center gap-2 text-left text-sm font-medium text-foreground/80 outline-none transition-colors hover:text-foreground focus-visible:ring-3 focus-visible:ring-inset focus-visible:ring-ring/50">
                {open ? (
                  <FolderOpen className="size-4 shrink-0" />
                ) : (
                  <Folder className="size-4 shrink-0" />
                )}
                <span className="truncate">{folder.name}</span>
              </CollapsibleTrigger>
              <button
                type="button"
                className="rounded p-0.5 text-muted-foreground opacity-0 transition-opacity hover:text-foreground group-hover/folder:opacity-100"
                onClick={() => onDelete(folder.id)}
                title="删除文件夹"
              >
                <X className="size-3" />
                <span className="sr-only">删除文件夹</span>
              </button>
            </div>
            <CollapsibleContent>
              <div className="flex flex-col pl-3">
                {children}
              </div>
            </CollapsibleContent>
          </Collapsible>
        </div>
      </ContextMenuTrigger>
      <ContextMenuContent>
        <ContextMenuItem onClick={() => onRename(folder.id)}>
          重命名
        </ContextMenuItem>
        <ContextMenuItem
          variant="destructive"
          onClick={() => onDelete(folder.id)}
        >
          删除文件夹
        </ContextMenuItem>
      </ContextMenuContent>
    </ContextMenu>
  )
}

export { DatabaseTableFolder }
```

- [ ] **Step 2: Run typecheck**

Run: `cd desktop && pnpm typecheck`
Expected: PASS

- [ ] **Step 3: Commit**

```bash
git add desktop/src/modules/database/components/database-table-folder.tsx
git commit -m "feat(database): add DatabaseTableFolder component with drag-drop and context menu"
```

---

### Task 7: Refactor DatabaseSidebar

**Files:**
- Modify: `desktop/src/modules/database/components/database-sidebar.tsx`
- Modify: `desktop/src/modules/database/index.tsx`

- [ ] **Step 1: Rewrite DatabaseSidebar with new layout**

Replace the content of `desktop/src/modules/database/components/database-sidebar.tsx`:

```typescript
import { useMemo, useRef, useState } from "react"
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
  const newFolderInputRef = useRef<HTMLInputElement>(null)

  const filteredTables = useMemo(
    () => filterDatabaseTables(tables, searchQuery),
    [tables, searchQuery],
  )

  const isSearching = searchQuery.trim().length > 0

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
          {folders.length > 0 && (
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
                {folderMemberSet.has(table.name) && (
                  <ContextMenuItem onClick={() => onMoveTable(table.name, null)}>
                    移出文件夹
                  </ContextMenuItem>
                )}
              </ContextMenuSubContent>
            </ContextMenuSub>
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
        {/* Inline folder creation input */}
        {creatingFolder && (
          <div className="px-3 py-1">
            <Input
              ref={newFolderInputRef}
              value={newFolderName}
              onChange={(e) => setNewFolderName(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === "Enter") handleCreateFolderConfirm()
                if (e.key === "Escape") handleCreateFolderCancel()
              }}
              onBlur={handleCreateFolderConfirm}
              placeholder="文件夹名称"
              className="h-7 text-sm"
              autoFocus
            />
          </div>
        )}

        {/* Folders (hidden during search) */}
        {!isSearching && folders.map((folder) => {
          if (renamingFolderId === folder.id) {
            return (
              <div key={folder.id} className="px-3 py-1">
                <Input
                  value={renameValue}
                  onChange={(e) => setRenameValue(e.target.value)}
                  onKeyDown={(e) => {
                    if (e.key === "Enter") handleRenameFolderConfirm()
                    if (e.key === "Escape") setRenamingFolderId(null)
                  }}
                  onBlur={handleRenameFolderConfirm}
                  className="h-7 text-sm"
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

        {/* Ungrouped tables / search results */}
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

      {/* Delete folder confirmation */}
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
```

- [ ] **Step 2: Update DatabaseModule to pass new props**

In `desktop/src/modules/database/index.tsx`, add the folder hook and display mode state. Import the new hook and pass props to `DatabaseSidebar`:

At the top, add import:
```typescript
import { useDatabaseFolders } from "./hooks/use-database-folders"
import type { DisplayMode } from "./components/database-sidebar-toolbar"
```

Inside `DatabaseModule()`, add after the existing hooks:
```typescript
  const { folders, createFolder, renameFolder, deleteFolder, moveTable } = useDatabaseFolders()
  const [displayMode, setDisplayMode] = useState<DisplayMode>("title+desc")
```

Update the `<DatabaseSidebar>` JSX to pass new props:
```typescript
  <DatabaseSidebar
    tables={tables}
    folders={folders}
    activeTable={selectedTable}
    displayMode={displayMode}
    onDisplayModeChange={setDisplayMode}
    onTableSelect={handleTableSelect}
    onCreateTable={handleOpenCreateDialog}
    onImportTable={handleChooseImportTable}
    onCreateFolder={createFolder}
    onRenameFolder={renameFolder}
    onDeleteFolder={deleteFolder}
    onMoveTable={moveTable}
  />
```

- [ ] **Step 3: Run typecheck**

Run: `cd desktop && pnpm typecheck`
Expected: PASS

- [ ] **Step 4: Run existing sidebar tests**

Run: `cd desktop && pnpm test -- --run src/modules/database/__tests__/database-sidebar.test.tsx`
Expected: FAIL (test needs updating for new props)

- [ ] **Step 5: Update sidebar test**

Update `desktop/src/modules/database/__tests__/database-sidebar.test.tsx` to pass the new required props:

```typescript
import { renderToStaticMarkup } from "react-dom/server"
import { describe, expect, it, vi } from "vitest"

import {
  DatabaseSidebar,
  filterDatabaseTables,
} from "../components/database-sidebar"
import type { DatabaseTableInfo } from "@/types/database"

const tables: DatabaseTableInfo[] = [
  {
    name: "customer_orders",
    description: "客户订单",
    rowCount: 128,
    createdAt: "2026-04-28T00:00:00.000Z",
    updatedAt: "2026-04-28T00:00:00.000Z",
  },
  {
    name: "product_sku",
    description: "商品编码",
    rowCount: 42,
    createdAt: "2026-04-28T00:00:00.000Z",
    updatedAt: "2026-04-28T00:00:00.000Z",
  },
  {
    name: "audit_log",
    description: "",
    rowCount: 3,
    createdAt: "2026-04-28T00:00:00.000Z",
    updatedAt: "2026-04-28T00:00:00.000Z",
  },
]

describe("DatabaseSidebar", () => {
  it("renders table names and descriptions", () => {
    const html = renderToStaticMarkup(
      <DatabaseSidebar
        tables={tables}
        folders={[]}
        activeTable="customer_orders"
        displayMode="title+desc"
        onDisplayModeChange={vi.fn()}
        onTableSelect={vi.fn()}
        onCreateTable={vi.fn()}
        onImportTable={vi.fn()}
        onCreateFolder={vi.fn()}
        onRenameFolder={vi.fn()}
        onDeleteFolder={vi.fn()}
        onMoveTable={vi.fn()}
      />,
    )

    expect(html).toContain("搜索数据表或备注")
    expect(html).toContain("customer_orders")
    expect(html).toContain("客户订单")
    expect(html).toContain("product_sku")
    expect(html).toContain("商品编码")
  })

  it("filters tables by name or description", () => {
    expect(filterDatabaseTables(tables, "客户").map((table) => table.name))
      .toEqual(["customer_orders"])
    expect(filterDatabaseTables(tables, "PRODUCT").map((table) => table.name))
      .toEqual(["product_sku"])
    expect(filterDatabaseTables(tables, "missing")).toEqual([])
    expect(filterDatabaseTables(tables, "   ").map((table) => table.name))
      .toEqual(["customer_orders", "product_sku", "audit_log"])
  })
})
```

- [ ] **Step 6: Run tests**

Run: `cd desktop && pnpm test -- --run src/modules/database/__tests__/database-sidebar.test.tsx`
Expected: PASS

- [ ] **Step 7: Commit**

```bash
git add desktop/src/modules/database/components/database-sidebar.tsx desktop/src/modules/database/components/database-sidebar-toolbar.tsx desktop/src/modules/database/components/database-table-folder.tsx desktop/src/modules/database/index.tsx desktop/src/modules/database/__tests__/database-sidebar.test.tsx desktop/src/modules/database/hooks/use-database-folders.ts
git commit -m "feat(database): redesign sidebar with toolbar, folders, and drag-drop"
```

---

### Task 8: Display Mode Persistence

**Files:**
- Modify: `desktop/src/modules/database/index.tsx`

- [ ] **Step 1: Persist displayMode to localStorage**

In `desktop/src/modules/database/index.tsx`, replace the simple `useState` for displayMode with localStorage persistence:

```typescript
function getStoredDisplayMode(): DisplayMode {
  const stored = localStorage.getItem("synapse:database:displayMode")
  if (stored === "title" || stored === "desc" || stored === "title+desc") return stored
  return "title+desc"
}

// Inside DatabaseModule:
const [displayMode, setDisplayMode] = useState<DisplayMode>(getStoredDisplayMode)

const handleDisplayModeChange = useCallback((mode: DisplayMode) => {
  setDisplayMode(mode)
  localStorage.setItem("synapse:database:displayMode", mode)
}, [])
```

Update the prop passed to `DatabaseSidebar`:
```typescript
onDisplayModeChange={handleDisplayModeChange}
```

- [ ] **Step 2: Run typecheck**

Run: `cd desktop && pnpm typecheck`
Expected: PASS

- [ ] **Step 3: Commit**

```bash
git add desktop/src/modules/database/index.tsx
git commit -m "feat(database): persist sidebar display mode to localStorage"
```

---

### Task 9: Manual Testing and Polish

**Files:**
- Possibly modify: various files for bug fixes found during testing

- [ ] **Step 1: Start dev server**

Run: `cd /Users/liyang/Documents/code/github/Synapse && pnpm dev`

- [ ] **Step 2: Test golden path**

In the running app, verify:
1. Database sidebar shows unified header (search + add button)
2. Toolbar row shows below header with 3 ghost icon buttons
3. Click "新建文件夹" → inline input appears → type name → Enter creates folder
4. Drag a table onto the folder → table moves inside
5. Right-click table → "移动到文件夹" submenu works
6. Right-click folder → "重命名" and "删除" work
7. Display mode toggle cycles through 3 states correctly
8. Search ignores folder structure and shows flat results
9. Hover folder → delete icon appears

- [ ] **Step 3: Test edge cases**

1. Create folder with empty name → should not create
2. Create duplicate folder name → should show error/reject
3. Delete non-empty folder → confirmation dialog appears
4. Delete empty folder → no confirmation, direct delete
5. Table with no description in "仅介绍" mode → shows table name
6. Drag table from one folder to another → transfers correctly
7. Drag table from folder to root area → removes from folder

- [ ] **Step 4: Fix any issues found and commit**

```bash
git add -A
git commit -m "fix(database): polish sidebar folder interactions"
```

---

### Task 10: Final Typecheck and Test Suite

**Files:** None (verification only)

- [ ] **Step 1: Run full typecheck**

Run: `cd desktop && pnpm typecheck`
Expected: PASS

- [ ] **Step 2: Run full test suite**

Run: `cd desktop && pnpm test`
Expected: PASS

- [ ] **Step 3: Verify no unintended changes**

Run: `git diff --stat main`
Verify only expected files are changed.
