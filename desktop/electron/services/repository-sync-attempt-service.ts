import type { SynapseRepositorySyncAttemptState } from "../../src/types/repository"
import { withRepositoryCacheDatabase } from "./repository-cache-database"

const EMPTY_SYNC_ATTEMPT_STATE: SynapseRepositorySyncAttemptState = {
  lastAttemptAt: null,
  lastError: null,
  lastErrorCategory: null,
  nextRetryAt: null,
  retryCount: 0,
}

function mapSyncAttemptRow(row: Record<string, unknown> | undefined): SynapseRepositorySyncAttemptState {
  if (!row) {
    return { ...EMPTY_SYNC_ATTEMPT_STATE }
  }

  return {
    lastAttemptAt: typeof row.last_attempt_at === "string" ? row.last_attempt_at : null,
    lastError: typeof row.last_error === "string" ? row.last_error : null,
    lastErrorCategory: typeof row.last_error_category === "string"
      ? row.last_error_category as SynapseRepositorySyncAttemptState["lastErrorCategory"]
      : null,
    nextRetryAt: typeof row.next_retry_at === "string" ? row.next_retry_at : null,
    retryCount: typeof row.retry_count === "number" ? row.retry_count : 0,
  }
}

class RepositorySyncAttemptService {
  async read(repositoryUuid: string): Promise<SynapseRepositorySyncAttemptState> {
    return withRepositoryCacheDatabase(repositoryUuid, (database) => {
      const row = database.prepare(`
        SELECT last_attempt_at, last_error, last_error_category, retry_count, next_retry_at
        FROM repository_sync_attempt
        WHERE singleton_id = 1
      `).get() as Record<string, unknown> | undefined

      return mapSyncAttemptRow(row)
    }, {
      includeRepositorySyncAttempt: true,
    })
  }

  async markAttempt(
    repositoryUuid: string,
    attemptedAt: string,
  ): Promise<SynapseRepositorySyncAttemptState> {
    return withRepositoryCacheDatabase(repositoryUuid, (database) => {
      database.prepare(`
        INSERT INTO repository_sync_attempt (singleton_id, last_attempt_at)
        VALUES (1, ?)
        ON CONFLICT(singleton_id) DO UPDATE SET last_attempt_at = excluded.last_attempt_at
      `).run(attemptedAt)

      const row = database.prepare(`
        SELECT last_attempt_at, last_error, last_error_category, retry_count, next_retry_at
        FROM repository_sync_attempt
        WHERE singleton_id = 1
      `).get() as Record<string, unknown> | undefined

      return mapSyncAttemptRow(row)
    }, {
      includeRepositorySyncAttempt: true,
    })
  }

  async markFailure(
    repositoryUuid: string,
    failure: {
      category: SynapseRepositorySyncAttemptState["lastErrorCategory"]
      lastError: string
      nextRetryAt: string | null
    },
  ): Promise<SynapseRepositorySyncAttemptState> {
    return withRepositoryCacheDatabase(repositoryUuid, (database) => {
      database.prepare(`
        INSERT INTO repository_sync_attempt (
          singleton_id,
          last_error,
          last_error_category,
          retry_count,
          next_retry_at
        ) VALUES (1, ?, ?, 1, ?)
        ON CONFLICT(singleton_id) DO UPDATE SET
          last_error = excluded.last_error,
          last_error_category = excluded.last_error_category,
          retry_count = repository_sync_attempt.retry_count + 1,
          next_retry_at = excluded.next_retry_at
      `).run(failure.lastError, failure.category, failure.nextRetryAt)

      const row = database.prepare(`
        SELECT last_attempt_at, last_error, last_error_category, retry_count, next_retry_at
        FROM repository_sync_attempt
        WHERE singleton_id = 1
      `).get() as Record<string, unknown> | undefined

      return mapSyncAttemptRow(row)
    }, {
      includeRepositorySyncAttempt: true,
    })
  }

  async clear(repositoryUuid: string): Promise<SynapseRepositorySyncAttemptState> {
    return withRepositoryCacheDatabase(repositoryUuid, (database) => {
      database.prepare("DELETE FROM repository_sync_attempt WHERE singleton_id = 1").run()
      return { ...EMPTY_SYNC_ATTEMPT_STATE }
    }, {
      includeRepositorySyncAttempt: true,
    })
  }
}

const repositorySyncAttemptService = new RepositorySyncAttemptService()

export { repositorySyncAttemptService }
