import type { DatabaseSync } from "node:sqlite"
import type { SynapseRepositoryConfig } from "../../src/types/config"
import type { SynapsePendingPushEntry, SynapsePendingPushState } from "../../src/types/repository"
import { withRepositoryCacheDatabase } from "./repository-cache-database"
import { repositoryStore } from "./repository-store"
import { createMainLogger } from "./log-store"

const logger = createMainLogger("service.pending-pushes")

type PendingPushInsertParams = {
  action: string
  commitHash: string | null
  targetId: string
  title: string | null
}
type PendingPushReadOptions = {
  readonly limit?: number | null
}

const DEFAULT_PENDING_PUSH_ITEM_LIMIT = 100

function getTargetIds(ids?: number[]): number[] | null {
  if (!ids || ids.length === 0) {
    return null
  }

  return Array.from(new Set(ids.filter((id) => Number.isInteger(id) && id > 0)))
}

function mapPendingPushRow(row: Record<string, unknown>): SynapsePendingPushEntry | null {
  if (
    typeof row.id !== "number"
    || typeof row.action !== "string"
    || typeof row.target_id !== "string"
    || typeof row.created_at !== "string"
    || typeof row.retry_count !== "number"
  ) {
    return null
  }

  return {
    id: row.id,
    commitHash: typeof row.commit_hash === "string" ? row.commit_hash : null,
    action: row.action,
    targetId: row.target_id,
    title: typeof row.title === "string" ? row.title : null,
    createdAt: row.created_at,
    retryCount: row.retry_count,
    lastError: typeof row.last_error === "string" ? row.last_error : null,
    lastAttemptAt: typeof row.last_attempt_at === "string" ? row.last_attempt_at : null,
    nextRetryAt: typeof row.next_retry_at === "string" ? row.next_retry_at : null,
    lastErrorCategory: typeof row.last_error_category === "string"
      ? row.last_error_category as SynapsePendingPushEntry["lastErrorCategory"]
      : null,
  }
}

class PendingPushesService {
  private async canUsePendingPushes(repository: SynapseRepositoryConfig): Promise<boolean> {
    const t = Date.now()
    logger.info("canUsePendingPushes: calling getRepositoryState.", { repositoryUuid: repository.uuid })
    const repositoryState = await repositoryStore.getRepositoryState(repository)
    logger.info("canUsePendingPushes: getRepositoryState done.", { durationMs: Date.now() - t, status: repositoryState.status, isGitRepository: repositoryState.isGitRepository, repositoryUuid: repository.uuid })

    return repositoryState.status === "ready" && repositoryState.isGitRepository
  }

  async readState(
    repository: SynapseRepositoryConfig,
    options: PendingPushReadOptions = {},
  ): Promise<SynapsePendingPushState> {
    const t = Date.now()
    logger.info("readState: starting.", { repositoryUuid: repository.uuid })
    if (!(await this.canUsePendingPushes(repository))) {
      logger.info("readState: skipped (cannotUsePendingPushes).", { repositoryUuid: repository.uuid })
      return {
        count: 0,
        items: [],
      }
    }

    const result = await withRepositoryCacheDatabase(repository.uuid, (database) => {
      return this.readStateRows(database, options)
    }, {
      includePendingPushes: true,
    })
    logger.info("readState: done.", { durationMs: Date.now() - t, count: result.count, repositoryUuid: repository.uuid })
    return result
  }

  async enqueue(
    repository: SynapseRepositoryConfig,
    params: PendingPushInsertParams,
  ): Promise<SynapsePendingPushState> {
    if (!(await this.canUsePendingPushes(repository))) {
      return {
        count: 0,
        items: [],
      }
    }

    return withRepositoryCacheDatabase(repository.uuid, (database) => {
      database.prepare(`
        INSERT INTO pending_pushes (
          commit_hash,
          action,
          target_id,
          title,
          created_at,
          retry_count,
          last_error
        ) VALUES (?, ?, ?, ?, ?, 0, NULL)
      `).run(
        params.commitHash,
        params.action,
        params.targetId,
        params.title,
        new Date().toISOString(),
      )

      return this.readStateRows(database)
    }, {
      includePendingPushes: true,
    })
  }

  async clear(repository: SynapseRepositoryConfig, ids?: number[]): Promise<SynapsePendingPushState> {
    const targetIds = getTargetIds(ids)

    if (!(await this.canUsePendingPushes(repository))) {
      return {
        count: 0,
        items: [],
      }
    }

    return withRepositoryCacheDatabase(repository.uuid, (database) => {
      if (targetIds && targetIds.length === 0) {
        return this.readStateRows(database)
      }

      if (!targetIds) {
        database.exec("DELETE FROM pending_pushes")
      } else {
        const placeholders = targetIds.map(() => "?").join(", ")

        database.prepare(`
          DELETE FROM pending_pushes
          WHERE id IN (${placeholders})
        `).run(...targetIds)
      }

      return this.readStateRows(database)
    }, {
      includePendingPushes: true,
    })
  }

