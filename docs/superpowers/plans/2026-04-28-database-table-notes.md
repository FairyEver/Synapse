# Database Table Notes Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Show table descriptions under table names in the Database sidebar, search by descriptions, and let users edit the table description from the schema dialog.

**Architecture:** The existing `_meta_tables.description` field remains the source of truth. Add one desktop IPC operation for table-description updates, keep table list filtering in the sidebar, and keep the schema dialog responsible only for transient edit state.

**Tech Stack:** Electron, React, TypeScript, Vitest, shadcn/ui, Tailwind token classes.

---

## File Structure

- Modify `desktop/electron/database/service.ts`: add `databaseService.databaseTableUpdate(table, description)`.
- Create `desktop/electron/database/__tests__/service.test.ts`: cover persisted table description updates.
- Modify `desktop/electron/database/channels.ts`: add the IPC channel constant.
- Modify `desktop/electron/database/ipc-handlers.ts`: register the update handler.
- Modify `desktop/electron/preload.ts`: expose the new bridge method.
- Modify `desktop/electron/__tests__/preload.test.ts`: cover preload channel mapping.
- Modify `desktop/src/types/bridge.ts`: add the renderer bridge method type.
- Modify `desktop/src/modules/database/hooks/use-database.ts`: add and export the renderer wrapper.
- Modify `desktop/src/components/module-sidebar.tsx`: add optional two-line item support via `description`.
- Modify `desktop/src/modules/database/components/database-sidebar.tsx`: render descriptions and filter by name or description.
- Create `desktop/src/modules/database/__tests__/database-sidebar.test.tsx`: cover description rendering and search filtering.
- Modify `desktop/src/modules/database/components/table-schema-sheet.tsx`: add table description edit state and commit behavior.
- Modify `desktop/src/modules/database/index.tsx`: wire description updates to refresh schema and table list.
- Create `desktop/src/modules/database/__tests__/table-schema-sheet-layout.test.ts`: source-level guard for the table description editor surface.

## Task 1: Main-Process Table Description Persistence

**Files:**
- Create: `desktop/electron/database/__tests__/service.test.ts`
- Modify: `desktop/electron/database/service.ts`

- [ ] **Step 1: Write the failing service test**

Create `desktop/electron/database/__tests__/service.test.ts`:

```ts
import { mkdtemp, rm } from "node:fs/promises"
import os from "node:os"
import path from "node:path"
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest"

const electronMock = vi.hoisted(() => ({
  app: {
    getPath: vi.fn(),
  },
}))

vi.mock("electron", () => electronMock)

vi.mock("../../services/log-store", () => ({
  createMainLogger: () => ({
    debug: vi.fn(),
    error: vi.fn(),
    info: vi.fn(),
    warn: vi.fn(),
  }),
}))

let tempDir = ""
let service: typeof import("../service").databaseService

describe("DatabaseService table descriptions", () => {
  beforeEach(async () => {
    tempDir = await mkdtemp(path.join(os.tmpdir(), "synapse-database-"))
    electronMock.app.getPath.mockReturnValue(tempDir)
    vi.resetModules()

    const module = await import("../service")
    service = module.databaseService
    service.open()
  })

  afterEach(async () => {
    service.close()
    await rm(tempDir, { recursive: true, force: true })
    electronMock.app.getPath.mockReset()
  })

  it("updates table descriptions in list and schema metadata", () => {
    service.databaseTableCreate(
      "customer_orders",
      [{ name: "customer_name", kind: "text" }],
      "old note",
    )

    service.databaseTableUpdate("customer_orders", "客户订单")

    expect(service.databaseTableDescribe("customer_orders").description).toBe("客户订单")
    expect(service.databaseTableList()).toContainEqual(expect.objectContaining({
      name: "customer_orders",
      description: "客户订单",
    }))
  })

  it("allows clearing a table description", () => {
    service.databaseTableCreate(
      "product_sku",
      [{ name: "sku_code", kind: "text" }],
      "商品编码",
    )

    service.databaseTableUpdate("product_sku", "")

    expect(service.databaseTableDescribe("product_sku").description).toBe("")
    expect(service.databaseTableList()).toContainEqual(expect.objectContaining({
      name: "product_sku",
      description: "",
    }))
  })
})
```

