import { existsSync, readdirSync } from "node:fs"
import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises"
import { DatabaseSync } from "node:sqlite"
import os from "node:os"
import path from "node:path"
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest"

const electronMock = vi.hoisted(() => ({
  app: {
    getPath: vi.fn(),
  },
}))

vi.mock("electron", () => electronMock)

vi.mock("../../services/log-store", () => ({
  createMainLogger: () => ({
    debug: vi.fn(),
    error: vi.fn(),
    info: vi.fn(),
    warn: vi.fn(),
  }),
}))

let tempDir = ""
let service: typeof import("../service").databaseService

function createLegacyDatabase(filePath: string): void {
  const db = new DatabaseSync(filePath)
  db.exec(`
    CREATE TABLE "_meta_tables" (
      name TEXT PRIMARY KEY,
      description TEXT NOT NULL DEFAULT '',
      created_at TEXT NOT NULL,
      updated_at TEXT NOT NULL
    );
    CREATE TABLE "_meta_columns" (
      table_name TEXT NOT NULL,
      column_name TEXT NOT NULL,
      description TEXT NOT NULL DEFAULT '',
      enum_values TEXT NOT NULL DEFAULT '',
      PRIMARY KEY (table_name, column_name)
    );
    CREATE TABLE "wdbc_money" (
      "id" INTEGER PRIMARY KEY AUTOINCREMENT,
      "created_at" TEXT NOT NULL DEFAULT '',
      "updated_at" TEXT NOT NULL DEFAULT '',
      "reason" TEXT,
      "person" ENUM,
      "type" ENUM,
      "amount" REAL
    );
  `)
  const now = "2026-04-24T07:33:41.375Z"
  db.prepare(`INSERT INTO "_meta_tables" (name, description, created_at, updated_at) VALUES (?, ?, ?, ?)`)
    .run("wdbc_money", "部门内奖罚金钱支出收入记录", now, now)
  db.prepare(`INSERT INTO "_meta_columns" (table_name, column_name, description, enum_values) VALUES (?, ?, ?, ?)`)
    .run("wdbc_money", "reason", "原因", "")
  db.prepare(`INSERT INTO "_meta_columns" (table_name, column_name, description, enum_values) VALUES (?, ?, ?, ?)`)
    .run("wdbc_money", "person", "人员", JSON.stringify(["张三", "李四"]))
  db.prepare(`INSERT INTO "_meta_columns" (table_name, column_name, description, enum_values) VALUES (?, ?, ?, ?)`)
    .run("wdbc_money", "type", "类型", JSON.stringify(["收入", "支出"]))
  db.prepare(`INSERT INTO "_meta_columns" (table_name, column_name, description, enum_values) VALUES (?, ?, ?, ?)`)
    .run("wdbc_money", "amount", "金额", "")
  db.prepare(`INSERT INTO "wdbc_money" (created_at, updated_at, reason, person, type, amount) VALUES (?, ?, ?, ?, ?, ?)`)
    .run(now, now, "迟到", "张三", "收入", 12.5)
  db.close()
}

function createEmptyCurrentDatabaseWithOperationLog(filePath: string): void {
  const db = new DatabaseSync(filePath)
  db.exec(`
    CREATE TABLE "_meta_tables" (
      name TEXT PRIMARY KEY,
      description TEXT NOT NULL DEFAULT '',
      created_at TEXT NOT NULL,
      updated_at TEXT NOT NULL
    );
    CREATE TABLE "_meta_columns" (
      table_name TEXT NOT NULL,
      column_name TEXT NOT NULL,
      kind TEXT NOT NULL,
      choices TEXT,
      description TEXT NOT NULL DEFAULT '',
      PRIMARY KEY (table_name, column_name)
    );
    CREATE TABLE "_operation_log" (
      "id" INTEGER PRIMARY KEY AUTOINCREMENT,
      "source" TEXT NOT NULL,
      "action" TEXT NOT NULL,
      "table_name" TEXT,
      "affected" INTEGER,
      "dry_run" INTEGER NOT NULL DEFAULT 0,
      "created_at" TEXT NOT NULL
    );
  `)
  db.close()
}

