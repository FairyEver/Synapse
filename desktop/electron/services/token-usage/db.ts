import { DatabaseSync } from "node:sqlite"
import path from "node:path"
import { app } from "electron"
import type { FileFingerprint, UnifiedMessage } from "./parsers/types"

let db: DatabaseSync | null = null

function getDb(): DatabaseSync {
  if (db) return db
  const dbPath = path.join(app.getPath("userData"), "token-usage.db")
  db = new DatabaseSync(dbPath)
  db.exec("PRAGMA journal_mode = WAL")
  db.exec("PRAGMA foreign_keys = ON")
  initSchema(db)
  return db
}

function initSchema(database: DatabaseSync): void {
  database.exec(`
    CREATE TABLE IF NOT EXISTS file_fingerprints (
      file_path TEXT PRIMARY KEY,
      client_id TEXT NOT NULL,
      size INTEGER NOT NULL,
      mtime_ms INTEGER NOT NULL,
      bytes_parsed INTEGER NOT NULL DEFAULT 0
    )
  `)
  database.exec(`
    CREATE TABLE IF NOT EXISTS usage_daily (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      client TEXT NOT NULL,
      model_id TEXT NOT NULL,
      provider_id TEXT NOT NULL,
      date TEXT NOT NULL,
      input_tokens INTEGER NOT NULL DEFAULT 0,
      output_tokens INTEGER NOT NULL DEFAULT 0,
      cache_read_tokens INTEGER NOT NULL DEFAULT 0,
      cache_write_tokens INTEGER NOT NULL DEFAULT 0,
      reasoning_tokens INTEGER NOT NULL DEFAULT 0,
      message_count INTEGER NOT NULL DEFAULT 0,
      turn_count INTEGER NOT NULL DEFAULT 0,
      cost_usd REAL NOT NULL DEFAULT 0,
      UNIQUE(client, model_id, provider_id, date)
    )
  `)
  database.exec(`
    CREATE TABLE IF NOT EXISTS scan_meta (
      key TEXT PRIMARY KEY,
      value TEXT NOT NULL
    )
  `)
}

export function getFingerprint(filePath: string): FileFingerprint | null {
  const row = getDb()
    .prepare("SELECT file_path, client_id, size, mtime_ms, bytes_parsed FROM file_fingerprints WHERE file_path = ?")
    .get(filePath) as Record<string, unknown> | undefined
  if (!row) return null
  return {
    filePath: row.file_path as string,
    clientId: row.client_id as string,
    size: row.size as number,
    mtimeMs: row.mtime_ms as number,
    bytesParsed: row.bytes_parsed as number,
  }
}

export function upsertFingerprint(fp: FileFingerprint): void {
  getDb()
    .prepare(
      `INSERT INTO file_fingerprints (file_path, client_id, size, mtime_ms, bytes_parsed)
       VALUES (?, ?, ?, ?, ?)
       ON CONFLICT(file_path) DO UPDATE SET
         size = excluded.size, mtime_ms = excluded.mtime_ms, bytes_parsed = excluded.bytes_parsed`,
    )
    .run(fp.filePath, fp.clientId, fp.size, fp.mtimeMs, fp.bytesParsed)
}

export function upsertDailyUsage(messages: UnifiedMessage[]): void {
  const database = getDb()
  const stmt = database.prepare(
    `INSERT INTO usage_daily (client, model_id, provider_id, date, input_tokens, output_tokens,
       cache_read_tokens, cache_write_tokens, reasoning_tokens, message_count, turn_count, cost_usd)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
     ON CONFLICT(client, model_id, provider_id, date) DO UPDATE SET
       input_tokens = input_tokens + excluded.input_tokens,
       output_tokens = output_tokens + excluded.output_tokens,
       cache_read_tokens = cache_read_tokens + excluded.cache_read_tokens,
       cache_write_tokens = cache_write_tokens + excluded.cache_write_tokens,
       reasoning_tokens = reasoning_tokens + excluded.reasoning_tokens,
       message_count = message_count + excluded.message_count,
       turn_count = turn_count + excluded.turn_count,
       cost_usd = cost_usd + excluded.cost_usd`,
  )
  for (const msg of messages) {
    stmt.run(msg.client, msg.modelId, msg.providerId, msg.date,
      msg.tokens.input, msg.tokens.output, msg.tokens.cacheRead, msg.tokens.cacheWrite,
      msg.tokens.reasoning, msg.messageCount, msg.isTurnStart ? 1 : 0, msg.cost)
  }
}

export function clearDailyUsageForClient(clientId: string): void {
  getDb().prepare("DELETE FROM usage_daily WHERE client = ?").run(clientId)
}

export function clearFingerprintsForClient(clientId: string): void {
  getDb().prepare("DELETE FROM file_fingerprints WHERE client_id = ?").run(clientId)
}

export function clearAllData(): void {
  const database = getDb()
  database.exec("DELETE FROM usage_daily")
  database.exec("DELETE FROM file_fingerprints")
  database.exec("DELETE FROM scan_meta")
}

export function setScanMeta(key: string, value: string): void {
  getDb()
    .prepare("INSERT INTO scan_meta (key, value) VALUES (?, ?) ON CONFLICT(key) DO UPDATE SET value = excluded.value")
    .run(key, value)
}

export function getScanMeta(key: string): string | null {
  const row = getDb().prepare("SELECT value FROM scan_meta WHERE key = ?").get(key) as { value: string } | undefined
  return row?.value ?? null
}

export function queryDailyRows(): Record<string, unknown>[] {
  return getDb().prepare("SELECT * FROM usage_daily ORDER BY date ASC").all() as Record<string, unknown>[]
}

export function queryDailyRowsFiltered(since?: string, until?: string): Record<string, unknown>[] {
  let query = "SELECT * FROM usage_daily"
  const conditions: string[] = []
  const params: string[] = []
  if (since) { conditions.push("date >= ?"); params.push(since) }
  if (until) { conditions.push("date <= ?"); params.push(until) }
  if (conditions.length > 0) query += " WHERE " + conditions.join(" AND ")
  query += " ORDER BY date ASC"
  return getDb().prepare(query).all(...params) as Record<string, unknown>[]
}
