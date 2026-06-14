import { rm } from "node:fs/promises"
import { afterEach, describe, expect, it, vi } from "vitest"

const mocks = vi.hoisted(() => ({
  userDataRoot: `/tmp/synapse-repository-cache-${Date.now()}`,
}))

vi.mock("electron", () => ({
  app: {
    getPath: () => mocks.userDataRoot,
  },
}))

vi.mock("../log-store", () => ({
  createMainLogger: () => ({
    warn: vi.fn(),
  }),
}))

import { withRepositoryCacheDatabase } from "../repository-cache-database"

describe("repository cache database schema", () => {
  afterEach(async () => {
    await rm(mocks.userDataRoot, { force: true, recursive: true })
  })

  it("creates content index rows with usage support", async () => {
    await withRepositoryCacheDatabase("repo-usage", (database) => {
      const rows = database.prepare("PRAGMA table_info(content_index)").all() as Array<{ name: string }>

      expect(rows.map((row) => row.name)).toContain("usage")
    })
  })

  it("closes the database when schema initialization fails", async () => {
    const close = vi.fn()
    const exec = vi.fn(() => {
      throw new Error("schema failed")
    })
    const DatabaseSync = vi.fn(function DatabaseSyncMock() {
      return { close, exec }
    })

    vi.resetModules()
    vi.doMock("node:sqlite", () => ({ DatabaseSync }))
    const { withRepositoryCacheDatabase: withMockedRepositoryCacheDatabase } = await import(
      "../repository-cache-database"
    )

    await expect(withMockedRepositoryCacheDatabase("repo-schema-fail", () => undefined)).rejects.toThrow(
      "schema failed",
    )

    expect(DatabaseSync).toHaveBeenCalledTimes(1)
    expect(close).toHaveBeenCalledTimes(1)

    vi.doUnmock("node:sqlite")
    vi.resetModules()
  })
})
