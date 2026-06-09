import type { DatabaseSync } from "node:sqlite"
import { DEFAULT_MODEL_PRICE_RULES } from "./defaults"
import type { ModelPriceRule } from "./types"

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
  let transactionStarted = false
  database.exec("BEGIN IMMEDIATE")
  transactionStarted = true
  try {
    database.exec("DELETE FROM model_price_rules")
    insertSeedRules(database, DEFAULT_MODEL_PRICE_RULES)
    database.prepare(`
      INSERT OR REPLACE INTO model_price_meta (key, value, updated_at)
      VALUES (?, ?, ?)
    `).run(MODEL_PRICE_DEFAULTS_META_KEY, "1", new Date().toISOString())
    database.exec("COMMIT")
    transactionStarted = false
  } catch (error) {
    if (transactionStarted) database.exec("ROLLBACK")
    throw error
  }
}

function insertSeedRules(database: DatabaseSync, rules: readonly ModelPriceRule[]): void {
  const insert = database.prepare(`
    INSERT INTO model_price_rules (
      id, model_pattern, input_per_1m, output_per_1m, cache_read_per_1m,
      cache_write_per_1m, reasoning_per_1m, currency, enabled, source, sort_index, updated_at
    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
  `)
  for (const rule of rules) {
    insert.run(
      rule.id,
      rule.modelPattern,
      rule.inputPer1M,
      rule.outputPer1M,
      rule.cacheReadPer1M,
      rule.cacheWritePer1M,
      rule.reasoningPer1M,
      rule.currency,
      rule.enabled ? 1 : 0,
      rule.source,
      rule.sortIndex,
      rule.updatedAt,
    )
  }
}
