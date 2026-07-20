/**
 * @vitest-environment jsdom
 */
import { act } from "react"
import { createRoot, type Root } from "react-dom/client"
import type { ReactNode } from "react"
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest"

import { DatabaseModule } from "../index"

;(globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT: boolean }).IS_REACT_ACT_ENVIRONMENT = true

type DataTableProps = {
  onDelete: (id: number) => Promise<void> | void
  onUpdate: (id: number, data: Record<string, unknown>) => Promise<void> | void
}

const mocks = vi.hoisted(() => ({
  dataTableProps: null as DataTableProps | null,
  databaseRowDelete: vi.fn(),
  databaseRowUpdate: vi.fn(),
  refreshQuery: vi.fn(),
  refreshSchema: vi.fn(),
  refreshTables: vi.fn(),
  showError: vi.fn(),
  showSuccess: vi.fn(),
}))

vi.mock("@/components/sidebar-content-layout", async () => {
  const React = await import("react")
  return {
    SidebarContentLayout: ({ children }: { children: ReactNode }) => React.createElement("div", null, children),
  }
})

vi.mock("@/app-shell/logging", () => ({
  createRendererLogger: () => ({
    error: vi.fn(),
    info: vi.fn(),
    warn: vi.fn(),
  }),
}))

vi.mock("@/app-shell/notifications", () => ({
  useAppNotifications: () => ({
    error: mocks.showError,
    success: mocks.showSuccess,
    promise: (callback: () => Promise<unknown>) => callback(),
  }),
}))

vi.mock("@/lib/electron-bridge", () => ({
  getSynapseBridge: () => ({
    database: {
      operation: { onChanged: vi.fn(() => () => {}) },
    },
  }),
}))

vi.mock("../components/database-sidebar", async () => {
  const React = await import("react")
  return {
    DatabaseSidebar: () => React.createElement("div"),
  }
})

vi.mock("../components/data-table-view", async () => {
  const React = await import("react")
  return {
    DataTableView: React.forwardRef((_props: DataTableProps, ref) => {
      mocks.dataTableProps = _props
      React.useImperativeHandle(ref, () => ({ commitPendingChanges: vi.fn() }))
      return React.createElement("div")
    }),
  }
})

vi.mock("../components/create-table-dialog", async () => {
  const React = await import("react")
  return {
    CreateTableDialog: () => React.createElement("div"),
  }
})

vi.mock("../components/table-schema-sheet", async () => {
  const React = await import("react")
  return {
    TableSchemaSheet: () => React.createElement("div"),
  }
})

vi.mock("../hooks/use-database-folders", () => ({
  useDatabaseFolders: () => ({
    createFolder: vi.fn(),
    deleteFolder: vi.fn(),
    error: null,
    folders: [],
    moveTable: vi.fn(),
    refresh: vi.fn(),
    renameFolder: vi.fn(),
  }),
}))

vi.mock("../hooks/use-database", () => ({
  databaseChoiceUpdate: vi.fn(),
  databaseColumnCreate: vi.fn(),
  databaseColumnUpdate: vi.fn(),
  databaseRowCreate: vi.fn(),
  databaseRowDelete: mocks.databaseRowDelete,
  databaseRowUpdate: mocks.databaseRowUpdate,
  databaseTableCreate: vi.fn(),
  databaseTableDelete: vi.fn(),
  databaseTableExport: vi.fn(),
  databaseTableImport: vi.fn(),
  databaseTableImportInspect: vi.fn(),
  databaseTableUpdate: vi.fn(),
  useDatabaseQuery: () => ({
    error: null,
    pageSize: 50,
    refresh: mocks.refreshQuery,
    rows: [{ id: 10, title: "Old" }],
    total: 1,
  }),
  useDatabaseSchema: () => ({
    error: null,
    loading: false,
    refresh: mocks.refreshSchema,
    schema: {
      columns: [
        { kind: "integer", name: "id", primaryKey: true, system: true },
        { kind: "text", name: "title" },
      ],
      name: "tasks",
    },
  }),
  useDatabaseTables: () => ({
    error: null,
    loading: false,
    refresh: mocks.refreshTables,
    tables: [{
      createdAt: "2026-01-01T00:00:00.000Z",
      description: "",
      name: "tasks",
      rowCount: 1,
      updatedAt: "2026-01-01T00:00:00.000Z",
    }],
  }),
}))

let roots: Root[] = []

beforeEach(() => {
  mocks.dataTableProps = null
  mocks.databaseRowDelete.mockReset()
  mocks.databaseRowUpdate.mockReset()
  mocks.refreshQuery.mockReset()
  mocks.refreshSchema.mockReset()
  mocks.refreshTables.mockReset()
  mocks.showError.mockReset()
  mocks.showSuccess.mockReset()
})

afterEach(() => {
  for (const root of roots) {
    act(() => {
      root.unmount()
    })
  }
  roots = []
  document.body.innerHTML = ""
})

describe("DatabaseModule row mutations", () => {
  it("treats single-row update affected=0 as stale instead of success", async () => {
    await render(<DatabaseModule />)
    mocks.databaseRowUpdate.mockResolvedValueOnce({ affected: 0 })

    await expect(mocks.dataTableProps?.onUpdate(10, { title: "New" }))
      .rejects.toThrow("该行已不存在，已刷新列表。")

    expect(mocks.refreshQuery).toHaveBeenCalled()
    expect(mocks.refreshTables).toHaveBeenCalled()
    expect(mocks.showError).toHaveBeenCalledWith("该行已不存在，已刷新列表。")
    expect(mocks.showSuccess).not.toHaveBeenCalled()
  })

  it("treats single-row delete affected=0 as stale instead of success", async () => {
    await render(<DatabaseModule />)
    mocks.databaseRowDelete.mockResolvedValueOnce({ affected: 0 })

    await expect(mocks.dataTableProps?.onDelete(10))
      .rejects.toThrow("该行已不存在，已刷新列表。")

    expect(mocks.refreshQuery).toHaveBeenCalled()
    expect(mocks.refreshTables).toHaveBeenCalled()
    expect(mocks.showError).toHaveBeenCalledWith("该行已不存在，已刷新列表。")
    expect(mocks.showSuccess).not.toHaveBeenCalled()
  })
})

async function render(element: ReactNode): Promise<void> {
  const container = document.createElement("div")
  document.body.appendChild(container)
  const root = createRoot(container)
  roots.push(root)

  await act(async () => {
    root.render(element)
  })
}