function createCurrentDatabaseWithoutColumnDescriptions(filePath: string): void {
  const db = new DatabaseSync(filePath)
  db.exec(`
    CREATE TABLE "_meta_tables" (
      name TEXT PRIMARY KEY,
      description TEXT NOT NULL DEFAULT '',
      created_at TEXT NOT NULL,
      updated_at TEXT NOT NULL
    );
    CREATE TABLE "_meta_columns" (
      table_name TEXT NOT NULL,
      column_name TEXT NOT NULL,
      kind TEXT NOT NULL,
      choices TEXT,
      PRIMARY KEY (table_name, column_name)
    );
    CREATE TABLE "wdbc_money" (
      "id" INTEGER PRIMARY KEY AUTOINCREMENT,
      "created_at" TEXT NOT NULL DEFAULT '',
      "updated_at" TEXT NOT NULL DEFAULT '',
      "person" TEXT
    );
  `)
  const now = "2026-04-24T07:33:41.375Z"
  db.prepare(`INSERT INTO "_meta_tables" (name, description, created_at, updated_at) VALUES (?, ?, ?, ?)`)
    .run("wdbc_money", "部门内奖罚金钱支出收入记录", now, now)
  db.prepare(`INSERT INTO "_meta_columns" (table_name, column_name, kind, choices) VALUES (?, ?, ?, ?)`)
    .run("wdbc_money", "person", "single_choice", JSON.stringify(["张三", "李四"]))
  db.prepare(`INSERT INTO "wdbc_money" (created_at, updated_at, person) VALUES (?, ?, ?)`)
    .run(now, now, "张三")
  db.close()
}

