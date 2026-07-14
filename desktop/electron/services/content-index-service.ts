import type { DatabaseSync } from "node:sqlite"
import { getAllContentTypeIds } from "../../src/config/content-types"
import { resolveDisplayName } from "../../src/lib/display-name"
import { getContentDir } from "../../src/lib/config"
import type { SynapseRepositoryConfig } from "../../src/types/config"
import type { SynapseContentMeta, SynapseContentType } from "../../src/types/content"
import { contentHistoryService } from "./content-history-service"
import { runGitCommand } from "./git-command"
import { createMainLogger } from "./log-store"
import { withRepositoryCacheDatabase } from "./repository-cache-database"
import { userProfileService } from "./user-profile-service"

const LAST_SYNCED_GIT_SHA_KEY = "last_synced_git_sha"
const CONTENT_INDEX_GIT_TIMEOUT_MS = 30_000
const logger = createMainLogger("service.content-index")

type ChangedContentKey = {
  contentId: string
  contentType: SynapseContentType
}

type ContentIndexWriteRow = ReturnType<typeof toDatabaseRow>

async function runRepositoryCacheWriteTransaction<T>(
  database: DatabaseSync,
  callback: () => Promise<T> | T,
): Promise<T> {
  database.exec("BEGIN IMMEDIATE")
  try {
    const result = await callback()
    database.exec("COMMIT")
    return result
  } catch (error) {
    database.exec("ROLLBACK")
    throw error
  }
}

function toDatabaseRow(
  summary: SynapseContentMeta,
  profileMap: Awaited<ReturnType<typeof userProfileService.listRepoProfiles>>,
) {
  return {
    attachmentCount: summary.attachmentCount,
    hasEnv: summary.hasEnv === true ? 1 : 0,
    category: summary.category,
    createdAt: summary.createdAt,
    createdBy: summary.createdBy,
    createdByDisplayName: resolveDisplayName(
      summary.createdBy,
      profileMap,
      summary.createdByDisplayName,
    ),
    deleted: summary.deleted ? 1 : 0,
    description: summary.description,
    usage: summary.usage ?? null,
    icon: summary.icon,
    iconBg: summary.iconBg,
    iconType: summary.iconType ?? "icon",
    iconImage: summary.iconImage ?? null,
    id: summary.id,
    latestHistoryDirname: summary.latestHistoryDirname,
    modifiedAt: summary.modifiedAt,
    modifiedBy: summary.modifiedBy,
    modifiedByDisplayName: resolveDisplayName(
      summary.modifiedBy,
      profileMap,
      summary.modifiedByDisplayName,
    ),
    name: summary.name ?? null,
    title: summary.title,
    type: summary.type,
  }
}

function fromDatabaseRow(row: Record<string, unknown>): SynapseContentMeta | null {
  const contentTypeIds = getAllContentTypeIds()

  if (
    typeof row.id !== "string"
    || typeof row.type !== "string"
    || !contentTypeIds.includes(row.type as SynapseContentType)
    || typeof row.title !== "string"
    || typeof row.description !== "string"
    || typeof row.category !== "string"
    || typeof row.icon !== "string"
    || typeof row.icon_bg !== "string"
    || typeof row.created_by !== "string"
    || typeof row.created_at !== "string"
    || typeof row.modified_by !== "string"
    || typeof row.modified_at !== "string"
    || typeof row.latest_history_dirname !== "string"
  ) {
    return null
  }

  const rawName = row.name
  const trimmedName = typeof rawName === "string" ? rawName.trim() : ""
  const rawUsage = row.usage

  return {
    id: row.id,
    type: row.type,
    title: row.title,
    ...(trimmedName.length > 0 ? { name: trimmedName } : {}),
    description: row.description,
    ...(typeof rawUsage === "string" && rawUsage.length > 0 ? { usage: rawUsage } : {}),
    category: row.category,
    icon: row.icon,
    iconBg: row.icon_bg,
    iconType: typeof row.icon_type === "string" ? row.icon_type : "icon",
    iconImage: typeof row.icon_image === "string" ? row.icon_image : undefined,
    createdBy: row.created_by,
    createdByDisplayName: typeof row.created_by_name === "string" ? row.created_by_name : "",
    createdAt: row.created_at,
    modifiedBy: row.modified_by,
    modifiedByDisplayName: typeof row.modified_by_name === "string" ? row.modified_by_name : "",
    modifiedAt: row.modified_at,
    deleted: row.deleted === 1,
    latestHistoryDirname: row.latest_history_dirname,
    attachmentCount: typeof row.attachment_count === "number" ? row.attachment_count : 0,
    hasEnv: row.has_env === 1,
    source: "repository",
    isReadonly: false,
  } as SynapseContentMeta
}

