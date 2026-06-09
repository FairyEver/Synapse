import { DatabaseSync } from "node:sqlite"
import path from "node:path"
import { app } from "electron"
import { initUsageAnalysisSchema } from "./db-schema"
import { createMainLogger } from "../log-store"

let db: DatabaseSync | null = null

export function getUsageAnalysisDb(baseDir = app.getPath("userData")): DatabaseSync {
  if (db) return db
  db = new DatabaseSync(getUsageAnalysisDbPath(baseDir))
  db.exec("PRAGMA journal_mode = WAL")
  db.exec("PRAGMA busy_timeout = 5000")
  db.exec("PRAGMA foreign_keys = ON")
  initUsageAnalysisSchema(db, {
    logger: createMainLogger("service.usage-analysis.currency-migration"),
  })
  return db
}

export function getUsageAnalysisDbPath(baseDir = app.getPath("userData")): string {
  return path.join(baseDir, "usage.db")
}

export function closeUsageAnalysisDbForTests(): void {
  db?.close()
  db = null
}
