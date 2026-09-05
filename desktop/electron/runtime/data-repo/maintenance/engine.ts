import { statSync } from "node:fs"
import { DatabaseSync } from "node:sqlite"

import type {
  DataMaintenanceCounts,
  DataMaintenancePolicy,
  DataMaintenanceProgress,
  DataMaintenanceResult,
} from "../types"

export interface RunDataMaintenanceOptions {
  readonly databasePath: string
  readonly policy: DataMaintenancePolicy
  readonly now?: () => Date
  readonly onProgress?: (progress: DataMaintenanceProgress) => void
  readonly yieldBetweenBatches?: () => Promise<void>
}

const OUTBOX_TABLE = "ns_outbox"
const AGENT_EVENTS_TABLE = "ns_agent_events"
const CONVERSATIONS_TABLE = "ns_conversations"

export async function runDataMaintenance(
  options: RunDataMaintenanceOptions,
): Promise<DataMaintenanceResult> {
  validatePolicy(options.policy)
  const now = options.now ?? (() => new Date())
  const yieldBetweenBatches = options.yieldBetweenBatches ?? yieldToWorkerLoop
  const startedAtDate = now()
  const startedAt = startedAtDate.toISOString()
  const databaseBytesBefore = safeFileSize(options.databasePath)
  const database = new DatabaseSync(options.databasePath)
  const deleted = emptyCounts()

  try {
    database.exec("PRAGMA busy_timeout = 250")
    const freePagesBefore = pragmaNumber(database, "freelist_count")
    let remaining = options.policy.maxDeletions

    if (remaining > 0 && tableExists(database, OUTBOX_TABLE)) {
      remaining = await deleteInBatches({
        database,
        tableName: OUTBOX_TABLE,
        selectSql: `
          SELECT id
          FROM ${OUTBOX_TABLE}
          WHERE json_extract(value, '$.status') IN ('sent', 'delivered')
            AND json_extract(value, '$.destination.platform') = 'local-renderer'
          LIMIT ?
        `,
        selectParams: [],
        limit: remaining,
        batchSize: options.policy.batchSize,
        onBatch: (count) => {
          deleted.localOutbox += count
          options.onProgress?.({ phase: "outbox-local", deleted: { ...deleted } })
        },
        yieldBetweenBatches,
      })
    }

    if (remaining > 0 && tableExists(database, OUTBOX_TABLE)) {
      remaining = await deleteInBatches({
        database,
        tableName: OUTBOX_TABLE,
        selectSql: `
          SELECT id
          FROM (
            SELECT
              id,
              ROW_NUMBER() OVER (
                PARTITION BY
                  json_extract(value, '$.projectId'),
                  json_extract(value, '$.destination.platform'),
                  COALESCE(json_extract(value, '$.destination.connectorId'), ''),
                  COALESCE(json_extract(value, '$.destination.sessionKey'), '')
                ORDER BY json_extract(value, '$.updatedAt') DESC, id DESC
              ) AS retention_rank
            FROM ${OUTBOX_TABLE}
            WHERE json_extract(value, '$.status') IN ('sent', 'delivered')
              AND COALESCE(json_extract(value, '$.destination.platform'), '') != 'local-renderer'
          )
          WHERE retention_rank > ?
          LIMIT ?
        `,
        selectParams: [options.policy.outboxSentRetentionLimit],
        limit: remaining,
        batchSize: options.policy.batchSize,
        onBatch: (count) => {
          deleted.retainedOutbox += count
          options.onProgress?.({ phase: "outbox-retention", deleted: { ...deleted } })
        },
        yieldBetweenBatches,
      })
    }

    if (remaining > 0 && tableExists(database, AGENT_EVENTS_TABLE)) {
      remaining = await deleteInBatches({
        database,
        tableName: AGENT_EVENTS_TABLE,
        selectSql: `
          SELECT id
          FROM ${AGENT_EVENTS_TABLE}
          WHERE json_extract(value, '$.eventType') IN ('sdkEvent', 'streamDiagnostics')
            AND json_extract(value, '$.createdAt') < ?
          LIMIT ?
        `,
        selectParams: [options.policy.rawAgentDiagnosticCutoff],
        limit: remaining,
        batchSize: options.policy.batchSize,
        onBatch: (count) => {
          deleted.rawAgentDiagnostics += count
          options.onProgress?.({ phase: "agent-diagnostics", deleted: { ...deleted } })
        },
        yieldBetweenBatches,
      })
    }

    if (
      remaining > 0
      && tableExists(database, AGENT_EVENTS_TABLE)
      && tableExists(database, CONVERSATIONS_TABLE)
    ) {
      remaining = await deleteInBatches({
        database,
        tableName: AGENT_EVENTS_TABLE,
        selectSql: `
          SELECT events.id
          FROM ${AGENT_EVENTS_TABLE} AS events
          WHERE NOT EXISTS (
            SELECT 1
            FROM ${CONVERSATIONS_TABLE} AS conversations
            WHERE conversations.id = json_extract(events.value, '$.conversationId')
          )
          LIMIT ?
        `,
        selectParams: [],
        limit: remaining,
        batchSize: options.policy.batchSize,
        onBatch: (count) => {
          deleted.orphanAgentEvents += count
          options.onProgress?.({ phase: "agent-orphans", deleted: { ...deleted } })
        },
        yieldBetweenBatches,
      })
    }

    const finishedAtDate = now()
    return {
      status: remaining === 0 ? "partial" : "completed",
      startedAt,
      finishedAt: finishedAtDate.toISOString(),
      durationMs: Math.max(0, finishedAtDate.getTime() - startedAtDate.getTime()),
      databaseBytesBefore,
      databaseBytesAfter: safeFileSize(options.databasePath),
      freePagesBefore,
      freePagesAfter: pragmaNumber(database, "freelist_count"),
      deleted,
    }
  } finally {
    database.close()
  }
}

