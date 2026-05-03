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

describe("DatabaseService bulk dry run", () => {
  beforeEach(async () => {
    tempDir = await mkdtemp(path.join(os.tmpdir(), "synapse-database-"))
    electronMock.app.getPath.mockReturnValue(tempDir)
    vi.resetModules()
    const module = await import("../../electron/database/service")
    service = module.databaseService
    service.open()
    service.databaseTableCreate("tasks", [
      { name: "title", kind: "text" },
      { name: "done", kind: "boolean" },
    ])
    service.databaseRowsCreate("tasks", [
      { title: "A", done: false },
      { title: "B", done: false },
    ])
  })

  afterEach(async () => {
    service.close()
    await rm(tempDir, { recursive: true, force: true })
    electronMock.app.getPath.mockReset()
  })

  it("previews databaseRowsUpdate without changing rows", () => {
    const preview = service.databaseRowsUpdate("tasks", { done: false }, { done: true }, { dryRun: true })

    expect(preview).toEqual({ affected: 2, ids: [1, 2], dryRun: true })
    expect(service.databaseRowCount("tasks", { done: true })).toEqual({ count: 0 })
  })

  it("previews databaseRowsDelete without deleting rows", () => {
    const preview = service.databaseRowsDelete("tasks", { done: false }, { dryRun: true })

    expect(preview).toEqual({ affected: 2, ids: [1, 2], dryRun: true })
    expect(service.databaseRowCount("tasks")).toEqual({ count: 2 })
  })
})
