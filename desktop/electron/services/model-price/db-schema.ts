import type { DatabaseSync } from "node:sqlite"

export const MODEL_PRICE_DEFAULTS_META_KEY = "initialized_from_defaults_v1"

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
  seedModelPriceDefaults(database)
}

function seedModelPriceDefaults(database: DatabaseSync): void {
  const meta = database.prepare("SELECT value FROM model_price_meta WHERE key = ?").get(MODEL_PRICE_DEFAULTS_META_KEY) as { value?: string } | undefined
  if (meta?.value) return
  database.prepare(`
    INSERT OR REPLACE INTO model_price_meta (key, value, updated_at)
    VALUES (?, ?, ?)
  `).run(MODEL_PRICE_DEFAULTS_META_KEY, "1", new Date().toISOString())
}