function runGitText(
  cwd: string,
  args: string[],
  timeoutMs = CONTENT_INDEX_GIT_TIMEOUT_MS,
): Promise<string | null> {
  return runGitCommand({
    args,
    cwd,
    fallbackMessage: "Git 命令执行失败。",
    timeoutMessage: "内容索引 Git 命令超时。",
    timeoutMs,
  }).then((result) => result.stdout.trim() || null)
}

function collectChangedContentKeys(
  repository: SynapseRepositoryConfig,
  diffOutput: string,
): ChangedContentKey[] {
  const map = new Map<string, ChangedContentKey>()

  for (const line of diffOutput.split(/\r?\n/)) {
    const normalizedLine = line.trim()

    if (!normalizedLine) {
      continue
    }

    const segments = normalizedLine.split("/")

    if (segments.length < 2) {
      continue
    }

    const directoryName = segments[0]
    const contentId = segments[1]

    if (!contentId) {
      continue
    }

    const contentType = resolveContentTypeByDirectoryName(repository, directoryName)

    if (!contentType) {
      continue
    }

    map.set(`${contentType}:${contentId}`, {
      contentId,
      contentType,
    })
  }

  return Array.from(map.values())
}

function hasUserProfileChanges(diffOutput: string): boolean {
  return diffOutput
    .split(/\r?\n/)
    .some((line) => line.trim().startsWith("users/"))
}

function resolveContentTypeByDirectoryName(
  repository: SynapseRepositoryConfig,
  directoryName: string,
): SynapseContentType | null {
  for (const contentType of getAllContentTypeIds()) {
    if (getContentDir(repository, contentType) === directoryName) {
      return contentType
    }
  }

  return null
}

class ContentIndexService {
  async listContent(
    repository: SynapseRepositoryConfig,
    contentType: SynapseContentType,
  ): Promise<SynapseContentMeta[]> {
    return withRepositoryCacheDatabase(repository.uuid, (database) => {
      const rows = database.prepare(`
        SELECT *
        FROM content_index
        WHERE type = ? AND deleted = 0
        ORDER BY modified_at DESC
      `).all(contentType) as Record<string, unknown>[]

      return rows
        .map(fromDatabaseRow)
        .filter((item): item is SynapseContentMeta => item !== null)
    })
  }

  async listDeletedContent(
    repository: SynapseRepositoryConfig,
    contentType: SynapseContentType,
  ): Promise<SynapseContentMeta[]> {
    return withRepositoryCacheDatabase(repository.uuid, (database) => {
      const rows = database.prepare(`
        SELECT *
        FROM content_index
        WHERE type = ? AND deleted = 1
        ORDER BY modified_at DESC
      `).all(contentType) as Record<string, unknown>[]

      return rows
        .map(fromDatabaseRow)
        .filter((item): item is SynapseContentMeta => item !== null)
    })
  }

  async readSummary(
    repository: SynapseRepositoryConfig,
    contentType: SynapseContentType,
    contentId: string,
  ): Promise<SynapseContentMeta | null> {
    return withRepositoryCacheDatabase(repository.uuid, (database) => {
      const row = database.prepare(`
        SELECT *
        FROM content_index
        WHERE id = ? AND type = ?
        LIMIT 1
      `).get(contentId, contentType) as Record<string, unknown> | undefined

      return row ? fromDatabaseRow(row) : null
    })
  }

