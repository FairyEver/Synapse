import { mkdtemp, rm } from "node:fs/promises"
import os from "node:os"
import path from "node:path"
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest"

const electronMock = vi.hoisted(() => ({ app: { getPath: vi.fn() } }))

vi.mock("electron", () => electronMock)
vi.mock("../../electron/services/log-store", () => ({
  createMainLogger: () => ({ debug: vi.fn(), error: vi.fn(), info: vi.fn(), warn: vi.fn() }),
}))

let tempDir = ""

describe("Database operation log", () => {
  beforeEach(async () => {
    tempDir = await mkdtemp(path.join(os.tmpdir(), "synapse-database-"))
    electronMock.app.getPath.mockReturnValue(tempDir)
    vi.resetModules()
    const { databaseService } = await import("../../electron/database/service")
    databaseService.open()
    databaseService.databaseTableCreate("tasks", [{ name: "title", kind: "text" }])
  })

  afterEach(async () => {
    const { databaseService } = await import("../../electron/database/service")
    databaseService.close()
    await rm(tempDir, { recursive: true, force: true })
    electronMock.app.getPath.mockReset()
  })

  it("records mutating dispatcher actions with source and affected count", async () => {
    const { dispatchDatabaseAction } = await import("../../electron/database/dispatcher")

    dispatchDatabaseAction("database.row.create", { tableName: "tasks", data: { title: "Ship" } }, { source: "mcp-stdio" })

    const result = dispatchDatabaseAction("database.log.list", { limit: 5 })
    expect(result.data).toEqual([
      expect.objectContaining({
        source: "mcp-stdio",
        action: "database.row.create",
        table: "tasks",
        affected: 1,
        dryRun: false,
      }),
    ])
  })
})
