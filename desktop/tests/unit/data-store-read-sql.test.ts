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

describe("DataStoreService readSQL", () => {
  beforeEach(async () => {
    tempDir = await mkdtemp(path.join(os.tmpdir(), "synapse-data-store-"))
    electronMock.app.getPath.mockReturnValue(tempDir)
    vi.resetModules()
    const module = await import("../../electron/data-store/service")
    service = module.dataStoreService
    service.open()
    service.createTable("tasks", [{ name: "title", kind: "text" }])
    service.insert("tasks", { title: "Ship" })
  })

  afterEach(async () => {
    service.close()
    await rm(tempDir, { recursive: true, force: true })
    electronMock.app.getPath.mockReset()
  })

  it("allows SELECT statements with bind params", () => {
    expect(service.readSQL("SELECT title FROM tasks WHERE title = ?", ["Ship"])).toEqual({
      rows: [{ title: "Ship" }],
    })
  })

  it("rejects write statements", () => {
    expect(() => service.readSQL("DELETE FROM tasks")).toThrow(/read-only/i)
  })
})