- [ ] **Step 2: Run the test to verify it fails**

Run:

```bash
pnpm --filter @synapse/desktop exec vitest run electron/database/__tests__/service.test.ts
```

Expected: FAIL with a runtime error like `service.databaseTableUpdate is not a function`.

- [ ] **Step 3: Implement the minimal service method**

In `desktop/electron/database/service.ts`, add this method after `databaseTableDescribe(name: string): DatabaseTableSchema`:

```ts
  databaseTableUpdate(table: string, description: string): void {
    validateName(table, "table")
    this.assertTableExists(table)

    const db = this.getDb()
    db.prepare(`UPDATE "_meta_tables" SET description = ?, updated_at = ? WHERE name = ?`)
      .run(description, new Date().toISOString(), table)
  }
```

- [ ] **Step 4: Run the service test to verify it passes**

Run:

```bash
pnpm --filter @synapse/desktop exec vitest run electron/database/__tests__/service.test.ts
```

Expected: PASS for both table-description tests.

- [ ] **Step 5: Commit Task 1**

Run:

```bash
git add desktop/electron/database/service.ts desktop/electron/database/__tests__/service.test.ts
git commit -m "feat: update database table descriptions"
```

## Task 2: IPC, Preload, Bridge, and Renderer Hook Contract

**Files:**
- Modify: `desktop/electron/database/channels.ts`
- Modify: `desktop/electron/database/ipc-handlers.ts`
- Modify: `desktop/electron/preload.ts`
- Modify: `desktop/electron/__tests__/preload.test.ts`
- Modify: `desktop/src/types/bridge.ts`
- Modify: `desktop/src/modules/database/hooks/use-database.ts`

- [ ] **Step 1: Write the failing preload mapping test**

In `desktop/electron/__tests__/preload.test.ts`, add this test inside `describe("preload bridge", () => { ... })`:

```ts
  it("maps table description updates to the database IPC channel", async () => {
    const bridge = await loadPreloadBridge()

    await bridge.database.databaseTableUpdate({
      table: "customer_orders",
      description: "客户订单",
    })

    expect(electronMock.ipcRenderer.invoke).toHaveBeenCalledWith(
      "synapse:database:table:update",
      {
        table: "customer_orders",
        description: "客户订单",
      },
    )
  })
```

- [ ] **Step 2: Run the preload test to verify it fails**

Run:

```bash
pnpm --filter @synapse/desktop exec vitest run electron/__tests__/preload.test.ts
```

Expected: FAIL with `bridge.database.databaseTableUpdate is not a function`.

- [ ] **Step 3: Add the database channel**

In `desktop/electron/database/channels.ts`, add the channel after `databaseTableDescribe`:

```ts
  databaseTableUpdate: "synapse:database:table:update",
```

In `desktop/electron/preload.ts`, add the same entry to `DATABASE_CHANNELS` after `databaseTableDescribe`:

```ts
  databaseTableUpdate: "synapse:database:table:update",
```

- [ ] **Step 4: Register the IPC handler**

In `desktop/electron/database/ipc-handlers.ts`, add this block after the `databaseTableDescribe` handler:

```ts
  handleValidatedIpc(DATABASE_IPC_CHANNELS.databaseTableUpdate, async (_event, params: {
    table: string
    description: string
  }) => {
    databaseService.databaseTableUpdate(params.table, params.description)
  })
```

- [ ] **Step 5: Expose the bridge method in preload**

In `desktop/electron/preload.ts`, add this method after `databaseTableDescribe` in the exposed `database` object:

