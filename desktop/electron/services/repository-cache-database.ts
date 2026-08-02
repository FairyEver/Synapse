import { DatabaseSync } from "node:sqlite"
import { app } from "electron"
import { mkdir } from "node:fs/promises"
import path from "node:path"
import { createMainLogger } from "./log-store"

const logger = createMainLogger("service.cache-database")

function getRepositoryCacheDatabasePath(repositoryUuid: string): string {
  return path.join(app.getPath("userData"), "content-index", `${repositoryUuid}.db`)
}

type RepositoryCacheSchemaOptions = {
  includeContentWriteTransactions?: boolean
  includePendingPushes?: boolean
  includeRepositorySyncAttempt?: boolean
}

async function withRepositoryCacheDatabase<T>(
  repositoryUuid: string,
  callback: (database: DatabaseSync) => Promise<T> | T,
  options: RepositoryCacheSchemaOptions = {},
): Promise<T> {
  const t0 = Date.now()
  const databasePath = getRepositoryCacheDatabasePath(repositoryUuid)

  await mkdir(path.dirname(databasePath), { recursive: true })

  const tOpen = Date.now()
  const database = new DatabaseSync(databasePath)
  const tOpenDone = Date.now()

  try {
    const tSchema = Date.now()
    ensureRepositoryCacheSchema(database, options)
    const tSchemaDone = Date.now()

    if (tSchemaDone - t0 > 50) {
      logger.warn("withRepositoryCacheDatabase: slow open+schema.", {
        openMs: tOpenDone - tOpen,
        schemaMs: tSchemaDone - tSchema,
        repositoryUuid,
      })
    }

    return await callback(database)
  } finally {
    database.close()
  }
}

function ensureRepositoryCacheSchema(
  database: DatabaseSync,
  options: RepositoryCacheSchemaOptions,
): void {
  database.exec(`
    CREATE TABLE IF NOT EXISTS content_index (
      id TEXT PRIMARY KEY,
      type TEXT NOT NULL,
      title TEXT,
      name TEXT,
      description TEXT,
      usage TEXT,
      category TEXT,
      icon TEXT,
      icon_bg TEXT,
      modified_by TEXT,
      modified_by_name TEXT,
      modified_at TEXT,
      created_by TEXT,
      created_by_name TEXT,
      created_at TEXT,
      deleted INTEGER DEFAULT 0,
      latest_history_dirname TEXT,
      attachment_count INTEGER DEFAULT 0,
      has_env INTEGER NOT NULL DEFAULT 0
    );

    CREATE INDEX IF NOT EXISTS idx_content_index_modified_at
      ON content_index(modified_at DESC);

    CREATE INDEX IF NOT EXISTS idx_content_index_type_deleted
      ON content_index(type, deleted);

    CREATE TABLE IF NOT EXISTS index_meta (
      key TEXT PRIMARY KEY,
      value TEXT
    );
  `)

  // Migrate older DBs that predate the Skill `name` column.
  try {
    database.exec(`ALTER TABLE content_index ADD COLUMN name TEXT`)
  } catch (error) {
    const message = (error as Error).message ?? ""
    if (!message.includes("duplicate column")) {
      throw error
    }
  }

  // Migrate older DBs that predate newer content metadata columns.
  for (const stmt of [
    `ALTER TABLE content_index ADD COLUMN usage TEXT`,
    `ALTER TABLE content_index ADD COLUMN icon_type TEXT DEFAULT 'icon'`,
    `ALTER TABLE content_index ADD COLUMN icon_image TEXT`,
  ]) {
    try {
      database.exec(stmt)
    } catch (error) {
      const message = (error as Error).message ?? ""
      if (!message.includes("duplicate column")) {
        throw error
      }
    }
  }

  try {
    database.exec(`ALTER TABLE content_index ADD COLUMN has_env INTEGER NOT NULL DEFAULT 0`)
    database.prepare(`DELETE FROM index_meta WHERE key = ?`).run("last_synced_git_sha")
  } catch (error) {
    const message = (error as Error).message ?? ""
    if (!message.includes("duplicate column")) {
      throw error
    }
  }

  if (options.includePendingPushes) {
    database.exec(`
      CREATE TABLE IF NOT EXISTS pending_pushes (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        commit_hash TEXT,
        action TEXT,
        target_id TEXT,
        title TEXT,
        created_at TEXT,
        retry_count INTEGER DEFAULT 0,
        last_error TEXT
      );
    `)

    for (const stmt of [
      `ALTER TABLE pending_pushes ADD COLUMN last_attempt_at TEXT`,
      `ALTER TABLE pending_pushes ADD COLUMN next_retry_at TEXT`,
      `ALTER TABLE pending_pushes ADD COLUMN last_error_category TEXT`,
    ]) {
      try {
        database.exec(stmt)
      } catch (error) {
        const message = (error as Error).message ?? ""
        if (!message.includes("duplicate column")) {
          throw error
        }
      }
    }
  }

  if (options.includeRepositorySyncAttempt) {
    database.exec(`
      CREATE TABLE IF NOT EXISTS repository_sync_attempt (
        singleton_id INTEGER PRIMARY KEY CHECK (singleton_id = 1),
        last_attempt_at TEXT,
        last_error TEXT,
        last_error_category TEXT,
        retry_count INTEGER NOT NULL DEFAULT 0,
        next_retry_at TEXT
      );
    `)
  }

  if (options.includeContentWriteTransactions) {
    database.exec(`
      CREATE TABLE IF NOT EXISTS content_write_transactions (
        transaction_id TEXT PRIMARY KEY,
        phase TEXT NOT NULL,
        git_root_path TEXT NOT NULL,
        recovery_root_path TEXT NOT NULL,
        head_before TEXT NOT NULL,
        commit_hash TEXT,
        actions_json TEXT NOT NULL,
        created_at TEXT NOT NULL,
        updated_at TEXT NOT NULL
      );
    `)
  }
}

export {
  getRepositoryCacheDatabasePath,
  withRepositoryCacheDatabase,
}
