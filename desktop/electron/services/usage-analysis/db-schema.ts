import type { DatabaseSync } from "node:sqlite"

export function initUsageAnalysisSchema(database: DatabaseSync): void {
  for (const prefix of ["cc", "cx"] as const) {
    database.exec(`
      CREATE TABLE IF NOT EXISTS ${prefix}_scan_files (
        file_path TEXT PRIMARY KEY,
        size INTEGER NOT NULL,
        mtime_ms INTEGER NOT NULL,
        line_count INTEGER NOT NULL DEFAULT 0,
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
        hour TEXT NOT NULL DEFAULT '',
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
        cost_input REAL NOT NULL DEFAULT 0,
        cost_output REAL NOT NULL DEFAULT 0,
        cost_cache_read REAL NOT NULL DEFAULT 0,
        cost_cache_write REAL NOT NULL DEFAULT 0,
        cost_reasoning REAL NOT NULL DEFAULT 0,
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
        cost_input REAL NOT NULL DEFAULT 0,
        cost_output REAL NOT NULL DEFAULT 0,
        cost_cache_read REAL NOT NULL DEFAULT 0,
        cost_cache_write REAL NOT NULL DEFAULT 0,
        cost_reasoning REAL NOT NULL DEFAULT 0,
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

  for (const prefix of ["cc", "cx"] as const) {
    ensureColumn(database, `${prefix}_scan_files`, "line_count", "INTEGER NOT NULL DEFAULT 0")
    ensureColumn(database, `${prefix}_tool_events`, "hour", "TEXT NOT NULL DEFAULT ''")
    for (const aggregateTable of [`${prefix}_daily_usage`, `${prefix}_hourly_usage`]) {
      ensureColumn(database, aggregateTable, "cost_input", "REAL NOT NULL DEFAULT 0")
      ensureColumn(database, aggregateTable, "cost_output", "REAL NOT NULL DEFAULT 0")
      ensureColumn(database, aggregateTable, "cost_cache_read", "REAL NOT NULL DEFAULT 0")
      ensureColumn(database, aggregateTable, "cost_cache_write", "REAL NOT NULL DEFAULT 0")
      ensureColumn(database, aggregateTable, "cost_reasoning", "REAL NOT NULL DEFAULT 0")
    }
    database.exec(`CREATE INDEX IF NOT EXISTS idx_${prefix}_usage_date ON ${prefix}_usage_events(date)`)
    database.exec(`CREATE INDEX IF NOT EXISTS idx_${prefix}_usage_hour ON ${prefix}_usage_events(hour)`)
    database.exec(`CREATE INDEX IF NOT EXISTS idx_${prefix}_usage_date_model ON ${prefix}_usage_events(date, provider, model)`)
    database.exec(`CREATE INDEX IF NOT EXISTS idx_${prefix}_usage_date_workspace ON ${prefix}_usage_events(date, workspace_key)`)
    database.exec(`CREATE INDEX IF NOT EXISTS idx_${prefix}_usage_date_session ON ${prefix}_usage_events(date, session_id)`)
    database.exec(`CREATE INDEX IF NOT EXISTS idx_${prefix}_usage_model ON ${prefix}_usage_events(provider, model)`)
    database.exec(`CREATE INDEX IF NOT EXISTS idx_${prefix}_usage_workspace ON ${prefix}_usage_events(workspace_key)`)
    database.exec(`CREATE INDEX IF NOT EXISTS idx_${prefix}_usage_timestamp ON ${prefix}_usage_events(timestamp_ms)`)
    database.exec(`CREATE INDEX IF NOT EXISTS idx_${prefix}_tool_date ON ${prefix}_tool_events(date)`)
    database.exec(`CREATE INDEX IF NOT EXISTS idx_${prefix}_tool_hour ON ${prefix}_tool_events(hour)`)
    database.exec(`CREATE INDEX IF NOT EXISTS idx_${prefix}_tool_date_name ON ${prefix}_tool_events(date, category, tool_name)`)
    database.exec(`CREATE INDEX IF NOT EXISTS idx_${prefix}_tool_date_workspace ON ${prefix}_tool_events(date, workspace_key)`)
    database.exec(`CREATE INDEX IF NOT EXISTS idx_${prefix}_tool_session ON ${prefix}_tool_events(session_id)`)
    database.exec(`CREATE INDEX IF NOT EXISTS idx_${prefix}_tool_name ON ${prefix}_tool_events(category, tool_name)`)
  }
}

function ensureColumn(database: DatabaseSync, table: string, column: string, definition: string): void {
  const rows = database.prepare(`PRAGMA table_info(${table})`).all() as { name: string }[]
  if (rows.some((row) => row.name === column)) return
  database.exec(`ALTER TABLE ${table} ADD COLUMN ${column} ${definition}`)
}
