import { DatabaseSync } from "node:sqlite"
import { app } from "electron"
import { mkdir } from "node:fs/promises"
import path from "node:path"

function getRepositoryCacheDatabasePath(repositoryUuid: string): string {
  return path.join(app.getPath("userData"), "content-index", `${repositoryUuid}.db`)
}

type RepositoryCacheSchemaOptions = {
  includePendingPushes?: boolean
}

async function withRepositoryCacheDatabase<T>(
  repositoryUuid: string,
  callback: (database: DatabaseSync) => Promise<T> | T,
  options: RepositoryCacheSchemaOptions = {},
): Promise<T> {
  const databasePath = getRepositoryCacheDatabasePath(repositoryUuid)

  await mkdir(path.dirname(databasePath), { recursive: true })

  const database = new DatabaseSync(databasePath)

  try {
    ensureRepositoryCacheSchema(database, options)
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
      description TEXT,
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
      attachment_count INTEGER DEFAULT 0
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
  }
}

export {
  getRepositoryCacheDatabasePath,
  withRepositoryCacheDatabase,
}
