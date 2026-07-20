/**
 * @vitest-environment jsdom
 */
import { act, useEffect } from "react"
import { createRoot, type Root } from "react-dom/client"
import type { ReactNode } from "react"
import { afterEach, describe, expect, it, vi } from "vitest"

import { useDatabaseFolders } from "../use-database-folders"
import { databaseRowDelete, databaseRowUpdate, useDatabaseTables } from "../use-database"
import type { DatabaseFolder, DatabaseTableInfo } from "@/types/database"

;(globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT: boolean }).IS_REACT_ACT_ENVIRONMENT = true

const mocks = vi.hoisted(() => ({
  bridge: {
    database: {
      folder: {
        list: vi.fn(),
      },
      row: {
        delete: vi.fn(),
        update: vi.fn(),
      },
      table: {
        list: vi.fn(),
      },
      operation: {
        onChanged: vi.fn(() => () => {}),
      },
    },
  },
}))

vi.mock("@/lib/electron-bridge", () => ({
  getSynapseBridge: () => mocks.bridge,
  requireSynapseBridge: () => mocks.bridge,
}))

vi.mock("@/app-shell/logging", () => ({
  createRendererLogger: () => ({
    error: vi.fn(),
  }),
}))

let roots: Root[] = []

afterEach(() => {
  for (const root of roots) {
    act(() => {
      root.unmount()
    })
  }
  roots = []
  document.body.innerHTML = ""
  vi.clearAllMocks()
})

describe("database refresh hooks", () => {
  it("returns single-row mutation affected counts", async () => {
    mocks.bridge.database.row.update.mockResolvedValueOnce({ affected: 0 })
    mocks.bridge.database.row.delete.mockResolvedValueOnce({ affected: 0 })

    await expect(databaseRowUpdate("tasks", 10, { title: "Done" }))
      .resolves.toEqual({ affected: 0 })
    await expect(databaseRowDelete("tasks", 10))
      .resolves.toEqual({ affected: 0 })
  })

  it("keeps table list results from the latest refresh", async () => {
    const first = createDeferred<DatabaseTableInfo[]>()
    const second = createDeferred<DatabaseTableInfo[]>()
    let latestTables: DatabaseTableInfo[] = []
    let refresh: (() => Promise<void>) | null = null
    mocks.bridge.database.table.list
      .mockReturnValueOnce(first.promise)
      .mockReturnValueOnce(second.promise)

    await render(<TablesProbe onState={(state) => {
      latestTables = state.tables
      refresh = state.refresh
    }} />)
    await act(async () => {
      await Promise.resolve()
    })
    expect(mocks.bridge.database.table.list).toHaveBeenCalledTimes(1)

    await act(async () => {
      void refresh?.()
      await Promise.resolve()
    })
    expect(mocks.bridge.database.table.list).toHaveBeenCalledTimes(2)

    await act(async () => {
      second.resolve([tableInfo("new_table")])
      await Promise.resolve()
    })
    expect(latestTables.map((table) => table.name)).toEqual(["new_table"])

    await act(async () => {
      first.resolve([tableInfo("old_table")])
      await Promise.resolve()
    })
    expect(latestTables.map((table) => table.name)).toEqual(["new_table"])
  })

  it("keeps folder list results from the latest refresh", async () => {
    const first = createDeferred<DatabaseFolder[]>()
    const second = createDeferred<DatabaseFolder[]>()
    let latestFolders: DatabaseFolder[] = []
    let refresh: (() => Promise<void>) | null = null
    mocks.bridge.database.folder.list
      .mockReturnValueOnce(first.promise)
      .mockReturnValueOnce(second.promise)

    await render(<FoldersProbe onState={(state) => {
      latestFolders = state.folders
      refresh = state.refresh
    }} />)
    await act(async () => {
      await Promise.resolve()
    })
    expect(mocks.bridge.database.folder.list).toHaveBeenCalledTimes(1)

    await act(async () => {
      void refresh?.()
      await Promise.resolve()
    })
    expect(mocks.bridge.database.folder.list).toHaveBeenCalledTimes(2)

    await act(async () => {
      second.resolve([folderInfo(2, "New")])
      await Promise.resolve()
    })
    expect(latestFolders.map((folder) => folder.name)).toEqual(["New"])

    await act(async () => {
      first.resolve([folderInfo(1, "Old")])
      await Promise.resolve()
    })
    expect(latestFolders.map((folder) => folder.name)).toEqual(["New"])
  })
})

function TablesProbe({ onState }: { onState: (state: ReturnType<typeof useDatabaseTables>) => void }) {
  const state = useDatabaseTables()
  useEffect(() => {
    onState(state)
  }, [onState, state])
  return null
}

function FoldersProbe({ onState }: { onState: (state: ReturnType<typeof useDatabaseFolders>) => void }) {
  const state = useDatabaseFolders()
  useEffect(() => {
    onState(state)
  }, [onState, state])
  return null
}

async function render(element: ReactNode): Promise<void> {
  const container = document.createElement("div")
  document.body.appendChild(container)
  const root = createRoot(container)
  roots.push(root)

  await act(async () => {
    root.render(element)
  })
}

function tableInfo(name: string): DatabaseTableInfo {
  return {
    createdAt: "2026-01-01T00:00:00.000Z",
    description: "",
    name,
    rowCount: 0,
    updatedAt: "2026-01-01T00:00:00.000Z",
  }
}

function folderInfo(id: number, name: string): DatabaseFolder {
  return {
    id,
    members: [],
    name,
    sortOrder: id,
  }
}

function createDeferred<T>() {
  let resolve!: (value: T) => void
  const promise = new Promise<T>((promiseResolve) => {
    resolve = promiseResolve
  })
  return { promise, resolve }
}