  async rebuildIndex(repository: SynapseRepositoryConfig): Promise<void> {
    const tRebuild = Date.now()
    logger.info("rebuildIndex: starting.", { repositoryUuid: repository.uuid })
    const allContent = await Promise.all(
      getAllContentTypeIds().map((contentType) => contentHistoryService.listContent(repository, contentType)),
    )
    const totalItems = allContent.reduce((sum, items) => sum + items.length, 0)
    logger.info("rebuildIndex: listContent done.", { totalItems, durationMs: Date.now() - tRebuild, repositoryUuid: repository.uuid })
    const currentHead = await this.readHeadSha(repository)
    const profileMap = await userProfileService.listRepoProfiles(repository.uuid)

    await withRepositoryCacheDatabase(repository.uuid, (database) => runRepositoryCacheWriteTransaction(database, () => {
      database.exec("DELETE FROM content_index")
      const upsertStatement = database.prepare(`
        INSERT INTO content_index (
          id, type, title, name, description, usage, category, icon, icon_bg,
          icon_type, icon_image,
          modified_by, modified_by_name, modified_at, created_by, created_by_name,
          created_at, deleted, latest_history_dirname, attachment_count, has_env
        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
        ON CONFLICT(id) DO UPDATE SET
          type = excluded.type,
          title = excluded.title,
          name = excluded.name,
          description = excluded.description,
          usage = excluded.usage,
          category = excluded.category,
          icon = excluded.icon,
          icon_bg = excluded.icon_bg,
          icon_type = excluded.icon_type,
          icon_image = excluded.icon_image,
          modified_by = excluded.modified_by,
          modified_by_name = excluded.modified_by_name,
          modified_at = excluded.modified_at,
          created_by = excluded.created_by,
          created_by_name = excluded.created_by_name,
          created_at = excluded.created_at,
          deleted = excluded.deleted,
          latest_history_dirname = excluded.latest_history_dirname,
          attachment_count = excluded.attachment_count,
          has_env = excluded.has_env
      `)

      for (const item of allContent.flat()) {
        const row = toDatabaseRow(item, profileMap)

        upsertStatement.run(
          row.id,
          row.type,
          row.title,
          row.name,
          row.description,
          row.usage,
          row.category,
          row.icon,
          row.iconBg,
          row.iconType,
          row.iconImage,
          row.modifiedBy,
          row.modifiedByDisplayName,
          row.modifiedAt,
          row.createdBy,
          row.createdByDisplayName,
          row.createdAt,
          row.deleted,
          row.latestHistoryDirname,
          row.attachmentCount,
          row.hasEnv,
        )
      }

      database.prepare(`
        INSERT INTO index_meta (key, value)
        VALUES (?, ?)
        ON CONFLICT(key) DO UPDATE SET value = excluded.value
      `).run(LAST_SYNCED_GIT_SHA_KEY, currentHead ?? "")
    }))
    logger.info("rebuildIndex: complete.", { totalItems, durationMs: Date.now() - tRebuild, repositoryUuid: repository.uuid })
  }

  async clearIndex(repository: SynapseRepositoryConfig): Promise<void> {
    await withRepositoryCacheDatabase(repository.uuid, (database) => {
      database.exec(`
        DELETE FROM content_index;
        DELETE FROM index_meta;
      `)
    })
  }

