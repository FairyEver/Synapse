/**
 * @vitest-environment jsdom
 */
import { readFileSync } from "node:fs"
import { join } from "node:path"
import { act } from "react"
import { createRoot, type Root } from "react-dom/client"
import { renderToStaticMarkup } from "react-dom/server"
import { afterEach, describe, expect, it, vi } from "vitest"

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

const sidebarSourcePath = join(process.cwd(), "src/modules/database/components/database-sidebar.tsx")
const roots: Root[] = []

;(globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT: boolean }).IS_REACT_ACT_ENVIRONMENT = true
globalThis.ResizeObserver = class ResizeObserverMock {
  observe() {}
  unobserve() {}
  disconnect() {}
} as typeof ResizeObserver

afterEach(() => {
  for (const root of roots.splice(0)) {
    act(() => root.unmount())
  }
  document.body.replaceChildren()
})

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
    const source = readFileSync(sidebarSourcePath, "utf8").replace(/\r\n/g, "\n")

    expect(source).toContain("async function handleCreateFolderConfirm(restoreFocus = true)")
    expect(source).toContain("await runFolderOperation(\"create\", () => onCreateFolder(trimmed))")
    expect(source).toContain("if (succeeded) {\n      setCreatingFolder(false)")
    expect(source).toContain("onFolderOperationError(action, error)")
  })

  it("restores focus after deleting a folder", () => {
    const source = readFileSync(sidebarSourcePath, "utf8").replace(/\r\n/g, "\n")
    const deleteIndex = source.indexOf("async function handleDeleteFolder(id: number)")
    const confirmIndex = source.indexOf("async function handleDeleteFolderConfirm", deleteIndex)

    expect(source.slice(deleteIndex, confirmIndex)).toContain("restoreCreateFolderButtonFocus()")
  })

  it("returns focus to the create folder action after cancelling or submitting an empty name", async () => {
    const container = document.createElement("div")
    document.body.append(container)
    const root = createRoot(container)
    roots.push(root)

    await act(async () => {
      root.render(
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
        />,
      )
    })

    const createFolderButton = [...container.querySelectorAll<HTMLButtonElement>("button")]
      .find((button) => button.textContent?.trim() === "新建文件夹")
    expect(createFolderButton).toBeTruthy()

    await act(async () => createFolderButton!.click())
    const cancelInput = container.querySelector<HTMLInputElement>('input[placeholder="文件夹名称"]')
    expect(document.activeElement).toBe(cancelInput)
    await act(async () => {
      cancelInput!.dispatchEvent(new KeyboardEvent("keydown", { key: "Escape", bubbles: true }))
      await new Promise((resolve) => window.setTimeout(resolve))
    })
    expect(document.activeElement).toBe(createFolderButton)

    await act(async () => createFolderButton!.click())
    const emptyInput = container.querySelector<HTMLInputElement>('input[placeholder="文件夹名称"]')
    expect(document.activeElement).toBe(emptyInput)
    await act(async () => {
      emptyInput!.dispatchEvent(new KeyboardEvent("keydown", { key: "Enter", bubbles: true }))
      await new Promise((resolve) => window.setTimeout(resolve))
    })
    expect(document.activeElement).toBe(createFolderButton)
  })

  it("keeps focus in the folder name input after creation fails", async () => {
    const container = document.createElement("div")
    document.body.append(container)
    const root = createRoot(container)
    roots.push(root)
    const onCreateFolder = vi.fn().mockRejectedValue(new Error("duplicate"))
    const outsideButton = document.createElement("button")
    document.body.append(outsideButton)
    const onFolderOperationError = vi.fn(() => outsideButton.focus())

    await act(async () => {
      root.render(
        <DatabaseSidebar
          tables={tables}
          folders={[]}
          activeTable="customer_orders"
          displayMode="title+desc"
          onDisplayModeChange={vi.fn()}
          onTableSelect={vi.fn()}
          onCreateTable={vi.fn()}
          onImportTable={vi.fn()}
          onCreateFolder={onCreateFolder}
          onRenameFolder={vi.fn()}
          onDeleteFolder={vi.fn()}
          onMoveTable={vi.fn()}
          onFolderOperationError={onFolderOperationError}
        />,
      )
    })

    const createFolderButton = [...container.querySelectorAll<HTMLButtonElement>("button")]
      .find((button) => button.textContent?.trim() === "新建文件夹")
    await act(async () => createFolderButton!.click())
    const input = container.querySelector<HTMLInputElement>('input[placeholder="文件夹名称"]')!
    await act(async () => {
      const valueSetter = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, "value")?.set
      valueSetter?.call(input, "duplicate")
      input.dispatchEvent(new Event("input", { bubbles: true }))
      input.dispatchEvent(new KeyboardEvent("keydown", { key: "Enter", bubbles: true }))
      await new Promise((resolve) => window.setTimeout(resolve))
    })
    await act(async () => {
      await new Promise((resolve) => window.setTimeout(resolve))
    })

    expect(onCreateFolder).toHaveBeenCalledWith("duplicate")
    expect(onFolderOperationError).toHaveBeenCalled()
    expect(document.activeElement).toBe(input)
  })
})
