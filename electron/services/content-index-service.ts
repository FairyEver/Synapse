import { spawn } from "node:child_process"
import { getAllContentTypeIds } from "../../src/config/content-types"
import { resolveDisplayName } from "../../src/lib/display-name"
import { getContentDir } from "../../src/lib/config"
import type { SynapseRepositoryConfig } from "../../src/types/config"
import type { SynapseContentMeta, SynapseContentType } from "../../src/types/content"
import { contentHistoryService } from "./content-history-service"
import { createMainLogger } from "./log-store"
import { withRepositoryCacheDatabase } from "./repository-cache-database"
import { userProfileService } from "./user-profile-service"

const LAST_SYNCED_GIT_SHA_KEY = "last_synced_git_sha"
const logger = createMainLogger("service.content-index")

type ChangedContentKey = {
  contentId: string
  contentType: SynapseContentType
}

function toDatabaseRow(
  summary: SynapseContentMeta,
  profileMap: Awaited<ReturnType<typeof userProfileService.listRepoProfiles>>,
) {
  return {
    attachmentCount: summary.attachmentCount,
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
    icon: summary.icon,
    iconBg: summary.iconBg,
    id: summary.id,
    latestHistoryDirname: summary.latestHistoryDirname,
    modifiedAt: summary.modifiedAt,
    modifiedBy: summary.modifiedBy,
    modifiedByDisplayName: resolveDisplayName(
      summary.modifiedBy,
      profileMap,
      summary.modifiedByDisplayName,
    ),
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

  return {
    id: row.id,
    type: row.type,
    title: row.title,
    description: row.description,
    category: row.category,
    icon: row.icon,
    iconBg: row.icon_bg,
    createdBy: row.created_by,
    createdByDisplayName: typeof row.created_by_name === "string" ? row.created_by_name : "",
    createdAt: row.created_at,
    modifiedBy: row.modified_by,
    modifiedByDisplayName: typeof row.modified_by_name === "string" ? row.modified_by_name : "",
    modifiedAt: row.modified_at,
    deleted: row.deleted === 1,
    latestHistoryDirname: row.latest_history_dirname,
    attachmentCount: typeof row.attachment_count === "number" ? row.attachment_count : 0,
  } as SynapseContentMeta
}

function runGitText(cwd: string, args: string[]): Promise<string | null> {
  return new Promise((resolve, reject) => {
    const childProcess = spawn("git", args, {
      cwd,
      env: {
        ...process.env,
        GIT_TERMINAL_PROMPT: "0",
        LANG: "C",
        LC_ALL: "C",
      },
    })

    let stdout = ""
    let stderr = ""

    childProcess.stdout.on("data", (chunk: Buffer) => {
      stdout += chunk.toString("utf8")
    })

    childProcess.stderr.on("data", (chunk: Buffer) => {
      stderr += chunk.toString("utf8")
    })

    childProcess.on("error", reject)

    childProcess.on("close", (code) => {
      if (code === 0) {
        resolve(stdout.trim() || null)
        return
      }

      reject(new Error(stderr.trim() || stdout.trim() || "Git 命令执行失败。"))
    })
  })
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
    const allContent = await Promise.all(
      getAllContentTypeIds().map((contentType) => contentHistoryService.listContent(repository, contentType)),
    )
    const currentHead = await this.readHeadSha(repository)
    const profileMap = await userProfileService.listRepoProfiles(repository.uuid)

    await withRepositoryCacheDatabase(repository.uuid, (database) => {
      database.exec("DELETE FROM content_index")
      const upsertStatement = database.prepare(`
        INSERT INTO content_index (
          id, type, title, description, category, icon, icon_bg,
          modified_by, modified_by_name, modified_at, created_by, created_by_name,
          created_at, deleted, latest_history_dirname, attachment_count
        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
        ON CONFLICT(id) DO UPDATE SET
          type = excluded.type,
          title = excluded.title,
          description = excluded.description,
          category = excluded.category,
          icon = excluded.icon,
          icon_bg = excluded.icon_bg,
          modified_by = excluded.modified_by,
          modified_by_name = excluded.modified_by_name,
          modified_at = excluded.modified_at,
          created_by = excluded.created_by,
          created_by_name = excluded.created_by_name,
          created_at = excluded.created_at,
          deleted = excluded.deleted,
          latest_history_dirname = excluded.latest_history_dirname,
          attachment_count = excluded.attachment_count
      `)

      for (const item of allContent.flat()) {
        const row = toDatabaseRow(item, profileMap)

        upsertStatement.run(
          row.id,
          row.type,
          row.title,
          row.description,
          row.category,
          row.icon,
          row.iconBg,
          row.modifiedBy,
          row.modifiedByDisplayName,
          row.modifiedAt,
          row.createdBy,
          row.createdByDisplayName,
          row.createdAt,
          row.deleted,
          row.latestHistoryDirname,
          row.attachmentCount,
        )
      }

      database.prepare(`
        INSERT INTO index_meta (key, value)
        VALUES (?, ?)
        ON CONFLICT(key) DO UPDATE SET value = excluded.value
      `).run(LAST_SYNCED_GIT_SHA_KEY, currentHead ?? "")
    })
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
    const currentHead = await this.readHeadSha(repository)
    let shouldRebuild = false

    await withRepositoryCacheDatabase(repository.uuid, async (database) => {
      const lastSyncedRow = database.prepare(`
        SELECT value
        FROM index_meta
        WHERE key = ?
      `).get(LAST_SYNCED_GIT_SHA_KEY) as { value?: string } | undefined
      const lastSyncedGitSha = lastSyncedRow?.value?.trim() ?? ""

      if (!currentHead || !lastSyncedGitSha) {
        shouldRebuild = true
        return
      }

      if (currentHead === lastSyncedGitSha) {
        return
      }

      let diffOutput: string | null = null

      try {
        diffOutput = await runGitText(repository.localPath, [
          "diff",
          "--name-only",
          lastSyncedGitSha,
          currentHead,
        ])
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
      const profileMap = await userProfileService.listRepoProfiles(repository.uuid)

      if (changedContentKeys.length === 0) {
        database.prepare(`
          INSERT INTO index_meta (key, value)
          VALUES (?, ?)
          ON CONFLICT(key) DO UPDATE SET value = excluded.value
        `).run(LAST_SYNCED_GIT_SHA_KEY, currentHead)
        return
      }

      const upsertStatement = database.prepare(`
        INSERT INTO content_index (
          id, type, title, description, category, icon, icon_bg,
          modified_by, modified_by_name, modified_at, created_by, created_by_name,
          created_at, deleted, latest_history_dirname, attachment_count
        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
        ON CONFLICT(id) DO UPDATE SET
          type = excluded.type,
          title = excluded.title,
          description = excluded.description,
          category = excluded.category,
          icon = excluded.icon,
          icon_bg = excluded.icon_bg,
          modified_by = excluded.modified_by,
          modified_by_name = excluded.modified_by_name,
          modified_at = excluded.modified_at,
          created_by = excluded.created_by,
          created_by_name = excluded.created_by_name,
          created_at = excluded.created_at,
          deleted = excluded.deleted,
          latest_history_dirname = excluded.latest_history_dirname,
          attachment_count = excluded.attachment_count
      `)
      const deleteStatement = database.prepare(`
        DELETE FROM content_index
        WHERE id = ? AND type = ?
      `)

      for (const changedContent of changedContentKeys) {
        const summary = await contentHistoryService.readCurrentSummary(
          repository,
          changedContent.contentType,
          changedContent.contentId,
        )

        if (!summary) {
          deleteStatement.run(changedContent.contentId, changedContent.contentType)
          continue
        }

        const row = toDatabaseRow(summary, profileMap)

        upsertStatement.run(
          row.id,
          row.type,
          row.title,
          row.description,
          row.category,
          row.icon,
          row.iconBg,
          row.modifiedBy,
          row.modifiedByDisplayName,
          row.modifiedAt,
          row.createdBy,
          row.createdByDisplayName,
          row.createdAt,
          row.deleted,
          row.latestHistoryDirname,
          row.attachmentCount,
        )
      }

      database.prepare(`
        INSERT INTO index_meta (key, value)
        VALUES (?, ?)
        ON CONFLICT(key) DO UPDATE SET value = excluded.value
      `).run(LAST_SYNCED_GIT_SHA_KEY, currentHead)
    })

    if (shouldRebuild) {
      await this.rebuildIndex(repository)
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

export { contentIndexService }