  async markAttempt(
    repository: SynapseRepositoryConfig,
    attemptedAt: string,
    ids?: number[],
  ): Promise<SynapsePendingPushState> {
    const targetIds = getTargetIds(ids)

    if (!(await this.canUsePendingPushes(repository))) {
      return {
        count: 0,
        items: [],
      }
    }

    return withRepositoryCacheDatabase(repository.uuid, (database) => {
      if (targetIds && targetIds.length === 0) {
        return this.readStateRows(database)
      }

      const placeholders = targetIds?.map(() => "?").join(", ")
      const statement = database.prepare(`
        UPDATE pending_pushes
        SET last_attempt_at = ?
        ${placeholders ? `WHERE id IN (${placeholders})` : ""}
      `)

      if (targetIds) {
        statement.run(attemptedAt, ...targetIds)
      } else {
        statement.run(attemptedAt)
      }

      return this.readStateRows(database)
    }, {
      includePendingPushes: true,
    })
  }

  async markFailure(
    repository: SynapseRepositoryConfig,
    lastError: string,
    ids?: number[],
    metadata: {
      category?: SynapsePendingPushEntry["lastErrorCategory"]
      nextRetryAt?: string | null
    } = {},
  ): Promise<SynapsePendingPushState> {
    const targetIds = getTargetIds(ids)

    if (!(await this.canUsePendingPushes(repository))) {
      return {
        count: 0,
        items: [],
      }
    }

    return withRepositoryCacheDatabase(repository.uuid, (database) => {
      if (targetIds && targetIds.length === 0) {
        return this.readStateRows(database)
      }

      const placeholders = targetIds?.map(() => "?").join(", ")
      const statement = database.prepare(`
        UPDATE pending_pushes
        SET retry_count = retry_count + 1,
            last_error = ?,
            last_error_category = ?,
            next_retry_at = ?
        ${placeholders ? `WHERE id IN (${placeholders})` : ""}
      `)

      if (targetIds) {
        statement.run(lastError, metadata.category ?? null, metadata.nextRetryAt ?? null, ...targetIds)
      } else {
        statement.run(lastError, metadata.category ?? null, metadata.nextRetryAt ?? null)
      }

      return this.readStateRows(database)
    }, {
      includePendingPushes: true,
    })
  }

  async countAll(repositories: SynapseRepositoryConfig[]): Promise<number> {
    let totalCount = 0

    for (const repository of repositories) {
      const pendingState = await this.readState(repository)

      totalCount += pendingState.count
    }

    return totalCount
  }

  private readStateRows(database: DatabaseSync, options: PendingPushReadOptions = {}): SynapsePendingPushState {
    const countRow = database.prepare("SELECT COUNT(*) AS count FROM pending_pushes").get() as { count?: unknown } | undefined
    const count = typeof countRow?.count === "number" ? countRow.count : 0
    const limit = options.limit === null ? null : Math.max(1, options.limit ?? DEFAULT_PENDING_PUSH_ITEM_LIMIT)
    const rows = database.prepare(`
      SELECT *
      FROM pending_pushes
      ORDER BY created_at ASC, id ASC
      ${limit === null ? "" : "LIMIT ?"}
    `).all(...(limit === null ? [] : [limit])) as Record<string, unknown>[]
    const items = rows
      .map(mapPendingPushRow)
      .filter((item): item is SynapsePendingPushEntry => item !== null)
    const firstErrorItem = this.readFirstErrorItem(database)
    const summary = this.readSummary(database)

    return {
      count,
      items,
      itemsTruncated: items.length < count,
      firstErrorItem,
      lastAttemptAt: summary.lastAttemptAt,
      nextRetryAt: summary.nextRetryAt,
      retryCount: summary.retryCount,
    }
  }

  private readFirstErrorItem(database: DatabaseSync): SynapsePendingPushEntry | null {
    const row = database.prepare(`
      SELECT *
      FROM pending_pushes
      WHERE last_error IS NOT NULL OR last_error_category IS NOT NULL
      ORDER BY created_at ASC, id ASC
      LIMIT 1
    `).get() as Record<string, unknown> | undefined

    return row ? mapPendingPushRow(row) : null
  }

  private readSummary(database: DatabaseSync): {
    readonly lastAttemptAt: string | null
    readonly nextRetryAt: string | null
    readonly retryCount: number
  } {
    const row = database.prepare(`
      SELECT
        COALESCE(SUM(retry_count), 0) AS retry_count,
        MIN(next_retry_at) AS next_retry_at,
        MAX(last_attempt_at) AS last_attempt_at
      FROM pending_pushes
    `).get() as Record<string, unknown> | undefined

    return {
      retryCount: typeof row?.retry_count === "number" ? row.retry_count : 0,
      nextRetryAt: typeof row?.next_retry_at === "string" ? row.next_retry_at : null,
      lastAttemptAt: typeof row?.last_attempt_at === "string" ? row.last_attempt_at : null,
    }
  }
}

const pendingPushesService = new PendingPushesService()

export { pendingPushesService }
