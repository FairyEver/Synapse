import { spawn } from "node:child_process"
import type { SynapseRepositoryConfig } from "../../src/types/config"
import type { SynapseContentMeta, SynapseContentType } from "../../src/types/content"
import { contentHistoryService } from "./content-history-service"
import { createMainLogger } from "./log-store"
import { withRepositoryCacheDatabase } from "./repository-cache-database"

const LAST_SYNCED_GIT_SHA_KEY = "last_synced_git_sha"
const logger = createMainLogger("service.content-index")

type ChangedContentKey = {
  contentId: string
  contentType: SynapseContentType
}

function toDatabaseRow(summary: SynapseContentMeta) {
  return {
    attachmentCount: summary.attachmentCount,
    category: summary.category,
    createdAt: summary.createdAt,
    createdBy: summary.createdBy,
    createdByDisplayName: summary.createdByDisplayName,
    deleted: summary.deleted ? 1 : 0,
    description: summary.description,
    icon: summary.icon,
    iconBg: summary.iconBg,
    id: summary.id,
    latestHistoryDirname: summary.latestHistoryDirname,
    modifiedAt: summary.modifiedAt,
    modifiedBy: summary.modifiedBy,
    modifiedByDisplayName: summary.modifiedByDisplayName,
    title: summary.title,
    type: summary.type,
  }
}

function fromDatabaseRow(row: Record<string, unknown>): SynapseContentMeta | null {
  if (
    typeof row.id !== "string"
    || (row.type !== "rule" && row.type !== "skill")
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

function collectChangedContentKeys(diffOutput: string): ChangedContentKey[] {
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

    if ((directoryName !== "rules" && directoryName !== "skills") || !contentId) {
      continue
    }

    const contentType = directoryName === "rules" ? "rule" : "skill"
    map.set(`${contentType}:${contentId}`, {
      contentId,
      contentType,
    })
  }

  return Array.from(map.values())
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
    const allRules = await contentHistoryService.listContent(repository, "rule")
    const allSkills = await contentHistoryService.listContent(repository, "skill")
    const currentHead = await this.readHeadSha(repository)

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

      for (const item of [...allRules, ...allSkills]) {
        const row = toDatabaseRow(item)

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

      const changedContentKeys = collectChangedContentKeys(diffOutput ?? "")

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

        const row = toDatabaseRow(summary)

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
