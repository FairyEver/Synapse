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
})