describe("DatabaseService table descriptions", () => {
  beforeEach(async () => {
    tempDir = await mkdtemp(path.join(os.tmpdir(), "synapse-database-"))
    electronMock.app.getPath.mockReturnValue(tempDir)
    vi.resetModules()

    const module = await import("../service")
    service = module.databaseService
    service.open()
  })

  afterEach(async () => {
    service.close()
    await rm(tempDir, { recursive: true, force: true })
    electronMock.app.getPath.mockReset()
  })

  it("updates table descriptions in list and schema metadata", () => {
    service.databaseTableCreate(
      "customer_orders",
      [{ name: "customer_name", kind: "text" }],
      "old note",
    )

    service.databaseTableUpdate("customer_orders", "客户订单")

    expect(service.databaseTableDescribe("customer_orders").description).toBe("客户订单")
    expect(service.databaseTableList()).toContainEqual(expect.objectContaining({
      name: "customer_orders",
      description: "客户订单",
    }))
  })

  it("allows clearing a table description", () => {
    service.databaseTableCreate(
      "product_sku",
      [{ name: "sku_code", kind: "text" }],
      "商品编码",
    )

    service.databaseTableUpdate("product_sku", "")

    expect(service.databaseTableDescribe("product_sku").description).toBe("")
    expect(service.databaseTableList()).toContainEqual(expect.objectContaining({
      name: "product_sku",
      description: "",
    }))
  })

  it("rejects non-exact numeric writes", () => {
    service.databaseTableCreate("metrics", [
      { name: "count_value", kind: "integer" },
      { name: "score_value", kind: "decimal" },
    ])

    expect(() => service.databaseRowCreate("metrics", { count_value: "12abc" })).toThrow(/count_value/)
    expect(() => service.databaseRowCreate("metrics", { score_value: "1.2x" })).toThrow(/score_value/)

    service.databaseRowCreate("metrics", { count_value: "12", score_value: "1.25" })
    const result = service.databaseRowList({ table: "metrics" })
    expect(result.rows[0]).toMatchObject({
      count_value: 12,
      score_value: 1.25,
    })
  })

  it("rejects timestamp writes with invalid calendar dates", () => {
    service.databaseTableCreate("events", [
      { name: "occurred_at", kind: "timestamp" },
    ])

    expect(() => service.databaseRowCreate("events", { occurred_at: "2026-02-30T00:00:00Z" })).toThrow("Invalid timestamp")
    expect(() => service.databaseRowsUpdate(
      "events",
      { field: "id", op: "=", value: 1 },
      { occurred_at: "2026-04-31T00:00:00Z" },
      { dryRun: true },
    )).toThrow("Invalid timestamp")

    service.databaseRowCreate("events", { occurred_at: "2026-02-28T00:00:00Z" })
    expect(service.databaseRowList({ table: "events" }).rows[0]).toMatchObject({
      occurred_at: "2026-02-28T00:00:00Z",
    })
  })

  it("rejects timestamp column defaults with invalid calendar dates", () => {
    service.databaseTableCreate("milestones", [
      { name: "title", kind: "text" },
    ])

    expect(() => service.databaseColumnCreate("milestones", {
      name: "due_at",
      kind: "timestamp",
      default: "2026-02-30T00:00:00Z",
    })).toThrow("Invalid timestamp")
  })

  it("allows system-table-looking tokens inside SQL string literals", () => {
    const result = service.databaseSqlExecute("SELECT 'contains _not_a_table in text' AS note")

    expect(result.rows).toEqual([{ note: "contains _not_a_table in text" }])
  })

  it("rejects raw SQL statements that write database snapshots to local files", () => {
    expect(() => service.databaseSqlExecute("VACUUM INTO '/tmp/synapse-copy.sqlite'"))
      .toThrow("VACUUM INTO statements are not allowed")
    expect(() => service.databaseSqlExecute("VACUUM main INTO '/tmp/synapse-copy.sqlite'"))
      .toThrow("VACUUM INTO statements are not allowed")
  })

  it("treats malformed multi-choice JSON as not matching CONTAINS filters", () => {
    service.databaseTableCreate("tasks", [
      { name: "labels", kind: "multi_choice", choices: ["bug", "feature"] },
    ])

    service.databaseSqlExecute(`INSERT INTO "tasks" ("labels") VALUES (?)`, ["not-json"])

    expect(() => service.databaseRowList({
      table: "tasks",
      where: [{ field: "labels", op: "CONTAINS", value: "bug" }],
    })).not.toThrow()
    expect(service.databaseRowList({
      table: "tasks",
      where: [{ field: "labels", op: "CONTAINS", value: "bug" }],
    }).rows).toEqual([])
  })

  it("counts and validates multi-choice values without loading raw rows into JavaScript", () => {
    service.databaseTableCreate("tasks", [
      { name: "labels", kind: "multi_choice", choices: ["bug", "feature", "urgent"] },
    ])

    service.databaseRowCreate("tasks", { labels: ["bug", "bug", "feature"] })
    service.databaseRowCreate("tasks", { labels: ["feature"] })
    service.databaseSqlExecute(`INSERT INTO "tasks" ("labels") VALUES (?)`, ["not-json"])

    expect(service.databaseChoiceUsageGet("tasks", "labels")).toEqual({
      bug: 1,
      feature: 2,
      urgent: 0,
    })
    expect(() => service.databaseChoiceUpdate("tasks", "labels", ["bug"]))
      .toThrow("existing rows contain values not in the new list: feature")

    service.databaseChoiceUpdate("tasks", "labels", ["bug", "feature"])
    expect(service.databaseTableDescribe("tasks").columns.find((column) => column.name === "labels"))
      .toMatchObject({ choices: ["bug", "feature"] })
  })

  it("rejects table moves before mutating folder membership when targets are missing", () => {
    service.databaseTableCreate("tasks", [
      { name: "title", kind: "text" },
    ])
    const { id: sourceFolderId } = service.folderCreate("Source")
    const { id: targetFolderId } = service.folderCreate("Target")
    service.folderMoveTable("tasks", sourceFolderId)

    expect(() => service.folderMoveTable("missing_table", targetFolderId)).toThrow('Table "missing_table" not found')
    expect(() => service.folderMoveTable("tasks", 9999)).toThrow("Folder not found: 9999")

    expect(service.folderList()).toEqual([
      {
        id: sourceFolderId,
        name: "Source",
        sortOrder: 0,
        members: [{ tableName: "tasks", sortOrder: 0 }],
      },
      {
        id: targetFolderId,
        name: "Target",
        sortOrder: 1,
        members: [],
      },
    ])
  })

  it("requires folder reorder ids to match all current folders exactly once", () => {
    const { id: firstFolderId } = service.folderCreate("First")
    const { id: secondFolderId } = service.folderCreate("Second")
    const { id: thirdFolderId } = service.folderCreate("Third")
    const initialFolders = service.folderList()

    expect(() => service.folderReorderFolders([thirdFolderId]))
      .toThrow("folderIds must contain every folder id exactly once")
    expect(() => service.folderReorderFolders([firstFolderId, firstFolderId, thirdFolderId]))
      .toThrow(`Duplicate folder id: ${firstFolderId}`)
    expect(() => service.folderReorderFolders([firstFolderId, secondFolderId, 9999]))
      .toThrow("Unknown folder id: 9999")
    expect(() => service.folderReorderFolders([firstFolderId, secondFolderId, 1.5]))
      .toThrow("Folder id must be an integer")

    expect(service.folderList()).toEqual(initialFolders)

    service.folderReorderFolders([thirdFolderId, secondFolderId, firstFolderId])

    expect(service.folderList().map((folder) => folder.id)).toEqual([
      thirdFolderId,
      secondFolderId,
      firstFolderId,
    ])
  })

  it("rejects bulk updates with empty grouped where conditions", () => {
    service.databaseTableCreate("tasks", [
      { name: "title", kind: "text" },
      { name: "state_note", kind: "text" },
    ])
    service.databaseRowCreate("tasks", { title: "First", state_note: "open" })
    service.databaseRowCreate("tasks", { title: "Second", state_note: "open" })

    expect(() => service.databaseRowsUpdate(
      "tasks",
      { combinator: "all", conditions: [] },
      { state_note: "closed" },
    )).toThrow("database.rows.update requires a non-empty where clause")

    expect(service.databaseRowList({ table: "tasks", orderBy: "id" }).rows.map((row) => row.state_note)).toEqual([
      "open",
      "open",
    ])
  })

  it("rejects empty update payloads without touching row timestamps", () => {
    service.databaseTableCreate("tasks", [
      { name: "title", kind: "text" },
      { name: "state_note", kind: "text" },
    ])
    const { id } = service.databaseRowCreate("tasks", { title: "First", state_note: "open" })
    const before = service.databaseRowList({ table: "tasks" }).rows[0]

    expect(() => service.databaseRowUpdate("tasks", id, {}))
      .toThrow("database.row.update requires at least one non-system field to update")
    expect(() => service.databaseRowUpdate("tasks", id, { updated_at: "2026-01-02T00:00:00.000Z" }))
      .toThrow("database.row.update requires at least one non-system field to update")
    expect(() => service.databaseRowsUpdate("tasks", { id }, {}))
      .toThrow("database.rows.update requires at least one non-system field to update")
    expect(() => service.databaseRowsUpdate("tasks", { id }, { created_at: "2026-01-02T00:00:00.000Z" }))
      .toThrow("database.rows.update requires at least one non-system field to update")

    const after = service.databaseRowList({ table: "tasks" }).rows[0]
    expect(after?.updated_at).toBe(before?.updated_at)
    expect(after).toMatchObject({ title: "First", state_note: "open" })
  })

  it("rejects bulk deletes with empty grouped where conditions", () => {
    service.databaseTableCreate("tasks", [
      { name: "title", kind: "text" },
    ])
    service.databaseRowCreate("tasks", { title: "First" })
    service.databaseRowCreate("tasks", { title: "Second" })

    expect(() => service.databaseRowsDelete(
      "tasks",
      { combinator: "any", conditions: [] },
    )).toThrow("database.rows.delete requires a non-empty where clause")

    expect(service.databaseRowList({ table: "tasks" }).total).toBe(2)
  })

  it("normalizes row list count totals from sqlite number-like values", async () => {
    const source = await readFile(
      new URL("../service.ts", import.meta.url),
      "utf8",
    )

    expect(source).toContain("as { total: number | bigint }")
    expect(source).toContain("total: toNumber(countRow.total)")
  })
})

