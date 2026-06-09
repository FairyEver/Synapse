import type { DatabaseSync } from "node:sqlite"
import { createModelPriceRuleId, isModelPriceRuleId } from "./rule-id"

export const MODEL_PRICE_DEFAULTS_META_KEY = "initialized_from_defaults_v1"

interface ModelPriceRuleIdMigrationRow {
  readonly id: string
  readonly model_pattern: string
}

export function initModelPriceSchema(database: DatabaseSync): void {
  database.exec(`
    CREATE TABLE IF NOT EXISTS model_price_rules (
      id TEXT PRIMARY KEY,
      model_pattern TEXT NOT NULL,
      input_per_1m REAL NOT NULL DEFAULT 0,
      output_per_1m REAL NOT NULL DEFAULT 0,
      cache_read_per_1m REAL NOT NULL DEFAULT 0,
      cache_write_per_1m REAL NOT NULL DEFAULT 0,
      reasoning_per_1m REAL NOT NULL DEFAULT 0,
      currency TEXT NOT NULL DEFAULT 'CNY',
      enabled INTEGER NOT NULL DEFAULT 1,
      source TEXT NOT NULL DEFAULT 'builtin',
      sort_index INTEGER NOT NULL DEFAULT 0,
      updated_at TEXT NOT NULL
    )
  `)
  database.exec(`
    CREATE TABLE IF NOT EXISTS model_price_meta (
      key TEXT PRIMARY KEY,
      value TEXT NOT NULL,
      updated_at TEXT NOT NULL
    )
  `)
  migrateLegacyModelPriceRuleIds(database)
  seedModelPriceDefaults(database)
}

function migrateLegacyModelPriceRuleIds(database: DatabaseSync): void {
  const rows = database.prepare("SELECT id, model_pattern FROM model_price_rules").all() as unknown as ModelPriceRuleIdMigrationRow[]
  const existingIds = new Set(rows.map((row) => row.id))
  const legacyRows = rows.filter((row) => !isModelPriceRuleId(row.id))
  if (legacyRows.length === 0) return

  let transactionStarted = false
  database.exec("BEGIN IMMEDIATE")
  transactionStarted = true
  try {
    const update = database.prepare("UPDATE model_price_rules SET id = ? WHERE id = ?")
    for (const row of legacyRows) {
      existingIds.delete(row.id)
      const nextId = createAvailableLegacyRuleId(row, existingIds)
      update.run(nextId, row.id)
      existingIds.add(nextId)
    }
    database.exec("COMMIT")
    transactionStarted = false
  } catch (error) {
    if (transactionStarted) database.exec("ROLLBACK")
    throw error
  }
}

function createAvailableLegacyRuleId(row: ModelPriceRuleIdMigrationRow, existingIds: Set<string>): string {
  let attempt = 0
  while (true) {
    const namespace = attempt === 0 ? `legacy:${row.id}` : `legacy:${row.id}:${attempt}`
    const id = createModelPriceRuleId(namespace, row.model_pattern)
    if (!existingIds.has(id)) return id
    attempt += 1
  }
}

function seedModelPriceDefaults(database: DatabaseSync): void {
  const meta = database.prepare("SELECT value FROM model_price_meta WHERE key = ?").get(MODEL_PRICE_DEFAULTS_META_KEY) as { value?: string } | undefined
  if (meta?.value) return
  database.prepare(`
    INSERT OR REPLACE INTO model_price_meta (key, value, updated_at)
    VALUES (?, ?, ?)
  `).run(MODEL_PRICE_DEFAULTS_META_KEY, "1", new Date().toISOString())
}
