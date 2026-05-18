import { readdirSync } from "node:fs"
import { mkdtemp, rm } from "node:fs/promises"
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

  it("allows system-table-looking tokens inside SQL string literals", () => {
    const result = service.databaseSqlExecute("SELECT 'contains _not_a_table in text' AS note")

    expect(result.rows).toEqual([{ note: "contains _not_a_table in text" }])
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

  it("recovers a legacy backup when the buggy current database only has empty system tables", async () => {
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

  it("does not restore a legacy backup over a current database with user tables", async () => {
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
})
