import { copyFileSync, readFileSync, statSync, writeFileSync } from "node:fs"
import { createHash } from "node:crypto"
import type { DatabaseSync } from "node:sqlite"

import { beforeEach, describe, expect, it, vi } from "vitest"

import { ImportExportManager } from "../import-export"
import { DATA_STORE_TABLE_EXPORT_MAX_CELL_BYTES } from "../../../config"

vi.mock("node:fs", async () => {
  const actual = await vi.importActual<typeof import("node:fs")>("node:fs")
  return {
    ...actual,
    copyFileSync: vi.fn(),
    readFileSync: vi.fn(actual.readFileSync),
    statSync: vi.fn(actual.statSync),
    writeFileSync: vi.fn(),
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
    vi.mocked(readFileSync).mockClear()
    vi.mocked(statSync).mockClear()
    vi.mocked(writeFileSync).mockClear()
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

  it("rejects oversized table exports before loading table rows", () => {
    const allRows = vi.fn()
    const db = {
      prepare: vi.fn((sql: string) => {
        if (sql.includes("COUNT(*)")) {
          return { get: vi.fn(() => ({ count: 10_001 })) }
        }
        return { all: allRows }
      }),
    } as unknown as DatabaseSync
    const manager = new ImportExportManager(
      () => db,
      () => "/tmp/source.db",
      vi.fn(),
      vi.fn(),
      vi.fn(() => ({
        name: "notes",
        description: "",
        columns: [{ name: "title", kind: "text" }],
        createdAt: "2026-06-14T00:00:00.000Z",
        updatedAt: "2026-06-14T00:00:00.000Z",
      })) as never,
    )

    expect(() => manager.exportTable("notes", "/tmp/notes.sql")).toThrow("数据表导出行数超过限制")
    expect(allRows).not.toHaveBeenCalled()
  })

  it("exports small tables after passing the row budget", () => {
    const allRows = vi.fn()
    const iterateRows = vi.fn(function* () {
      yield {
        id: 1,
        created_at: "2026-06-14T00:00:00.000Z",
        updated_at: "2026-06-14T00:00:00.000Z",
        title: "Hello",
      }
    })
    const db = {
      prepare: vi.fn((sql: string) => {
        if (sql.includes("COUNT(*)")) {
          return { get: vi.fn(() => ({ count: 1 })) }
        }
        return { all: allRows, iterate: iterateRows }
      }),
    } as unknown as DatabaseSync
    const manager = new ImportExportManager(
      () => db,
      () => "/tmp/source.db",
      vi.fn(),
      vi.fn(),
      vi.fn(() => ({
        name: "notes",
        description: "",
        columns: [
          { name: "id", kind: "integer", primaryKey: true },
          { name: "created_at", kind: "text", system: true },
          { name: "updated_at", kind: "text", system: true },
          { name: "title", kind: "text" },
        ],
        createdAt: "2026-06-14T00:00:00.000Z",
        updatedAt: "2026-06-14T00:00:00.000Z",
      })) as never,
    )

    manager.exportTable("notes", "/tmp/notes.sql")

    expect(iterateRows).toHaveBeenCalled()
    expect(allRows).not.toHaveBeenCalled()
    expect(writeFileSync).toHaveBeenCalledWith(
      "/tmp/notes.sql",
      expect.stringContaining("INSERT INTO \"notes\""),
      "utf8",
    )
  })

  it("rejects oversized table export cells before writing the export file", () => {
    const iterateRows = vi.fn(function* () {
      yield {
        id: 1,
        created_at: "2026-06-14T00:00:00.000Z",
        updated_at: "2026-06-14T00:00:00.000Z",
        attachment: new Uint8Array(DATA_STORE_TABLE_EXPORT_MAX_CELL_BYTES + 1),
      }
    })
    const db = {
      prepare: vi.fn((sql: string) => {
        if (sql.includes("COUNT(*)")) {
          return { get: vi.fn(() => ({ count: 1 })) }
        }
        return { iterate: iterateRows }
      }),
    } as unknown as DatabaseSync
    const manager = new ImportExportManager(
      () => db,
      () => "/tmp/source.db",
      vi.fn(),
      vi.fn(),
      vi.fn(() => ({
        name: "notes",
        description: "",
        columns: [
          { name: "id", kind: "integer", primaryKey: true },
          { name: "created_at", kind: "text", system: true },
          { name: "updated_at", kind: "text", system: true },
          { name: "attachment", kind: "binary" },
        ],
        createdAt: "2026-06-14T00:00:00.000Z",
        updatedAt: "2026-06-14T00:00:00.000Z",
      })) as never,
    )

    expect(() => manager.exportTable("notes", "/tmp/notes.sql")).toThrow("数据表导出单元格超过大小限制")
    expect(writeFileSync).not.toHaveBeenCalled()
  })

  it("rejects oversized table import files before reading them", () => {
    vi.mocked(statSync).mockReturnValueOnce({
      isFile: () => true,
      size: 32 * 1024 * 1024 + 1,
    } as never)
    const manager = new ImportExportManager(
      vi.fn() as never,
      () => "/tmp/source.db",
      vi.fn(),
      vi.fn(),
      vi.fn() as never,
    )

    expect(() => manager.inspectTableImport("/tmp/large.sql")).toThrow("数据表导入文件超过大小限制")
    expect(readFileSync).not.toHaveBeenCalled()
  })

  it("binds table import confirmation to the inspected file digest", () => {
    const originalSql = tableExportSql("notes")
    const changedSql = tableExportSql("other_notes")
    vi.mocked(statSync).mockReturnValue({
      isFile: () => true,
      size: originalSql.length,
    } as never)
    vi.mocked(readFileSync)
      .mockReturnValueOnce(originalSql)
      .mockReturnValueOnce(changedSql)
    const db = {
      prepare: vi.fn(() => ({ get: vi.fn(() => ({ count: 0 })) })),
    } as unknown as DatabaseSync
    const manager = new ImportExportManager(
      () => db,
      () => "/tmp/source.db",
      vi.fn(),
      vi.fn(),
      vi.fn() as never,
    )

    const inspection = manager.inspectTableImport("/tmp/import.sql")

    expect(inspection).toMatchObject({
      tableName: "notes",
      sourcePath: "/tmp/import.sql",
      sourceDigest: sha256(originalSql),
    })
    expect(() => manager.importTable("/tmp/import.sql", inspection.sourceDigest)).toThrow("导入文件已变化，请重新选择")
  })
})

function tableExportSql(tableName: string): string {
  const payload = {
    format: "synapse-table-sql",
    version: 1,
    exportedAt: "2026-06-20T00:00:00.000Z",
    table: {
      name: tableName,
      description: "",
      columns: [{ name: "title", kind: "text" }],
      createdAt: "2026-06-20T00:00:00.000Z",
      updatedAt: "2026-06-20T00:00:00.000Z",
    },
    rows: [],
  }
  const base64 = Buffer.from(JSON.stringify(payload), "utf8").toString("base64")
  return [
    "-- synapse-table-export-b64",
    `-- ${base64}`,
    "-- synapse-table-export-end",
  ].join("\n")
}

function sha256(contents: string): string {
  return createHash("sha256").update(contents, "utf8").digest("hex")
}
