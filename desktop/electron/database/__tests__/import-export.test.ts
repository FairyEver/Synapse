import { copyFileSync } from "node:fs"
import type { DatabaseSync } from "node:sqlite"

import { beforeEach, describe, expect, it, vi } from "vitest"

import { ImportExportManager } from "../import-export"

vi.mock("node:fs", async () => {
  const actual = await vi.importActual<typeof import("node:fs")>("node:fs")
  return {
    ...actual,
    copyFileSync: vi.fn(),
  }
})

vi.mock("../../services/log-store", () => ({
  createMainLogger: () => ({
    debug: vi.fn(),
    error: vi.fn(),
    info: vi.fn(),
    warn: vi.fn(),
  }),
}))

describe("ImportExportManager", () => {
  beforeEach(() => {
    vi.mocked(copyFileSync).mockClear()
  })

  it("aborts database export when the WAL checkpoint reports busy pages", () => {
    const checkpoint = vi.fn(() => ({ busy: 1, log: 3, checkpointed: 2 }))
    const db = {
      prepare: vi.fn(() => ({ get: checkpoint })),
    } as unknown as DatabaseSync
    const manager = new ImportExportManager(
      () => db,
      () => "/tmp/source.db",
      vi.fn(),
      vi.fn(),
      vi.fn() as never,
    )

    expect(() => manager.exportDatabase("/tmp/export.db")).toThrow("数据库正在写入")
    expect(copyFileSync).not.toHaveBeenCalled()
  })
})
