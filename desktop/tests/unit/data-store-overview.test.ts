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
let service: typeof import("../../electron/data-store/service").dataStoreService

describe("DataStoreService overview", () => {
  beforeEach(async () => {
    tempDir = await mkdtemp(path.join(os.tmpdir(), "synapse-data-store-"))
    electronMock.app.getPath.mockReturnValue(tempDir)
    vi.resetModules()
    const module = await import("../../electron/data-store/service")
    service = module.dataStoreService
    service.open()
  })

  afterEach(async () => {
    service.close()
    await rm(tempDir, { recursive: true, force: true })
    electronMock.app.getPath.mockReset()
  })

  it("summarizes tables, descriptions, row counts, and columns", () => {
    service.createTable("tasks", [
      { name: "title", kind: "text", description: "Task title" },
      { name: "priority", kind: "single_choice", choices: ["high", "low"], description: "Priority" },
    ], "Task tracker")
    service.insert("tasks", { title: "Ship", priority: "high" })

    expect(service.getDatabaseOverview()).toEqual({
      tableCount: 1,
      tables: [
        expect.objectContaining({
          name: "tasks",
          description: "Task tracker",
          rowCount: 1,
          columns: expect.arrayContaining([
            expect.objectContaining({ name: "title", kind: "text", description: "Task title" }),
            expect.objectContaining({ name: "priority", kind: "single_choice", choices: ["high", "low"] }),
          ]),
        }),
      ],
    })
  })
})