```ts
    databaseTableUpdate: (params) =>
      invoke(DATABASE_CHANNELS.databaseTableUpdate)(params),
```

- [ ] **Step 6: Update the renderer bridge type**

In `desktop/src/types/bridge.ts`, add this method after `databaseTableDescribe`:

```ts
    databaseTableUpdate: (params: { table: string; description: string }) => Promise<void>
```

- [ ] **Step 7: Add the renderer hook wrapper**

In `desktop/src/modules/database/hooks/use-database.ts`, add this function after `databaseTableDelete`:

```ts
async function databaseTableUpdate(table: string, description: string): Promise<void> {
  await requireSynapseBridge().database.databaseTableUpdate({ table, description })
}
```

Add `databaseTableUpdate` to the named export list near the existing update helpers:

```ts
  databaseTableUpdate,
```

- [ ] **Step 8: Run the preload test to verify it passes**

Run:

```bash
pnpm --filter @synapse/desktop exec vitest run electron/__tests__/preload.test.ts
```

Expected: PASS, including the new table-description mapping test.

- [ ] **Step 9: Commit Task 2**

Run:

```bash
git add desktop/electron/database/channels.ts desktop/electron/database/ipc-handlers.ts desktop/electron/preload.ts desktop/electron/__tests__/preload.test.ts desktop/src/types/bridge.ts desktop/src/modules/database/hooks/use-database.ts
git commit -m "feat: expose table description updates"
```

## Task 3: Sidebar Description Rendering and Search

**Files:**
- Modify: `desktop/src/components/module-sidebar.tsx`
- Modify: `desktop/src/modules/database/components/database-sidebar.tsx`
- Create: `desktop/src/modules/database/__tests__/database-sidebar.test.tsx`

- [ ] **Step 1: Write the failing sidebar tests**

Create `desktop/src/modules/database/__tests__/database-sidebar.test.tsx`:

```tsx
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
  it("renders table descriptions under table names", () => {
    const html = renderToStaticMarkup(
      <DatabaseSidebar
        tables={tables}
        activeTable="customer_orders"
        onTableSelect={vi.fn()}
        onCreateTable={vi.fn()}
        onImportTable={vi.fn()}
      />,
    )

    expect(html).toContain("搜索数据表或备注")
    expect(html).toContain("customer_orders")
    expect(html).toContain("客户订单")
    expect(html).toContain("product_sku")
    expect(html).toContain("商品编码")
    expect(html).not.toContain("暂无备注")
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

- [ ] **Step 2: Run the sidebar test to verify it fails**

Run:

```bash
pnpm --filter @synapse/desktop exec vitest run src/modules/database/__tests__/database-sidebar.test.tsx
```

Expected: FAIL because `filterDatabaseTables` is not exported and the sidebar does not render descriptions.

- [ ] **Step 3: Add optional description support to ModuleSidebarItem**

In `desktop/src/components/module-sidebar.tsx`, add `description?: ReactNode` to `ModuleSidebarItemProps`:

```ts
  description?: ReactNode
```

Include `description` in the destructuring:

```ts
  description,
```

Replace the `className={cn(...)}` block on the `<button>` with:

```ts
      className={cn(
        "flex w-full items-center justify-between rounded-lg px-3 text-sm font-medium text-foreground/80 transition-colors outline-none",
        description ? "min-h-11 py-1.5" : "h-8",
        "hover:bg-muted/60 hover:text-foreground",
        "focus-visible:ring-3 focus-visible:ring-inset focus-visible:ring-ring/50",
        "disabled:pointer-events-none disabled:opacity-50",
        active && "bg-secondary text-secondary-foreground hover:bg-secondary",
        className,
      )}
```

Replace the current inner label span with:

```tsx
      <span className="flex min-w-0 items-center gap-2 text-left">
        {Icon ? <Icon className="size-4 shrink-0" /> : iconElement ?? null}
        <span className="flex min-w-0 flex-col">
          <span className="truncate">{children}</span>
          {description ? (
            <span className="truncate text-xs font-normal text-muted-foreground">
              {description}
            </span>
          ) : null}
        </span>
      </span>
