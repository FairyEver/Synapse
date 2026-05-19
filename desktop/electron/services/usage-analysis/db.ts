import { DatabaseSync } from "node:sqlite"
import path from "node:path"
import { app } from "electron"

let db: DatabaseSync | null = null

export function getUsageAnalysisDb(baseDir = app.getPath("userData")): DatabaseSync {
  if (db) return db
  db = new DatabaseSync(path.join(baseDir, "usage.db"))
  db.exec("PRAGMA journal_mode = WAL")
  db.exec("PRAGMA foreign_keys = ON")
  initUsageAnalysisSchema(db)
  return db
}

export function closeUsageAnalysisDbForTests(): void {
  db?.close()
  db = null
}

function initUsageAnalysisSchema(database: DatabaseSync): void {
  for (const prefix of ["cc", "cx"] as const) {
    database.exec(`
      CREATE TABLE IF NOT EXISTS ${prefix}_scan_files (
        file_path TEXT PRIMARY KEY,
        size INTEGER NOT NULL,
        mtime_ms INTEGER NOT NULL,
        parse_status TEXT NOT NULL,
        error_kind TEXT,
        last_scanned_at TEXT NOT NULL
      )
    `)
    database.exec(`
      CREATE TABLE IF NOT EXISTS ${prefix}_sessions (
        session_id TEXT PRIMARY KEY,
        file_path TEXT NOT NULL,
        workspace_key TEXT NOT NULL DEFAULT '',
        workspace_label TEXT NOT NULL DEFAULT '',
        provider TEXT NOT NULL DEFAULT '',
        source TEXT NOT NULL DEFAULT '',
        cli_version TEXT NOT NULL DEFAULT '',
        started_at TEXT NOT NULL DEFAULT '',
        ended_at TEXT NOT NULL DEFAULT '',
        model_summary TEXT NOT NULL DEFAULT '',
        request_count INTEGER NOT NULL DEFAULT 0,
        conversation_count INTEGER NOT NULL DEFAULT 0,
        tool_call_count INTEGER NOT NULL DEFAULT 0
      )
    `)
    database.exec(`
      CREATE TABLE IF NOT EXISTS ${prefix}_usage_events (
        id TEXT PRIMARY KEY,
        session_id TEXT NOT NULL,
        timestamp_ms INTEGER NOT NULL,
        date TEXT NOT NULL,
        hour TEXT NOT NULL,
        workspace_key TEXT NOT NULL DEFAULT '',
        workspace_label TEXT NOT NULL DEFAULT '',
        model TEXT NOT NULL DEFAULT 'unknown',
        provider TEXT NOT NULL DEFAULT '',
        input_tokens INTEGER NOT NULL DEFAULT 0,
        output_tokens INTEGER NOT NULL DEFAULT 0,
        cache_read_tokens INTEGER NOT NULL DEFAULT 0,
        cache_write_tokens INTEGER NOT NULL DEFAULT 0,
        reasoning_tokens INTEGER NOT NULL DEFAULT 0,
        cost_input REAL NOT NULL DEFAULT 0,
        cost_output REAL NOT NULL DEFAULT 0,
        cost_cache_read REAL NOT NULL DEFAULT 0,
        cost_cache_write REAL NOT NULL DEFAULT 0,
        cost_reasoning REAL NOT NULL DEFAULT 0,
        total_cost REAL NOT NULL DEFAULT 0
      )
    `)
    database.exec(`
      CREATE TABLE IF NOT EXISTS ${prefix}_tool_events (
        id TEXT PRIMARY KEY,
        session_id TEXT NOT NULL,
        timestamp_ms INTEGER NOT NULL,
        date TEXT NOT NULL,
        workspace_key TEXT NOT NULL DEFAULT '',
        tool_name TEXT NOT NULL,
        category TEXT NOT NULL,
        status TEXT NOT NULL DEFAULT '',
        exit_code INTEGER,
        duration_ms INTEGER
      )
    `)
    database.exec(`
      CREATE TABLE IF NOT EXISTS ${prefix}_daily_usage (
        date TEXT NOT NULL,
        model TEXT NOT NULL,
        provider TEXT NOT NULL DEFAULT '',
        workspace_key TEXT NOT NULL DEFAULT '',
        input_tokens INTEGER NOT NULL DEFAULT 0,
        output_tokens INTEGER NOT NULL DEFAULT 0,
        cache_read_tokens INTEGER NOT NULL DEFAULT 0,
        cache_write_tokens INTEGER NOT NULL DEFAULT 0,
        reasoning_tokens INTEGER NOT NULL DEFAULT 0,
        total_cost REAL NOT NULL DEFAULT 0,
        requests INTEGER NOT NULL DEFAULT 0,
        conversations INTEGER NOT NULL DEFAULT 0,
        tool_calls INTEGER NOT NULL DEFAULT 0,
        PRIMARY KEY (date, model, provider, workspace_key)
      )
    `)
    database.exec(`
      CREATE TABLE IF NOT EXISTS ${prefix}_hourly_usage (
        hour TEXT NOT NULL,
        model TEXT NOT NULL,
        provider TEXT NOT NULL DEFAULT '',
        workspace_key TEXT NOT NULL DEFAULT '',
        input_tokens INTEGER NOT NULL DEFAULT 0,
        output_tokens INTEGER NOT NULL DEFAULT 0,
        cache_read_tokens INTEGER NOT NULL DEFAULT 0,
        cache_write_tokens INTEGER NOT NULL DEFAULT 0,
        reasoning_tokens INTEGER NOT NULL DEFAULT 0,
        total_cost REAL NOT NULL DEFAULT 0,
        requests INTEGER NOT NULL DEFAULT 0,
        conversations INTEGER NOT NULL DEFAULT 0,
        tool_calls INTEGER NOT NULL DEFAULT 0,
        PRIMARY KEY (hour, model, provider, workspace_key)
      )
    `)
  }

  database.exec(`
    CREATE TABLE IF NOT EXISTS cx_task_events (
      id TEXT PRIMARY KEY,
      session_id TEXT NOT NULL,
      started_at TEXT NOT NULL DEFAULT '',
      completed_at TEXT NOT NULL DEFAULT '',
      duration_ms INTEGER,
      time_to_first_token_ms INTEGER
    )
  `)
}
