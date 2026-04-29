import { renderToStaticMarkup } from "react-dom/server"
import { describe, expect, it, vi } from "vitest"

import {
  DataStoreSidebar,
  filterDataStoreTables,
} from "../components/data-store-sidebar"
import type { DataStoreTableInfo } from "@/types/data-store"

const tables: DataStoreTableInfo[] = [
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

describe("DataStoreSidebar", () => {
  it("renders table descriptions under table names without row icons", () => {
    const html = renderToStaticMarkup(
      <DataStoreSidebar
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
    expect(html).not.toContain("lucide-table-2")
  })

  it("filters tables by name or description", () => {
    expect(filterDataStoreTables(tables, "客户").map((table) => table.name))
      .toEqual(["customer_orders"])
    expect(filterDataStoreTables(tables, "PRODUCT").map((table) => table.name))
      .toEqual(["product_sku"])
    expect(filterDataStoreTables(tables, "missing")).toEqual([])
    expect(filterDataStoreTables(tables, "   ").map((table) => table.name))
      .toEqual(["customer_orders", "product_sku", "audit_log"])
  })
})
