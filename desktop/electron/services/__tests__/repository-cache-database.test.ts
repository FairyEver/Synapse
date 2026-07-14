import { DatabaseSync } from "node:sqlite"
import { mkdir, rm } from "node:fs/promises"
import path from "node:path"
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

import {
  getRepositoryCacheDatabasePath,
  withRepositoryCacheDatabase,
} from "../repository-cache-database"

describe("repository cache database schema", () => {
  afterEach(async () => {
    await rm(mocks.userDataRoot, { force: true, recursive: true })
  })

  it("creates content index rows with env metadata support", async () => {
    await withRepositoryCacheDatabase("repo-usage", (database) => {
      const rows = database.prepare("PRAGMA table_info(content_index)").all() as Array<{ name: string }>

      expect(rows.map((row) => row.name)).toContain("usage")
      expect(rows.map((row) => row.name)).toContain("has_env")
    })
  })

  it("invalidates an existing content index when adding env metadata", async () => {
    const databasePath = getRepositoryCacheDatabasePath("repo-env-migration")
    await mkdir(path.dirname(databasePath), { recursive: true })
    const legacyDatabase = new DatabaseSync(databasePath)
    legacyDatabase.exec(`
      CREATE TABLE content_index (
        id TEXT PRIMARY KEY,
        type TEXT NOT NULL,
        modified_at TEXT,
        deleted INTEGER DEFAULT 0
      );
      CREATE TABLE index_meta (
        key TEXT PRIMARY KEY,
        value TEXT
      );
      INSERT INTO index_meta (key, value) VALUES ('last_synced_git_sha', 'old-sha');
    `)
    legacyDatabase.close()

    await withRepositoryCacheDatabase("repo-env-migration", (database) => {
      const columns = database.prepare("PRAGMA table_info(content_index)").all() as Array<{ name: string }>
      const syncedSha = database.prepare(`
        SELECT value FROM index_meta WHERE key = 'last_synced_git_sha'
      `).get()

      expect(columns.map((column) => column.name)).toContain("has_env")
      expect(syncedSha).toBeUndefined()
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
