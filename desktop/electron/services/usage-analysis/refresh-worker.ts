import { DatabaseSync } from "node:sqlite"
import { parentPort, workerData } from "node:worker_threads"
import { CcUsageAnalysisService, runWithUsageDatabaseLockRetry } from "./cc-service"
import { CodexUsageAnalysisService } from "./codex-service"
import { initUsageAnalysisSchema } from "./db-schema"
import type { UsageRefreshInput, UsageRefreshResult } from "./types"

interface UsageRefreshWorkerInput {
  readonly dbPath: string
  readonly prefix: "cc" | "cx"
  readonly roots: readonly string[]
  readonly scope?: UsageRefreshInput
}

function asRefreshWorkerInput(value: unknown): UsageRefreshWorkerInput {
  const input = value as Partial<UsageRefreshWorkerInput>
  if (typeof input.dbPath !== "string" || (input.prefix !== "cc" && input.prefix !== "cx") || !Array.isArray(input.roots)) {
    throw new Error("Invalid usage analysis refresh worker input")
  }
  return {
    dbPath: input.dbPath,
    prefix: input.prefix,
    roots: input.roots.filter((root): root is string => typeof root === "string"),
    scope: input.scope?.preset === "today" ? { preset: "today" } : undefined,
  }
}

async function runRefresh(): Promise<UsageRefreshResult> {
  const input = asRefreshWorkerInput(workerData)
  const db = new DatabaseSync(input.dbPath)
  try {
    db.exec("PRAGMA journal_mode = WAL")
    db.exec("PRAGMA busy_timeout = 5000")
    db.exec("PRAGMA foreign_keys = ON")
    await runWithUsageDatabaseLockRetry(() => {
      initUsageAnalysisSchema(db)
    })
    const service = input.prefix === "cc"
      ? new CcUsageAnalysisService({ db, roots: [...input.roots] })
      : new CodexUsageAnalysisService({ db, roots: [...input.roots] })
    return await service.refresh(input.scope)
  } finally {
    db.close()
  }
}

void runRefresh()
  .then((result) => {
    parentPort?.postMessage({ type: "success", result })
  })
  .catch((error: unknown) => {
    const refreshError = error instanceof Error
      ? { name: error.name, message: error.message, stack: error.stack }
      : { message: String(error) }
    parentPort?.postMessage({ type: "error", error: refreshError })
  })
