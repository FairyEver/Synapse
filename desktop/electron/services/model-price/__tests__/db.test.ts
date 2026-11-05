import fs from "node:fs"
import os from "node:os"
import path from "node:path"
import { DatabaseSync } from "node:sqlite"
import { afterEach, describe, expect, it, vi } from "vitest"
import { closeModelPriceDbForTests, getModelPriceDb, getModelPriceDbPath } from "../db"
import { initModelPriceSchema } from "../db-schema"

vi.mock("../../log-store", () => ({
  createMainLogger: () => ({ warn: vi.fn() }),
}))

const tempDirs: string[] = []

afterEach(() => {
  closeModelPriceDbForTests()
  for (const dir of tempDirs.splice(0)) {
    fs.rmSync(dir, { recursive: true, force: true })
  }
})

describe("model price database", () => {
  it("migrates price rules from usage.db and removes the legacy database files", () => {
    const dir = createTempDir()
    createLegacyUsageDb(dir, "legacy-rule")

    const db = getModelPriceDb(dir)

    expect(db.prepare("SELECT model_pattern FROM model_price_rules").all()).toEqual([
      { model_pattern: "legacy-rule" },
    ])
    closeModelPriceDbForTests()

    expect(fs.existsSync(getModelPriceDbPath(dir))).toBe(true)
    expect(fs.existsSync(path.join(dir, "usage.db"))).toBe(false)
    expect(fs.existsSync(path.join(dir, "usage.db-wal"))).toBe(false)
    expect(fs.existsSync(path.join(dir, "usage.db-shm"))).toBe(false)
  })

  it("is idempotent after migration", () => {
    const dir = createTempDir()
    createLegacyUsageDb(dir, "legacy-rule")

    getModelPriceDb(dir)
    closeModelPriceDbForTests()
    const reopened = getModelPriceDb(dir)

    expect(reopened.prepare("SELECT model_pattern FROM model_price_rules").all()).toEqual([
      { model_pattern: "legacy-rule" },
    ])
  })

  it("keeps existing model-price rules when the new database is already populated", () => {
    const dir = createTempDir()
    const existing = new DatabaseSync(getModelPriceDbPath(dir))
    initModelPriceSchema(existing)
    insertRule(existing, "existing-rule")
    existing.close()
    createLegacyUsageDb(dir, "legacy-rule")

    const db = getModelPriceDb(dir)

    expect(db.prepare("SELECT model_pattern FROM model_price_rules").all()).toEqual([
      { model_pattern: "existing-rule" },
    ])
    expect(fs.existsSync(path.join(dir, "usage.db"))).toBe(false)
  })

  it("keeps the legacy database when migration fails", () => {
    const dir = createTempDir()
    const legacy = new DatabaseSync(path.join(dir, "usage.db"))
    legacy.exec("CREATE TABLE model_price_rules (id TEXT PRIMARY KEY)")
    legacy.close()

    expect(() => getModelPriceDb(dir)).not.toThrow()
    expect(fs.existsSync(path.join(dir, "usage.db"))).toBe(true)
  })
})

function createTempDir(): string {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "model-price-db-"))
  tempDirs.push(dir)
  return dir
}

function createLegacyUsageDb(dir: string, modelPattern: string): void {
  const legacy = new DatabaseSync(path.join(dir, "usage.db"))
  initModelPriceSchema(legacy)
  insertRule(legacy, modelPattern)
  legacy.close()
  fs.writeFileSync(path.join(dir, "usage.db-wal"), "")
  fs.writeFileSync(path.join(dir, "usage.db-shm"), "")
}

function insertRule(db: DatabaseSync, modelPattern: string): void {
  db.prepare(`
    INSERT INTO model_price_rules (
      id, model_pattern, input_per_1m, output_per_1m, cache_read_per_1m,
      cache_write_per_1m, reasoning_per_1m, currency, enabled, source,
      sort_index, updated_at
    ) VALUES (?, ?, 0, 0, 0, 0, 0, 'CNY', 1, 'user', 0, ?)
  `).run(`rule-${modelPattern}`, modelPattern, new Date().toISOString())
}
