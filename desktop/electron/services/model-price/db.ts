import fs from "node:fs"
import path from "node:path"
import { DatabaseSync } from "node:sqlite"
import { app } from "electron"
import { createMainLogger } from "../log-store"
import { initModelPriceSchema } from "./db-schema"

const LEGACY_USAGE_DB_MIGRATION_KEY = "legacy_usage_db_migrated_v1"
const LEGACY_USAGE_DB_FILES = ["usage.db", "usage.db-wal", "usage.db-shm"] as const
const logger = createMainLogger("service.model-price.database")

let db: DatabaseSync | null = null

export function getModelPriceDb(baseDir = app.getPath("userData")): DatabaseSync {
  if (db) return db
  const next = new DatabaseSync(getModelPriceDbPath(baseDir))
  next.exec("PRAGMA journal_mode = WAL")
  next.exec("PRAGMA busy_timeout = 5000")
  next.exec("PRAGMA foreign_keys = ON")
  initModelPriceSchema(next)
  migrateLegacyUsageDb(next, baseDir)
  db = next
  return db
}

export function getModelPriceDbPath(baseDir = app.getPath("userData")): string {
  return path.join(baseDir, "model-price.db")
}

export function closeModelPriceDbForTests(): void {
  db?.close()
  db = null
}

function migrateLegacyUsageDb(target: DatabaseSync, baseDir: string): void {
  const legacyPath = path.join(baseDir, "usage.db")
  if (!fs.existsSync(legacyPath)) {
    removeLegacyUsageDbFiles(baseDir)
    return
  }

  if (hasMigrationMarker(target)) {
    removeLegacyUsageDbFiles(baseDir)
    return
  }

  let legacy: DatabaseSync | null = null
  try {
    legacy = new DatabaseSync(legacyPath)
    legacy.exec("PRAGMA busy_timeout = 5000")
    legacy.exec("PRAGMA wal_checkpoint(TRUNCATE)")
    const rules = readLegacyRules(legacy)
    const metadata = readLegacyMetadata(legacy)

    target.exec("BEGIN IMMEDIATE")
    try {
      if (modelPriceRuleCount(target) === 0) {
        insertLegacyRules(target, rules)
      }
      insertLegacyMetadata(target, metadata)
      target.prepare(`
        INSERT OR REPLACE INTO model_price_meta (key, value, updated_at)
        VALUES (?, '1', ?)
      `).run(LEGACY_USAGE_DB_MIGRATION_KEY, new Date().toISOString())
      target.exec("COMMIT")
    } catch (error) {
      target.exec("ROLLBACK")
      throw error
    }
  } catch (error) {
    logger.warn("Failed to migrate legacy usage.db price data; keeping the legacy database for retry.", {
      error,
    })
    return
  } finally {
    if (legacy) {
      try {
        legacy.close()
      } catch (error) {
        logger.warn("Failed to close legacy usage.db after migration.", { error })
      }
    }
  }

  removeLegacyUsageDbFiles(baseDir)
}

function hasMigrationMarker(db: DatabaseSync): boolean {
  const row = db.prepare("SELECT value FROM model_price_meta WHERE key = ?").get(
    LEGACY_USAGE_DB_MIGRATION_KEY,
  ) as { value?: string } | undefined
  return row?.value === "1"
}

function readLegacyRules(db: DatabaseSync): LegacyPriceRuleRow[] {
  if (!hasTable(db, "model_price_rules")) return []
  return db.prepare(`
    SELECT
      id, model_pattern, input_per_1m, output_per_1m, cache_read_per_1m,
      cache_write_per_1m, reasoning_per_1m, currency, enabled, source,
      sort_index, updated_at
    FROM model_price_rules
    ORDER BY sort_index ASC, id ASC
  `).all() as unknown as LegacyPriceRuleRow[]
}

function readLegacyMetadata(db: DatabaseSync): LegacyPriceMetaRow[] {
  if (!hasTable(db, "model_price_meta")) return []
  return db.prepare(`
    SELECT key, value, updated_at
    FROM model_price_meta
    ORDER BY key ASC
  `).all() as unknown as LegacyPriceMetaRow[]
}

function insertLegacyRules(db: DatabaseSync, rules: readonly LegacyPriceRuleRow[]): void {
  const insert = db.prepare(`
    INSERT OR IGNORE INTO model_price_rules (
      id, model_pattern, input_per_1m, output_per_1m, cache_read_per_1m,
      cache_write_per_1m, reasoning_per_1m, currency, enabled, source,
      sort_index, updated_at
    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
  `)
  for (const rule of rules) {
    insert.run(
      rule.id,
      rule.model_pattern,
      rule.input_per_1m,
      rule.output_per_1m,
      rule.cache_read_per_1m,
      rule.cache_write_per_1m,
      rule.reasoning_per_1m,
      rule.currency,
      rule.enabled,
      rule.source,
      rule.sort_index,
      rule.updated_at,
    )
  }
}

function insertLegacyMetadata(db: DatabaseSync, metadata: readonly LegacyPriceMetaRow[]): void {
  const insert = db.prepare(`
    INSERT OR IGNORE INTO model_price_meta (key, value, updated_at)
    VALUES (?, ?, ?)
  `)
  for (const row of metadata) insert.run(row.key, row.value, row.updated_at)
}

function modelPriceRuleCount(db: DatabaseSync): number {
  const row = db.prepare("SELECT COUNT(*) AS count FROM model_price_rules").get() as { count?: number } | undefined
  return Number(row?.count ?? 0)
}

function hasTable(db: DatabaseSync, tableName: string): boolean {
  const row = db.prepare(`
    SELECT name FROM sqlite_master WHERE type = 'table' AND name = ?
  `).get(tableName) as { name?: string } | undefined
  return row?.name === tableName
}

function removeLegacyUsageDbFiles(baseDir: string): void {
  for (const fileName of LEGACY_USAGE_DB_FILES) {
    const filePath = path.join(baseDir, fileName)
    try {
      fs.unlinkSync(filePath)
    } catch (error) {
      if (isMissingFileError(error)) continue
      logger.warn("Failed to remove legacy usage.db file.", {
        fileName,
        error,
      })
    }
  }
}

function isMissingFileError(error: unknown): boolean {
  return error instanceof Error && "code" in error && error.code === "ENOENT"
}

interface LegacyPriceRuleRow {
  readonly id: string
  readonly model_pattern: string
  readonly input_per_1m: number
  readonly output_per_1m: number
  readonly cache_read_per_1m: number
  readonly cache_write_per_1m: number
  readonly reasoning_per_1m: number
  readonly currency: string
  readonly enabled: number
  readonly source: string
  readonly sort_index: number
  readonly updated_at: string
}

interface LegacyPriceMetaRow {
  readonly key: string
  readonly value: string
  readonly updated_at: string
}
