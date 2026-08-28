/**
 * @vitest-environment jsdom
 */
import { act } from "react"
import { createRoot } from "react-dom/client"
import { afterEach, describe, expect, it, vi } from "vitest"

import { DataTableView } from "../data-table-view"
import type { Column } from "@/types/database"

;(globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT: boolean }).IS_REACT_ACT_ENVIRONMENT = true
globalThis.ResizeObserver = class ResizeObserverMock {
  observe() {}
  unobserve() {}
  disconnect() {}
} as typeof ResizeObserver

const columns: Column[] = [
  { name: "id", kind: "integer", primaryKey: true },
  { name: "content", kind: "text" },
]

afterEach(() => {
  document.body.replaceChildren()
})

function renderTable(
  onInsert = vi.fn(),
  rows: Record<string, unknown>[] = [],
  onDelete = vi.fn(),
) {
  const container = document.createElement("div")
  document.body.append(container)
  const root = createRoot(container)
  act(() => {
    root.render(
      <DataTableView
        tableName="focus_test"
        columns={columns}
        schema={null}
        rows={rows}
        total={rows.length}
        page={1}
        pageSize={20}
        onPageChange={vi.fn()}
        onInsert={onInsert}
        onUpdate={vi.fn()}
        onDelete={onDelete}
        onShowSchema={vi.fn()}
        onExportTable={vi.fn()}
        filter={null}
        onFilterChange={vi.fn()}
      />,
    )
  })
  return { root, onInsert }
}

describe("DataTableView row editor focus", () => {
  it("returns focus to Add Row after canceling a new row", async () => {
    const { root } = renderTable()
    const addButton = [...document.querySelectorAll<HTMLButtonElement>("button")]
      .find((button) => button.textContent?.trim() === "新增行")!

    await act(async () => addButton.click())
    const cancelButton = document.querySelector<HTMLButtonElement>('[aria-label="取消编辑"]')!
    await act(async () => {
      cancelButton.click()
      await new Promise((resolve) => window.setTimeout(resolve))
    })

    expect(document.activeElement).toBe(addButton)
    await act(async () => root.unmount())
  })

  it("returns focus to Add Row after saving a new row", async () => {
    const onInsert = vi.fn().mockResolvedValue(undefined)
    const { root } = renderTable(onInsert)
    const addButton = [...document.querySelectorAll<HTMLButtonElement>("button")]
      .find((button) => button.textContent?.trim() === "新增行")!

    await act(async () => addButton.click())
    const input = document.querySelector<HTMLInputElement>("input")!
    await act(async () => {
      const valueSetter = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, "value")?.set
      valueSetter?.call(input, "saved")
      input.dispatchEvent(new Event("input", { bubbles: true }))
    })
    const saveButton = document.querySelector<HTMLButtonElement>('[aria-label="保存行"]')!
    await act(async () => {
      saveButton.click()
      await new Promise((resolve) => window.setTimeout(resolve, 100))
    })

    expect(onInsert).toHaveBeenCalledOnce()
    expect(document.activeElement).toBe(addButton)
    await act(async () => root.unmount())
  })

  it("returns focus to Filter after closing its dialog", async () => {
    const { root } = renderTable()
    const filterButton = [...document.querySelectorAll<HTMLButtonElement>("button")]
      .find((button) => button.textContent?.trim() === "筛选")!

    await act(async () => filterButton.click())
    await act(async () => {
      document.activeElement?.dispatchEvent(new KeyboardEvent("keydown", { key: "Escape", bubbles: true }))
      await new Promise((resolve) => window.setTimeout(resolve, 100))
    })

    expect(document.activeElement).toBe(filterButton)
    await act(async () => root.unmount())
  })

  it("returns focus to the row delete trigger after canceling deletion", async () => {
    const { root } = renderTable(vi.fn(), [{ id: 1, content: "kept" }])
    const deleteButton = document.querySelector<HTMLButtonElement>('[aria-label="删除行"]')!

    await act(async () => deleteButton.click())
    await act(async () => {
      document.activeElement?.dispatchEvent(new KeyboardEvent("keydown", { key: "Escape", bubbles: true }))
      await new Promise((resolve) => window.setTimeout(resolve, 100))
    })

    expect(document.activeElement).toBe(deleteButton)
    await act(async () => root.unmount())
  })
})