```

- [ ] **Step 4: Add sidebar filtering by description**

In `desktop/src/modules/database/components/database-sidebar.tsx`, add this helper above `DatabaseSidebar`:

```ts
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
```

Replace the existing `filteredTables` memo with:

```ts
  const filteredTables = useMemo(
    () => filterDatabaseTables(tables, searchQuery),
    [tables, searchQuery],
  )
```

Change the search placeholder to:

```tsx
        searchPlaceholder="搜索数据表或备注"
```

Pass the description into `ModuleSidebarItem`:

```tsx
              description={table.description.trim() || undefined}
```

Update the export at the bottom:

```ts
export { DatabaseSidebar, filterDatabaseTables }
```

- [ ] **Step 5: Run the sidebar test to verify it passes**

Run:

```bash
pnpm --filter @synapse/desktop exec vitest run src/modules/database/__tests__/database-sidebar.test.tsx
```

Expected: PASS for description rendering and name/description search.

- [ ] **Step 6: Commit Task 3**

Run:

```bash
git add desktop/src/components/module-sidebar.tsx desktop/src/modules/database/components/database-sidebar.tsx desktop/src/modules/database/__tests__/database-sidebar.test.tsx
git commit -m "feat: show database table notes in sidebar"
```

## Task 4: Schema Dialog Table Description Editor

**Files:**
- Modify: `desktop/src/modules/database/components/table-schema-sheet.tsx`
- Modify: `desktop/src/modules/database/index.tsx`
- Create: `desktop/src/modules/database/__tests__/table-schema-sheet-layout.test.ts`

- [ ] **Step 1: Write the failing schema sheet layout test**

Create `desktop/src/modules/database/__tests__/table-schema-sheet-layout.test.ts`:

```ts
import { readFile } from "node:fs/promises"
import { describe, expect, it } from "vitest"

describe("TableSchemaSheet table description editor", () => {
  it("exposes a compact table description editor before the columns table", async () => {
    const source = await readFile(
      new URL("../components/table-schema-sheet.tsx", import.meta.url),
      "utf8",
    )

    const descriptionIndex = source.indexOf("表备注")
    const tableIndex = source.indexOf("<Table>")

    expect(source).toContain("onUpdateTableDescription")
    expect(source).toContain("id=\"table-description\"")
    expect(source).toContain("commitTableDescription")
    expect(descriptionIndex).toBeGreaterThan(-1)
    expect(tableIndex).toBeGreaterThan(-1)
    expect(descriptionIndex).toBeLessThan(tableIndex)
  })
})
```

- [ ] **Step 2: Run the schema sheet layout test to verify it fails**

Run:

```bash
pnpm --filter @synapse/desktop exec vitest run src/modules/database/__tests__/table-schema-sheet-layout.test.ts
```

Expected: FAIL because `onUpdateTableDescription`, `table-description`, and `表备注` are not present.

- [ ] **Step 3: Import `useEffect` in the schema sheet**

In `desktop/src/modules/database/components/table-schema-sheet.tsx`, change the React import to:

```ts
import { useCallback, useEffect, useMemo, useRef, useState } from "react"
```

- [ ] **Step 4: Add the schema sheet prop**

In `TableSchemaSheetProps`, add:

```ts
  onUpdateTableDescription: (description: string) => Promise<void> | void
```

Include it in the component destructuring:

```ts
  onUpdateTableDescription,
```

- [ ] **Step 5: Add table description edit state and commit logic**

Inside `TableSchemaSheet`, after the existing `newColChoices` state, add:

```ts
  const [tableDescription, setTableDescription] = useState("")
  const [isTableDescriptionSaving, setIsTableDescriptionSaving] = useState(false)