interface DeleteInBatchesOptions {
  readonly database: DatabaseSync
  readonly tableName: typeof OUTBOX_TABLE | typeof AGENT_EVENTS_TABLE
  readonly selectSql: string
  readonly selectParams: readonly (string | number)[]
  readonly limit: number
  readonly batchSize: number
  readonly onBatch: (deleted: number) => void
  readonly yieldBetweenBatches: () => Promise<void>
}

async function deleteInBatches(options: DeleteInBatchesOptions): Promise<number> {
  const ids = options.database.prepare(options.selectSql).all(
    ...options.selectParams,
    options.limit,
  ) as Array<{ id?: unknown }>
  const validIds = ids
    .map((row) => row.id)
    .filter((id): id is string => typeof id === "string")
  let deleted = 0

  for (let offset = 0; offset < validIds.length; offset += options.batchSize) {
    const batch = validIds.slice(offset, offset + options.batchSize)
    const placeholders = batch.map(() => "?").join(", ")
    const result = options.database.prepare(
      `DELETE FROM ${options.tableName} WHERE id IN (${placeholders})`,
    ).run(...batch)
    const changes = Number(result.changes)
    deleted += changes
    options.onBatch(changes)
    await options.yieldBetweenBatches()
  }

  return options.limit - deleted
}

function tableExists(database: DatabaseSync, tableName: string): boolean {
  const row = database.prepare(
    "SELECT 1 AS found FROM sqlite_master WHERE type = 'table' AND name = ? LIMIT 1",
  ).get(tableName) as { found?: unknown } | undefined
  return row?.found === 1
}

function pragmaNumber(database: DatabaseSync, pragma: "freelist_count"): number {
  const row = database.prepare(`PRAGMA ${pragma}`).get() as Record<string, unknown> | undefined
  const value = row ? Object.values(row)[0] : undefined
  return typeof value === "number" ? value : 0
}

function safeFileSize(filePath: string): number {
  try {
    return statSync(filePath).size
  } catch {
    return 0
  }
}

function validatePolicy(policy: DataMaintenancePolicy): void {
  if (!Number.isSafeInteger(policy.maxDeletions) || policy.maxDeletions < 1) {
    throw new Error("Data maintenance maxDeletions must be a positive safe integer")
  }
  if (!Number.isSafeInteger(policy.batchSize) || policy.batchSize < 1 || policy.batchSize > 500) {
    throw new Error("Data maintenance batchSize must be between 1 and 500")
  }
  if (!Number.isSafeInteger(policy.outboxSentRetentionLimit) || policy.outboxSentRetentionLimit < 0) {
    throw new Error("Data maintenance outbox retention must be a non-negative safe integer")
  }
  if (Number.isNaN(Date.parse(policy.rawAgentDiagnosticCutoff))) {
    throw new Error("Data maintenance raw diagnostic cutoff must be an ISO date")
  }
}

function emptyCounts(): MutableDataMaintenanceCounts {
  return {
    localOutbox: 0,
    retainedOutbox: 0,
    rawAgentDiagnostics: 0,
    orphanAgentEvents: 0,
  }
}

type MutableDataMaintenanceCounts = {
  -readonly [Key in keyof DataMaintenanceCounts]: DataMaintenanceCounts[Key]
}

function yieldToWorkerLoop(): Promise<void> {
  return new Promise((resolve) => setImmediate(resolve))
}