describe("DatabaseService legacy database migration", () => {
  beforeEach(async () => {
    tempDir = await mkdtemp(path.join(os.tmpdir(), "synapse-database-"))
    electronMock.app.getPath.mockReturnValue(tempDir)
    vi.resetModules()
  })

  afterEach(async () => {
    service?.close()
    await rm(tempDir, { recursive: true, force: true })
    electronMock.app.getPath.mockReset()
  })

  it("migrates the legacy file name and enum_values schema in place", { timeout: 15_000 }, async () => {
    createLegacyDatabase(path.join(tempDir, "synapse-data.db"))

    const module = await import("../service")
    service = module.databaseService
    service.open()

    const schema = service.databaseTableDescribe("wdbc_money")
    expect(schema.rowCount).toBe(1)
    expect(schema.columns).toContainEqual(expect.objectContaining({
      name: "person",
      kind: "single_choice",
      choices: ["张三", "李四"],
      description: "人员",
    }))
    expect(schema.columns).toContainEqual(expect.objectContaining({
      name: "amount",
      kind: "decimal",
    }))
    expect(service.databaseRowList({ table: "wdbc_money" }).rows[0]).toMatchObject({
      reason: "迟到",
      person: "张三",
      type: "收入",
      amount: 12.5,
    })

    expect(readdirSync(tempDir)).toContain("synapse-database.db")

    const backupName = readdirSync(tempDir).find((name) => /^synapse-database\.db\.legacy-migration\.\d+$/.test(name))
    expect(backupName).toBeDefined()
    const backupDb = new DatabaseSync(path.join(tempDir, backupName!))
    try {
      const legacyColumns = backupDb.prepare(`PRAGMA table_info("_meta_columns")`).all() as { name: string }[]
      expect(legacyColumns.map((column) => column.name)).not.toContain("kind")
      expect((backupDb.prepare(`SELECT COUNT(*) AS count FROM "wdbc_money"`).get() as { count: number }).count).toBe(1)
    } finally {
      backupDb.close()
    }
  })

  it("recovers the latest legacy backup when the current database is empty", async () => {
    createLegacyDatabase(path.join(tempDir, "synapse-data.db.legacy.100"))

    const module = await import("../service")
    service = module.databaseService
    service.open()

    expect(service.databaseTableList()).toContainEqual(expect.objectContaining({
      name: "wdbc_money",
      rowCount: 1,
    }))
    expect(service.databaseTableDescribe("wdbc_money").columns).toContainEqual(expect.objectContaining({
      name: "person",
      kind: "single_choice",
      choices: ["张三", "李四"],
    }))
  })

  it("recovers a legacy backup when the buggy current database only has empty system tables", { timeout: 15_000 }, async () => {
    createEmptyCurrentDatabaseWithOperationLog(path.join(tempDir, "synapse-database.db"))
    createLegacyDatabase(path.join(tempDir, "synapse-data.db.legacy.100"))

    const module = await import("../service")
    service = module.databaseService
    service.open()

    expect(service.databaseTableList()).toContainEqual(expect.objectContaining({
      name: "wdbc_money",
      rowCount: 1,
    }))
  })

  it("does not restore a legacy backup over a current database with user tables", { timeout: 15_000 }, async () => {
    createCurrentDatabaseWithoutColumnDescriptions(path.join(tempDir, "synapse-database.db"))
    createLegacyDatabase(path.join(tempDir, "synapse-data.db.legacy.100"))

    const module = await import("../service")
    service = module.databaseService
    service.open()

    expect(service.databaseTableList()).toContainEqual(expect.objectContaining({
      name: "wdbc_money",
      rowCount: 1,
    }))
    expect(service.databaseTableDescribe("wdbc_money").columns).toContainEqual(expect.objectContaining({
      name: "person",
      kind: "single_choice",
      choices: ["张三", "李四"],
      description: "",
    }))
    expect(readdirSync(tempDir).some((name) => /^synapse-database\.db\.legacy-migration\.\d+$/.test(name))).toBe(false)
  })

  it("stops opening a corrupted database when the recovery backup cannot be created", async () => {
    const dbPath = path.join(tempDir, "synapse-database.db")
    await writeFile(dbPath, "corrupted", "utf8")
    const actualFs = await vi.importActual<typeof import("node:fs")>("node:fs")
    const renameSync = vi.fn(() => {
      throw new Error("rename denied")
    })
    const prepare = vi.fn((sql: string) => ({
      all: vi.fn(() => sql.includes("integrity_check")
        ? [{ integrity_check: "database disk image is malformed" }]
        : []),
      get: vi.fn(() => null),
      run: vi.fn(),
    }))
    const close = vi.fn()

    vi.doMock("node:fs", async () => ({
      ...actualFs,
      renameSync,
    }))
    const DatabaseSyncMock = vi.fn(function DatabaseSync() {
      return {
        close,
        exec: vi.fn(),
        prepare,
      }
    })
    vi.doMock("node:sqlite", () => ({
      DatabaseSync: DatabaseSyncMock,
    }))

    try {
      const module = await import("../service")
      service = module.databaseService

      expect(() => service.open()).toThrow("Failed to backup corrupted database before recovery")
      expect(renameSync).toHaveBeenCalledWith(dbPath, expect.stringContaining("synapse-database.db.corrupt."))
    } finally {
      vi.doUnmock("node:fs")
      vi.doUnmock("node:sqlite")
    }
  })

  it("imports a legacy database backup", async () => {
    const sourcePath = path.join(tempDir, "legacy-backup.db")
    createLegacyDatabase(sourcePath)

    const module = await import("../service")
    service = module.databaseService
    service.open()

    service.importDatabase(sourcePath)

    expect(service.databaseTableList()).toContainEqual(expect.objectContaining({
      name: "wdbc_money",
      rowCount: 1,
    }))
    expect(service.databaseTableDescribe("wdbc_money").columns).toContainEqual(expect.objectContaining({
      name: "type",
      kind: "single_choice",
      choices: ["收入", "支出"],
    }))
  })

  it("imports committed source WAL data", async () => {
    const sourcePath = path.join(tempDir, "wal-source.db")
    createEmptyCurrentDatabaseWithOperationLog(sourcePath)

    const module = await import("../service")
    service = module.databaseService
    service.open()
    service.databaseTableCreate("existing_before_import", [{ name: "title", kind: "text" }])
    const sourceDb = new DatabaseSync(sourcePath)
    const now = "2026-04-24T07:33:41.375Z"

    try {
      sourceDb.exec(`
        PRAGMA journal_mode=WAL;
        PRAGMA wal_autocheckpoint=0;
        CREATE TABLE "wal_items" (
          "id" INTEGER PRIMARY KEY AUTOINCREMENT,
          "created_at" TEXT NOT NULL DEFAULT '',
          "updated_at" TEXT NOT NULL DEFAULT '',
          "title" TEXT
        );
      `)
      sourceDb.prepare(`INSERT INTO "_meta_tables" (name, description, created_at, updated_at) VALUES (?, ?, ?, ?)`)
        .run("wal_items", "WAL items", now, now)
      sourceDb.prepare(`INSERT INTO "_meta_columns" (table_name, column_name, kind, choices, description) VALUES (?, ?, ?, ?, ?)`)
        .run("wal_items", "title", "text", null, "")
      sourceDb.prepare(`INSERT INTO "wal_items" (created_at, updated_at, title) VALUES (?, ?, ?)`)
        .run(now, now, "from wal")

      expect(existsSync(`${sourcePath}-wal`)).toBe(true)
      service.importDatabase(sourcePath)
    } finally {
      sourceDb.close()
    }

    expect(service.databaseTableList()).toContainEqual(expect.objectContaining({
      name: "wal_items",
      rowCount: 1,
    }))
    expect(service.databaseRowList({ table: "wal_items" }).rows).toContainEqual(expect.objectContaining({
      title: "from wal",
    }))
  })

  it("keeps the current database open when import replacement and backup restore both fail", async () => {
    const sourcePath = path.join(tempDir, "valid-import.db")
    createEmptyCurrentDatabaseWithOperationLog(sourcePath)

    const actualFs = await vi.importActual<typeof import("node:fs")>("node:fs")
    let backupPath: string | null = null
    const copyFileSync = vi.fn((source: Parameters<typeof actualFs.copyFileSync>[0], target: Parameters<typeof actualFs.copyFileSync>[1]) => {
      const sourceFilePath = String(source)
      const targetFilePath = String(target)

      if (targetFilePath.includes(".import-backup.")) {
        backupPath = targetFilePath
        actualFs.copyFileSync(source, target)
        return
      }
      if (sourceFilePath !== backupPath && targetFilePath.endsWith("synapse-database.db")) {
        throw new Error("simulated source copy failure")
      }
      if (backupPath && sourceFilePath === backupPath) {
        throw new Error("simulated restore copy failure")
      }
      actualFs.copyFileSync(source, target)
    })

    vi.doMock("node:fs", async () => ({
      ...actualFs,
      copyFileSync,
    }))

    try {
      const module = await import("../service")
      service = module.databaseService
      service.open()
      service.databaseTableCreate("tasks", [{ name: "title", kind: "text" }])

      expect(() => service.importDatabase(sourcePath)).toThrow("simulated source copy failure")
      expect(service.databaseTableList()).toContainEqual(expect.objectContaining({ name: "tasks" }))
    } finally {
      vi.doUnmock("node:fs")
    }
  })
})