```

After `editingChoicesColumn`, add:

```ts
  useEffect(() => {
    setTableDescription(schema?.description ?? "")
  }, [schema?.description, schema?.name])

  const commitTableDescription = useCallback(async () => {
    if (!schema) return

    const nextDescription = tableDescription.trim()
    if (nextDescription === schema.description) return

    setIsTableDescriptionSaving(true)
    try {
      await onUpdateTableDescription(nextDescription)
    } finally {
      setIsTableDescriptionSaving(false)
    }
  }, [onUpdateTableDescription, schema, tableDescription])
```

- [ ] **Step 6: Render the table description input before the columns table**

In `desktop/src/modules/database/components/table-schema-sheet.tsx`, inside the scrollable body and before the existing `<div className="min-h-0 overflow-auto rounded-md border">`, add:

```tsx
          <div className="flex flex-col gap-2">
            <Label htmlFor="table-description">表备注</Label>
            <Input
              id="table-description"
              value={tableDescription}
              disabled={isTableDescriptionSaving}
              onChange={(event) => setTableDescription(event.target.value)}
              onBlur={() => {
                void commitTableDescription()
              }}
              onKeyDown={(event) => {
                if (event.key === "Enter") {
                  event.currentTarget.blur()
                }
                if (event.key === "Escape") {
                  setTableDescription(schema.description)
                  event.currentTarget.blur()
                }
              }}
            />
          </div>
```

- [ ] **Step 7: Wire the DatabaseModule handler**

In `desktop/src/modules/database/index.tsx`, add `databaseTableUpdate` to the hook imports:

```ts
  databaseTableUpdate,
```

Add this handler after `handleDropTable`:

```ts
  const handleUpdateTableDescription = useCallback(
    async (description: string) => {
      if (!selectedTable) return

      try {
        await databaseTableUpdate(selectedTable, description)
        await refreshSchema()
        await refreshTables()
      } catch (error) {
        logger.error("Table description update failed.", { error })
        showError(error instanceof Error ? error.message : "保存失败")
      }
    },
    [refreshSchema, refreshTables, selectedTable, showError],
  )
```

Pass the handler to `TableSchemaSheet`:

```tsx
        onUpdateTableDescription={handleUpdateTableDescription}
```

- [ ] **Step 8: Run the schema sheet layout test to verify it passes**

Run:

```bash
pnpm --filter @synapse/desktop exec vitest run src/modules/database/__tests__/table-schema-sheet-layout.test.ts
```

Expected: PASS.

- [ ] **Step 9: Commit Task 4**

Run:

```bash
git add desktop/src/modules/database/components/table-schema-sheet.tsx desktop/src/modules/database/index.tsx desktop/src/modules/database/__tests__/table-schema-sheet-layout.test.ts
git commit -m "feat: edit database table notes"
```

## Task 5: Final Verification

**Files:**
- No planned file edits.

- [ ] **Step 1: Run all targeted tests**

Run:

```bash
pnpm --filter @synapse/desktop exec vitest run electron/database/__tests__/service.test.ts electron/__tests__/preload.test.ts src/modules/database/__tests__/database-sidebar.test.tsx src/modules/database/__tests__/table-schema-sheet-layout.test.ts
```

Expected: PASS for service, preload, sidebar, and schema sheet tests.

- [ ] **Step 2: Run typecheck**

Run:

```bash
pnpm desktop:typecheck
```

Expected: PASS with no TypeScript errors.

- [ ] **Step 3: Run hard-constraint check**

Run:

```bash
pnpm desktop:check:hard-constraints
```

Expected: PASS. The change adds a database IPC handler through the existing database handler file and does not introduce bare `ipcMain`, direct renderer Electron access, or business-data `fs.writeFile`.

- [ ] **Step 4: Inspect the final diff**

Run:

```bash
git status --short
git log --oneline -n 5
```

Expected: `git status --short` is empty after the task commits, and the latest commits include the four feature commits from this plan.