  async syncIndex(repository: SynapseRepositoryConfig): Promise<void> {
    const tSync = Date.now()
    logger.info("syncIndex: starting.", { repositoryUuid: repository.uuid })
    const currentHead = await this.readHeadSha(repository)
    logger.info("syncIndex: readHeadSha done.", { currentHead, durationMs: Date.now() - tSync, repositoryUuid: repository.uuid })
    let shouldRebuild = false

    await withRepositoryCacheDatabase(repository.uuid, async (database) => {
      const lastSyncedRow = database.prepare(`
        SELECT value
        FROM index_meta
        WHERE key = ?
      `).get(LAST_SYNCED_GIT_SHA_KEY) as { value?: string } | undefined
      const lastSyncedGitSha = lastSyncedRow?.value?.trim() ?? ""

      if (!currentHead || !lastSyncedGitSha) {
        logger.info("syncIndex: no HEAD or lastSynced, will rebuild.", { currentHead, lastSyncedGitSha, repositoryUuid: repository.uuid })
        shouldRebuild = true
        return
      }

      if (currentHead === lastSyncedGitSha) {
        logger.info("syncIndex: HEAD unchanged, skipping.", { currentHead, repositoryUuid: repository.uuid })
        return
      }

      let diffOutput: string | null = null

      const tDiff = Date.now()
      logger.info("syncIndex: running git diff.", { from: lastSyncedGitSha, to: currentHead, repositoryUuid: repository.uuid })
      try {
        diffOutput = await runGitText(repository.localPath, [
          "diff",
          "--name-only",
          lastSyncedGitSha,
          currentHead,
        ])
        logger.info("syncIndex: git diff done.", { durationMs: Date.now() - tDiff, repositoryUuid: repository.uuid })
      } catch (error) {
        logger.warn("Failed to diff Git changes for content index. Falling back to rebuild.", {
          error,
          repositoryUuid: repository.uuid,
        })
        shouldRebuild = true
        return
      }

      if (hasUserProfileChanges(diffOutput ?? "")) {
        shouldRebuild = true
        return
      }

      const changedContentKeys = collectChangedContentKeys(repository, diffOutput ?? "")
      logger.info("syncIndex: changed content keys.", { count: changedContentKeys.length, repositoryUuid: repository.uuid })
      const profileMap = await userProfileService.listRepoProfiles(repository.uuid)

      if (changedContentKeys.length === 0) {
        await runRepositoryCacheWriteTransaction(database, () => {
          database.prepare(`
            INSERT INTO index_meta (key, value)
            VALUES (?, ?)
            ON CONFLICT(key) DO UPDATE SET value = excluded.value
          `).run(LAST_SYNCED_GIT_SHA_KEY, currentHead)
        })
        return
      }

      const changedRows: Array<{
        changedContent: ChangedContentKey
        row: ContentIndexWriteRow | null
      }> = []
      for (const changedContent of changedContentKeys) {
        let summary: SynapseContentMeta | null
        try {
          summary = await contentHistoryService.readCurrentSummary(
            repository,
            changedContent.contentType,
            changedContent.contentId,
          )
        } catch (error) {
          logger.warn("Failed to read changed content summary for content index. Falling back to rebuild.", {
            contentId: changedContent.contentId,
            contentType: changedContent.contentType,
            error,
            repositoryUuid: repository.uuid,
          })
          shouldRebuild = true
          return
        }

        if (!summary) {
          changedRows.push({ changedContent, row: null })
          continue
        }

        changedRows.push({ changedContent, row: toDatabaseRow(summary, profileMap) })
      }

      await runRepositoryCacheWriteTransaction(database, () => {
        const upsertStatement = database.prepare(`
          INSERT INTO content_index (
            id, type, title, name, description, usage, category, icon, icon_bg,
            icon_type, icon_image,
            modified_by, modified_by_name, modified_at, created_by, created_by_name,
            created_at, deleted, latest_history_dirname, attachment_count, has_env
          ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
          ON CONFLICT(id) DO UPDATE SET
            type = excluded.type,
            title = excluded.title,
            name = excluded.name,
            description = excluded.description,
            usage = excluded.usage,
            category = excluded.category,
            icon = excluded.icon,
            icon_bg = excluded.icon_bg,
            icon_type = excluded.icon_type,
            icon_image = excluded.icon_image,
            modified_by = excluded.modified_by,
            modified_by_name = excluded.modified_by_name,
            modified_at = excluded.modified_at,
            created_by = excluded.created_by,
            created_by_name = excluded.created_by_name,
            created_at = excluded.created_at,
            deleted = excluded.deleted,
            latest_history_dirname = excluded.latest_history_dirname,
            attachment_count = excluded.attachment_count,
            has_env = excluded.has_env
        `)
        const deleteStatement = database.prepare(`
          DELETE FROM content_index
          WHERE id = ? AND type = ?
        `)

        for (const { changedContent, row } of changedRows) {
          if (!row) {
            deleteStatement.run(changedContent.contentId, changedContent.contentType)
            continue
          }

          upsertStatement.run(
            row.id,
            row.type,
            row.title,
            row.name,
            row.description,
            row.usage,
            row.category,
            row.icon,
            row.iconBg,
            row.iconType,
            row.iconImage,
            row.modifiedBy,
            row.modifiedByDisplayName,
            row.modifiedAt,
            row.createdBy,
            row.createdByDisplayName,
            row.createdAt,
            row.deleted,
            row.latestHistoryDirname,
            row.attachmentCount,
            row.hasEnv,
          )
        }

        database.prepare(`
          INSERT INTO index_meta (key, value)
          VALUES (?, ?)
          ON CONFLICT(key) DO UPDATE SET value = excluded.value
        `).run(LAST_SYNCED_GIT_SHA_KEY, currentHead)
      })
    })

    if (shouldRebuild) {
      await this.rebuildIndex(repository)
    } else {
      logger.info("syncIndex: complete.", { durationMs: Date.now() - tSync, repositoryUuid: repository.uuid })
    }
  }

  private async readHeadSha(repository: SynapseRepositoryConfig): Promise<string | null> {
    try {
      return await runGitText(repository.localPath, ["rev-parse", "HEAD"])
    } catch (error) {
      logger.warn("Failed to read repository HEAD for content index.", {
        error,
        repositoryUuid: repository.uuid,
      })
      return null
    }
  }
}

const contentIndexService = new ContentIndexService()

export {
  contentIndexService,
  fromDatabaseRow as _fromDatabaseRowForTests,
  runGitText as _runGitTextForTests,
  runRepositoryCacheWriteTransaction as _runRepositoryCacheWriteTransactionForTests,
  toDatabaseRow as _toDatabaseRowForTests,
}
