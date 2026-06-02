import { readFileSync } from "node:fs"
import { fileURLToPath } from "node:url"
import { renderToStaticMarkup } from "react-dom/server"
import { describe, expect, it, vi } from "vitest"

import {
  DatabaseSidebar,
  filterDatabaseTables,
} from "../components/database-sidebar"
import { TooltipProvider } from "@/components/ui/tooltip"
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

const sidebarSourcePath = fileURLToPath(new URL("../components/database-sidebar.tsx", import.meta.url))

describe("DatabaseSidebar", () => {
  it("renders table names and descriptions", () => {
    const html = renderToStaticMarkup(
      <TooltipProvider>
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
          onFolderOperationError={vi.fn()}
        />
      </TooltipProvider>,
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

  it("awaits folder creation and only closes the input after success", () => {
    const source = readFileSync(sidebarSourcePath, "utf8")

    expect(source).toContain("async function handleCreateFolderConfirm()")
    expect(source).toContain("await runFolderOperation(\"create\", () => onCreateFolder(trimmed))")
    expect(source).toContain("if (succeeded) {\n      setCreatingFolder(false)")
    expect(source).toContain("onFolderOperationError(action, error)")
  })
})
