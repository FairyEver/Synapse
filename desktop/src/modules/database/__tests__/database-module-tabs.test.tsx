/**
 * @vitest-environment jsdom
 */
import { act } from "react"
import { createRoot, type Root } from "react-dom/client"
import type { ReactNode } from "react"
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest"

import { DatabaseModule } from "../index"

;(globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT: boolean }).IS_REACT_ACT_ENVIRONMENT = true

const mocks = vi.hoisted(() => ({
  useDatabaseStatus: vi.fn(),
}))

vi.mock("@/components/sidebar-content-layout", async () => {
  const React = await import("react")
  return {
    SidebarContentLayout: ({ children }: { children: ReactNode }) => React.createElement("div", { "data-view": "tables" }, children),
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
    error: vi.fn(),
    notify: vi.fn(),
    promise: (callback: () => Promise<unknown>) => callback(),
    success: vi.fn(),
  }),
}))

vi.mock("@/lib/electron-bridge", () => ({
  getSynapseBridge: () => ({
    database: {
      operation: { onChanged: vi.fn(() => () => undefined) },
    },
  }),
}))

vi.mock("../components/database-sidebar", async () => {
  const React = await import("react")
  return { DatabaseSidebar: () => React.createElement("div") }
})

vi.mock("../components/data-table-view", async () => {
  const React = await import("react")
  return {
    DataTableView: React.forwardRef((_props, ref) => {
      React.useImperativeHandle(ref, () => ({ commitPendingChanges: vi.fn() }))
      return React.createElement("div", null, "数据表内容")
    }),
  }
})

vi.mock("../components/create-table-dialog", async () => {
  const React = await import("react")
  return { CreateTableDialog: () => React.createElement("div") }
})

vi.mock("../components/table-schema-sheet", async () => {
  const React = await import("react")
  return { TableSchemaSheet: () => React.createElement("div") }
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
  databaseExport: vi.fn(),
  databaseImport: vi.fn(),
  databaseRowCreate: vi.fn(),
  databaseRowDelete: vi.fn(),
  databaseRowUpdate: vi.fn(),
  databaseTableCreate: vi.fn(),
  databaseTableDelete: vi.fn(),
  databaseTableExport: vi.fn(),
  databaseTableImport: vi.fn(),
  databaseTableImportInspect: vi.fn(),
  databaseTableUpdate: vi.fn(),
  useDatabaseQuery: () => ({
    error: null,
    pageSize: 50,
    refresh: vi.fn(),
    rows: [{ id: 1, title: "Row" }],
    total: 1,
  }),
  useDatabaseSchema: () => ({
    error: null,
    refresh: vi.fn(),
    schema: {
      columns: [
        { kind: "integer", name: "id", primaryKey: true, system: true },
        { kind: "text", name: "title" },
      ],
      name: "tasks",
    },
  }),
  useDatabaseStatus: mocks.useDatabaseStatus,
  useDatabaseTables: () => ({
    error: null,
    loading: false,
    refresh: vi.fn(),
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
  document.body.innerHTML = ""
  mocks.useDatabaseStatus.mockReturnValue({
    refresh: vi.fn(),
    status: {
      dbDirectoryPath: "/Users/liyang/Library/Application Support/Synapse",
      dbSize: 2048,
      port: 57321,
      running: true,
      tableCount: 1,
    },
  })
})

afterEach(() => {
  for (const root of roots) {
    act(() => {
      root.unmount()
    })
  }
  roots = []
})

describe("DatabaseModule app tabs", () => {
  it("defaults to tables and switches to status and management", async () => {
    await renderDatabase()

    expect([...document.querySelectorAll('[role="tab"]')].map((tab) => tab.textContent)).toEqual([
      "数据表",
      "服务状态",
      "管理",
    ])
    expect(document.body.textContent).toContain("数据表内容")

    await clickTab("服务状态")
    expect(document.body.textContent).toContain("HTTP 端口")
    expect(document.body.textContent).not.toContain("导出数据库")

    await clickTab("管理")
    expect(document.body.textContent).toContain("导出数据库")
    expect(document.body.textContent).toContain("数据库目录")
    expect(document.body.textContent).not.toContain("MCP Server")
  })
})

async function renderDatabase(): Promise<void> {
  const container = document.createElement("div")
  document.body.appendChild(container)
  const root = createRoot(container)
  roots.push(root)

  await act(async () => {
    root.render(<DatabaseModule />)
    await Promise.resolve()
  })
}

async function clickTab(label: string): Promise<void> {
  const tab = [...document.querySelectorAll<HTMLButtonElement>('[role="tab"]')]
    .find((candidate) => candidate.textContent === label)
  if (!tab) throw new Error(`Tab not found: ${label}`)
  await act(async () => {
    tab.dispatchEvent(new PointerEvent("pointerdown", { bubbles: true }))
    tab.dispatchEvent(new PointerEvent("pointerup", { bubbles: true }))
    tab.dispatchEvent(new MouseEvent("mousedown", { bubbles: true }))
    tab.dispatchEvent(new MouseEvent("mouseup", { bubbles: true }))
    tab.click()
    await Promise.resolve()
  })
}
