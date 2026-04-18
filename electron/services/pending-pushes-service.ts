import type { SynapseRepositoryConfig } from "../../src/types/config"
import type { SynapsePendingPushEntry, SynapsePendingPushState } from "../../src/types/repository"
import { withRepositoryCacheDatabase } from "./repository-cache-database"

type PendingPushInsertParams = {
  action: string
  commitHash: string | null
  targetId: string
  title: string | null
}

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
  }
}

class PendingPushesService {
  async readState(repository: SynapseRepositoryConfig): Promise<SynapsePendingPushState> {
    return withRepositoryCacheDatabase(repository.uuid, (database) => {
      const rows = database.prepare(`
        SELECT *
        FROM pending_pushes
        ORDER BY created_at ASC, id ASC
      `).all() as Record<string, unknown>[]
      const items = rows
        .map(mapPendingPushRow)
        .filter((item): item is SynapsePendingPushEntry => item !== null)

      return {
        count: items.length,
        items,
      }
    })
  }

  async enqueue(
    repository: SynapseRepositoryConfig,
    params: PendingPushInsertParams,
  ): Promise<SynapsePendingPushState> {
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

      const rows = database.prepare(`
        SELECT *
        FROM pending_pushes
        ORDER BY created_at ASC, id ASC
      `).all() as Record<string, unknown>[]
      const items = rows
        .map(mapPendingPushRow)
        .filter((item): item is SynapsePendingPushEntry => item !== null)

      return {
        count: items.length,
        items,
      }
    })
  }

  async clear(repository: SynapseRepositoryConfig, ids?: number[]): Promise<SynapsePendingPushState> {
    const targetIds = getTargetIds(ids)

    return withRepositoryCacheDatabase(repository.uuid, (database) => {
      if (!targetIds) {
        database.exec("DELETE FROM pending_pushes")
      } else {
        const placeholders = targetIds.map(() => "?").join(", ")

        database.prepare(`
          DELETE FROM pending_pushes
          WHERE id IN (${placeholders})
        `).run(...targetIds)
      }

      const rows = database.prepare(`
        SELECT *
        FROM pending_pushes
        ORDER BY created_at ASC, id ASC
      `).all() as Record<string, unknown>[]
      const items = rows
        .map(mapPendingPushRow)
        .filter((item): item is SynapsePendingPushEntry => item !== null)

      return {
        count: items.length,
        items,
      }
    })
  }

  async markFailure(
    repository: SynapseRepositoryConfig,
    lastError: string,
    ids?: number[],
  ): Promise<SynapsePendingPushState> {
    const targetIds = getTargetIds(ids)

    return withRepositoryCacheDatabase(repository.uuid, (database) => {
      const placeholders = targetIds?.map(() => "?").join(", ")
      const statement = database.prepare(`
        UPDATE pending_pushes
        SET retry_count = retry_count + 1,
            last_error = ?
        ${placeholders ? `WHERE id IN (${placeholders})` : ""}
      `)

      if (targetIds) {
        statement.run(lastError, ...targetIds)
      } else {
        statement.run(lastError)
      }

      const rows = database.prepare(`
        SELECT *
        FROM pending_pushes
        ORDER BY created_at ASC, id ASC
      `).all() as Record<string, unknown>[]
      const items = rows
        .map(mapPendingPushRow)
        .filter((item): item is SynapsePendingPushEntry => item !== null)

      return {
        count: items.length,
        items,
      }
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
}

const pendingPushesService = new PendingPushesService()

export { pendingPushesService }
