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
let service: typeof import("../../electron/database/service").databaseService

describe("DatabaseService databaseSqlRead", () => {
  beforeEach(async () => {
    tempDir = await mkdtemp(path.join(os.tmpdir(), "synapse-database-"))
    electronMock.app.getPath.mockReturnValue(tempDir)
    vi.resetModules()
    const module = await import("../../electron/database/service")
    service = module.databaseService
    service.open()
    service.databaseTableCreate("tasks", [{ name: "title", kind: "text" }])
    service.databaseRowCreate("tasks", { title: "Ship" })
  })

  afterEach(async () => {
    service.close()
    await rm(tempDir, { recursive: true, force: true })
    electronMock.app.getPath.mockReset()
  })

  it("allows SELECT statements with bind params", () => {
    expect(service.databaseSqlRead("SELECT title FROM tasks WHERE title = ?", ["Ship"])).toEqual({
      rows: [{ title: "Ship" }],
    })
  })

  it("rejects write statements", () => {
    expect(() => service.databaseSqlRead("DELETE FROM tasks")).toThrow(/read-only/i)
  })

  it("rejects write-mode PRAGMA statements", () => {
    expect(() => service.databaseSqlRead("PRAGMA user_version = 7")).toThrow(/read-only/i)
    expect(service.databaseSqlRead("PRAGMA user_version")).toEqual({
      rows: [{ user_version: 0 }],
    })
  })

  it("allows read-only PRAGMA statements", () => {
    const result = service.databaseSqlRead(`PRAGMA table_info("tasks")`)

    expect(result.rows.map((row) => row.name)).toContain("title")
  })

  it("blocks raw SQL access to folder system tables", () => {
    expect(() => service.databaseSqlExecute(`DELETE FROM "_table_folders"`))
      .toThrow(/system tables/i)
    expect(() => service.databaseSqlExecute("UPDATE _table_folder_members SET folder_id = 999"))
      .toThrow(/system tables/i)
    expect(() => service.databaseSqlRead(`SELECT * FROM "_table_folders"`))
      .toThrow(/system tables/i)
  })

  it("blocks raw SQL access to any underscore-prefixed table", () => {
    expect(() => service.databaseSqlExecute(`CREATE TABLE "_shadow" ("id" INTEGER PRIMARY KEY)`))
      .toThrow(/system tables/i)
    expect(() => service.databaseSqlExecute(`INSERT INTO "_shadow" ("id") VALUES (1)`))
      .toThrow(/system tables/i)
    expect(() => service.databaseSqlRead(`PRAGMA table_info("_shadow")`))
      .toThrow(/system tables/i)
  })
})
