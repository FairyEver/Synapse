import { access, copyFile, mkdir, readFile, readdir, rm, stat, writeFile } from "node:fs/promises"
import type { Dirent } from "node:fs"
import path from "node:path"
import { isFileNotFoundError, pathExists } from "./fs-utils"
import type { SynapseRepositoryConfig } from "../../src/types/config"
import type {
  SynapseContentAttachmentRecord,
  SynapseContentAttachmentsRecord,
  SynapseContentSnapshotRecord,
  SynapseContentType,
} from "../../src/types/content"
import { contentIndexService } from "./content-index-service"
import {
  CONTENT_ATTACHMENTS_FILE_NAME,
  CONTENT_MAIN_FILE_NAME,
  HISTORY_DIRECTORY_NAME,
  resolveContentDirectoryPath,
  resolveContentRootPath,
} from "./content-history-service"
import { createMainLogger } from "./log-store"
import { formatGitFailureMessage, isNonFastForwardError } from "./git-error-utils"
import { pendingPushesService } from "./pending-pushes-service"
import { runGitCommand, type GitCommandResult } from "./git-command"
import { withRepositoryCacheDatabase } from "./repository-cache-database"
import {
  commitRepositoryPaths,
  pullRepositoryWithSafeRebase,
  runRepositoryGitExclusive,
} from "./repository-git-mutation-service"
import type { SynapseRepositoryLocalState } from "../../src/types/repository"

const ZERO_USER_ID = "00000000000000000000000000000000"
const BLOBS_DIRECTORY_PATH = path.join("system", "blobs")
const LAST_MAINTENANCE_AT_KEY = "last_maintenance_at"
const MANUAL_MAINTENANCE_INTERVAL_MS = 24 * 60 * 60 * 1000
const COMPACTION_TRIGGER_THRESHOLD = 20
const COMPACTION_SKIP_THRESHOLD = 10
const COMPACTION_KEEP_RECENT = 5
const SOFT_DELETE_RETENTION_MS = 90 * 24 * 60 * 60 * 1000
const ATTACHMENT_GC_WINDOW_MS = 24 * 60 * 60 * 1000
const logger = createMainLogger("service.repository-maintenance")

type MaintenanceProgressListener = (statusText: string) => void

type MaintenanceTarget = {
  contentId: string
  contentType: SynapseContentType
}

type CompactionHistoryVersion = {
  attachments: SynapseContentAttachmentsRecord
  dirname: string
  mainContent: string
  snapshot: SynapseContentSnapshotRecord
}

type CompactionRunResult = {
  compactedCount: number
  gitPaths: string[]
}

type AttachmentsGcResult = {
  deletedCount: number
  gitPaths: string[]
}

type RepositoryMaintenanceResult = {
  compactedCount: number
  deletedAttachmentCount: number
  message: string
  pendingPushCount: number
  pushed: boolean
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value)
}

function isNonEmptyString(value: unknown): value is string {
  return typeof value === "string" && value.trim().length > 0
}

function sortEntriesByName(left: Dirent, right: Dirent): number {
  return left.name.localeCompare(right.name)
}

function formatCompactTimestamp(date: Date): string {
  return `${date.toISOString().replace(/[-:]/g, "").slice(0, 15)}Z`
}

function createCompactHistoryDirname(modifiedAt: string): string | null {
  const date = new Date(modifiedAt)

  if (Number.isNaN(date.getTime())) {
    return null
  }

  return `${formatCompactTimestamp(date)}__${ZERO_USER_ID}__compact`
}

function createMaintenanceMessage(
  compactedCount: number,
  deletedAttachmentCount: number,
  pushed: boolean,
  pendingPushCount: number,
): string {
  const fragments: string[] = []

  if (compactedCount > 0) {
    fragments.push(`整理了 ${compactedCount} 条内容`)
  }

  if (deletedAttachmentCount > 0) {
    fragments.push(`清理了 ${deletedAttachmentCount} 个附件`)
  }

  if (fragments.length === 0) {
    return "没有需要整理的内容。"
  }

  if (pushed) {
    return `${fragments.join("，")}，已同步。`
  }

  return pendingPushCount > 1
    ? `${fragments.join("，")}，等待同步 ${pendingPushCount} 条变更。`
    : `${fragments.join("，")}，等待同步。`
}


function createPendingPushTitle(action: "compaction" | "gc"): string {
  return action === "compaction" ? "整理历史记录" : "清理附件池"
}


async function readDirectoryEntries(directoryPath: string): Promise<Dirent[]> {
  try {
    const entries = await readdir(directoryPath, { withFileTypes: true })

    return entries.sort(sortEntriesByName)
  } catch (error) {
    if (isFileNotFoundError(error)) {
      return []
    }

    throw error
  }
}

async function readJsonFile<T>(filePath: string): Promise<T | null> {
  try {
    const fileContent = await readFile(filePath, "utf8")

    return JSON.parse(fileContent) as T
  } catch (error) {
    if (isFileNotFoundError(error)) {
      return null
    }

    throw error
  }
}

function parseSnapshotRecord(rawValue: unknown): SynapseContentSnapshotRecord | null {
  if (!isRecord(rawValue)) {
    return null
  }

  const iconType = rawValue.iconType === "image" ? "image" : "icon"

  if (
    rawValue.schemaVersion !== 1
    || !isNonEmptyString(rawValue.title)
    || !isNonEmptyString(rawValue.description)
    || !isNonEmptyString(rawValue.category)
    || !isNonEmptyString(rawValue.modifiedBy)
    || !isNonEmptyString(rawValue.modifiedAt)
    || typeof rawValue.deleted !== "boolean"
  ) {
    return null
  }

  if (iconType === "icon" && (!isNonEmptyString(rawValue.icon) || !isNonEmptyString(rawValue.iconBg))) {
    return null
  }

  const rawName = rawValue.name
  const trimmedName = typeof rawName === "string" ? rawName.trim() : ""
  const rawUsage = rawValue.usage
  const trimmedUsage = typeof rawUsage === "string" ? rawUsage.trim() : ""
  const rawIconImage = rawValue.iconImage
  const trimmedIconImage = typeof rawIconImage === "string" ? rawIconImage.trim() : ""

  return {
    schemaVersion: 1,
    title: rawValue.title.trim(),
    ...(trimmedName.length > 0 ? { name: trimmedName } : {}),
    ...(trimmedUsage.length > 0 ? { usage: trimmedUsage } : {}),
    description: rawValue.description.trim(),
    category: rawValue.category.trim(),
    icon: typeof rawValue.icon === "string" ? rawValue.icon.trim() : "",
    iconBg: typeof rawValue.iconBg === "string" ? rawValue.iconBg.trim() : "",
    iconType,
    ...(trimmedIconImage.length > 0 ? { iconImage: trimmedIconImage } : {}),
    modifiedBy: rawValue.modifiedBy.trim(),
    modifiedByDisplayName:
      typeof rawValue.modifiedByDisplayName === "string" ? rawValue.modifiedByDisplayName.trim() : "",
    modifiedAt: rawValue.modifiedAt.trim(),
    deleted: rawValue.deleted,
  }
}

function parseAttachmentsRecord(rawValue: unknown): SynapseContentAttachmentsRecord {
  if (!isRecord(rawValue) || rawValue.schemaVersion !== 1 || !Array.isArray(rawValue.files)) {
    return {
      schemaVersion: 1,
      files: [],
    }
  }

  const files = rawValue.files
    .filter((item): item is Record<string, unknown> => isRecord(item))
    .map((item) => {
      if (
        !isNonEmptyString(item.originalName)
        || !isNonEmptyString(item.sha256)
        || typeof item.size !== "number"
        || !Number.isFinite(item.size)
      ) {
        return null
      }

      return {
        originalName: item.originalName.trim(),
        sha256: item.sha256.trim(),
        size: item.size,
      }
    })
    .filter((item): item is SynapseContentAttachmentRecord => item !== null)

  return {
    schemaVersion: 1,
    files,
  }
}

function createAttachmentPoolPath(repositoryRootPath: string, sha256: string): string {
  return path.join(
    repositoryRootPath,
    BLOBS_DIRECTORY_PATH,
    sha256.slice(0, 2),
    sha256.slice(2, 4),
    sha256,
  )
}

function toCommitMessage(action: "compaction" | "gc", count: number): string {
  return action === "compaction"
    ? `[synapse] compaction ${count} content`
    : `[synapse] gc ${count} attachments`
}

function readMaintenanceMetaValue(repositoryUuid: string, key: string): Promise<string | null> {
  return withRepositoryCacheDatabase(repositoryUuid, (database) => {
    const row = database.prepare(`
      SELECT value
      FROM index_meta
      WHERE key = ?
      LIMIT 1
    `).get(key) as { value?: string } | undefined

    return row?.value?.trim() || null
  })
}

function writeMaintenanceMetaValue(repositoryUuid: string, key: string, value: string): Promise<void> {
  return withRepositoryCacheDatabase(repositoryUuid, (database) => {
    database.prepare(`
      INSERT INTO index_meta (key, value)
      VALUES (?, ?)
      ON CONFLICT(key) DO UPDATE SET value = excluded.value
    `).run(key, value)
  })
}

const MAINTENANCE_LOCAL_TIMEOUT_MS = 30_000
const MAINTENANCE_REMOTE_TIMEOUT_MS = 60_000

function runMaintenanceGitCommand(
  cwd: string,
  args: string[],
  fallbackMessage: string,
  onOutput?: (line: string) => void,
  options?: { timeoutMs?: number; timeoutMessage?: string },
): Promise<GitCommandResult> {
  return runGitCommand({
    args,
    cwd,
    fallbackMessage,
    formatFailureMessage: formatGitFailureMessage,
    onLine: (line) => {
      onOutput?.(line)
    },
    timeoutMs: options?.timeoutMs ?? MAINTENANCE_LOCAL_TIMEOUT_MS,
    timeoutMessage: options?.timeoutMessage ?? fallbackMessage,
  })
}

async function pushRepository(
  repository: SynapseRepositoryConfig,
  onProgress?: MaintenanceProgressListener,
): Promise<void> {
  onProgress?.("正在推送到仓库...")
  await runMaintenanceGitCommand(
    repository.localPath,
    ["push"],
    "推送到仓库失败。",
    (line) => {
      onProgress?.(line)
    },
    {
      timeoutMs: MAINTENANCE_REMOTE_TIMEOUT_MS,
      timeoutMessage: "推送到仓库超时，请检查网络后重试。",
    },
  )
}

async function removeEmptyDirectoryIfNeeded(directoryPath: string): Promise<void> {
  try {
    const entries = await readdir(directoryPath)

    if (entries.length === 0) {
      await rm(directoryPath, { recursive: true, force: true })
    }
  } catch (error) {
    if (isFileNotFoundError(error)) {
      return
    }

    throw error
  }
}

class RepositoryMaintenanceService {
  async runManualMaintenance(
    repository: SynapseRepositoryConfig,
    onProgress?: MaintenanceProgressListener,
  ): Promise<RepositoryMaintenanceResult> {
    return runRepositoryGitExclusive(repository, "maintenance", (repositoryState) => (
      this.runMaintenanceInExclusive(repository, repositoryState, {
        compactionSkipThreshold: COMPACTION_KEEP_RECENT,
        onProgress,
        targets: null,
      })
    ))
  }

  async runScheduledMaintenanceIfDue(
    repository: SynapseRepositoryConfig,
  ): Promise<RepositoryMaintenanceResult | null> {
    return runRepositoryGitExclusive(repository, "scheduled-maintenance", async (repositoryState) => {
      const lastMaintenanceAt = await readMaintenanceMetaValue(repository.uuid, LAST_MAINTENANCE_AT_KEY)

      if (lastMaintenanceAt) {
        const lastMaintenanceDate = new Date(lastMaintenanceAt)

        if (
          !Number.isNaN(lastMaintenanceDate.getTime())
          && Date.now() - lastMaintenanceDate.getTime() < MANUAL_MAINTENANCE_INTERVAL_MS
        ) {
          return null
        }
      }

      return this.runMaintenanceInExclusive(repository, repositoryState, {
        compactionSkipThreshold: COMPACTION_SKIP_THRESHOLD,
        onProgress: undefined,
        targets: null,
      })
    })
  }

  async maybeRunAfterPush(
    repository: SynapseRepositoryConfig,
    target: MaintenanceTarget,
  ): Promise<RepositoryMaintenanceResult | null> {
    return runRepositoryGitExclusive(repository, "post-push-maintenance", async (repositoryState) => {
      const historyVersions = await this.readHistoryVersions(
        repository,
        target.contentType,
        target.contentId,
      )

      if (historyVersions.length <= COMPACTION_TRIGGER_THRESHOLD) {
        return null
      }

      return this.runMaintenanceInExclusive(repository, repositoryState, {
        compactionSkipThreshold: COMPACTION_SKIP_THRESHOLD,
        onProgress: undefined,
        targets: [target],
      })
    })
  }

  async runManualMaintenanceInExclusive(
    repository: SynapseRepositoryConfig,
    repositoryState: SynapseRepositoryLocalState,
    onProgress?: MaintenanceProgressListener,
  ): Promise<RepositoryMaintenanceResult> {
    return this.runMaintenanceInExclusive(repository, repositoryState, {
      compactionSkipThreshold: COMPACTION_KEEP_RECENT,
      onProgress,
      targets: null,
    })
  }

  private async runMaintenanceInExclusive(
    repository: SynapseRepositoryConfig,
    repositoryState: SynapseRepositoryLocalState,
    options: {
      compactionSkipThreshold: number
      onProgress?: MaintenanceProgressListener
      targets: MaintenanceTarget[] | null
    },
  ): Promise<RepositoryMaintenanceResult> {
    if (repositoryState.status !== "ready") {
      throw new Error("当前目录不存在，请先在 Settings 里重新选择本地目录。")
    }

    if (!repositoryState.isGitRepository || !repositoryState.gitRootPath) {
      throw new Error("当前目录不是 Git 仓库，无法整理历史。")
    }

    await pullRepositoryWithSafeRebase(repository, options.onProgress)

    const compactionResult = await this.runCompaction(
      repository,
      options.targets,
      options.compactionSkipThreshold,
      options.onProgress,
    )
    const attachmentsGcResult = await this.runAttachmentsGc(repository, options.onProgress)
    const commitQueue: Array<{
      action: "compaction" | "gc"
      commitHash: string
      targetId: string
      title: string
    }> = []

    if (compactionResult.compactedCount > 0) {
      options.onProgress?.("正在提交整理结果...")
      const commitHash = await commitRepositoryPaths({
        fallbackMessage: "提交整理结果失败。",
        filePaths: compactionResult.gitPaths,
        gitRootPath: repositoryState.gitRootPath,
        message: toCommitMessage("compaction", compactionResult.compactedCount),
      })

      commitQueue.push({
        action: "compaction",
        commitHash,
        targetId:
          options.targets?.[0]?.contentId
          ?? repository.uuid,
        title: createPendingPushTitle("compaction"),
      })
    }

    if (attachmentsGcResult.deletedCount > 0) {
      options.onProgress?.("正在提交附件清理结果...")
      const commitHash = await commitRepositoryPaths({
        fallbackMessage: "提交整理结果失败。",
        filePaths: attachmentsGcResult.gitPaths,
        gitRootPath: repositoryState.gitRootPath,
        message: toCommitMessage("gc", attachmentsGcResult.deletedCount),
      })

      commitQueue.push({
        action: "gc",
        commitHash,
        targetId: BLOBS_DIRECTORY_PATH,
        title: createPendingPushTitle("gc"),
      })
    }

    await contentIndexService.syncIndex(repository)

    let pushed = true

    if (commitQueue.length > 0) {
      try {
        await pushRepository(repository, options.onProgress)
      } catch (error) {
        const message = error instanceof Error ? error.message : "推送到仓库失败。"

        if (isNonFastForwardError(message)) {
          try {
            await pullRepositoryWithSafeRebase(repository, options.onProgress)
            await pushRepository(repository, options.onProgress)
          } catch (retryError) {
            pushed = false

            for (const commit of commitQueue) {
              await pendingPushesService.enqueue(repository, {
                action: commit.action,
                commitHash: commit.commitHash,
                targetId: commit.targetId,
                title: commit.title,
              })
            }

            logger.warn("Repository maintenance push retry failed and was queued.", {
              error: retryError,
              repositoryUuid: repository.uuid,
            })
          }
        } else {
          pushed = false

          for (const commit of commitQueue) {
            await pendingPushesService.enqueue(repository, {
              action: commit.action,
              commitHash: commit.commitHash,
              targetId: commit.targetId,
              title: commit.title,
            })
          }

          logger.warn("Repository maintenance push failed and was queued.", {
            error,
            repositoryUuid: repository.uuid,
          })
        }
      }
    }

    await contentIndexService.syncIndex(repository)

    const pendingPushState = await pendingPushesService.readState(repository)
    const completedAt = new Date().toISOString()

    await writeMaintenanceMetaValue(repository.uuid, LAST_MAINTENANCE_AT_KEY, completedAt)

    return {
      compactedCount: compactionResult.compactedCount,
      deletedAttachmentCount: attachmentsGcResult.deletedCount,
      pushed,
      pendingPushCount: pendingPushState.count,
      message: createMaintenanceMessage(
        compactionResult.compactedCount,
        attachmentsGcResult.deletedCount,
        pushed,
        pendingPushState.count,
      ),
    }
  }

  private async runCompaction(
    repository: SynapseRepositoryConfig,
    targets: MaintenanceTarget[] | null,
    compactionSkipThreshold: number,
    onProgress?: MaintenanceProgressListener,
  ): Promise<CompactionRunResult> {
    const gitPaths = new Set<string>()
    let compactedCount = 0
    const targetsByType = new Map<SynapseContentType, Set<string>>()

    if (targets) {
      for (const target of targets) {
        const bucket = targetsByType.get(target.contentType) ?? new Set<string>()

        bucket.add(target.contentId)
        targetsByType.set(target.contentType, bucket)
      }
    }

    for (const contentType of ["rule", "skill", "prompt"] as const) {
      const contentIds = await this.listContentIds(
        repository,
        contentType,
        targetsByType.get(contentType) ?? null,
      )

      for (const contentId of contentIds) {
        const typeLabel = contentType === "rule" ? "Rule" : contentType === "skill" ? "Skill" : "Prompt"

        onProgress?.(`正在整理 ${typeLabel} ${contentId.slice(0, 8)}...`)
        const historyVersions = await this.readHistoryVersions(repository, contentType, contentId)

        if (historyVersions.length === 0) {
          continue
        }

        const latestVersion = historyVersions[historyVersions.length - 1]
        const latestDate = new Date(latestVersion.snapshot.modifiedAt)

        if (
          latestVersion.snapshot.deleted
          && !Number.isNaN(latestDate.getTime())
          && Date.now() - latestDate.getTime() > SOFT_DELETE_RETENTION_MS
        ) {
          const contentDirectoryPath = resolveContentDirectoryPath(repository, contentType, contentId)

          await rm(contentDirectoryPath, { recursive: true, force: true })
          gitPaths.add(contentDirectoryPath)
          compactedCount += 1
          continue
        }

        if (historyVersions.length <= compactionSkipThreshold) {
          continue
        }

        const oldVersions = historyVersions.slice(0, Math.max(0, historyVersions.length - COMPACTION_KEEP_RECENT))

        if (oldVersions.length === 0) {
          continue
        }

        const baselineVersion = oldVersions[oldVersions.length - 1]
        const compactDirname = createCompactHistoryDirname(baselineVersion.snapshot.modifiedAt)

        if (!compactDirname) {
          logger.warn("Skipped compaction because baseline modifiedAt is invalid.", {
            contentId,
            contentType,
            modifiedAt: baselineVersion.snapshot.modifiedAt,
            repositoryUuid: repository.uuid,
          })
          continue
        }

        const contentDirectoryPath = resolveContentDirectoryPath(repository, contentType, contentId)
        const historyDirectoryPath = path.join(contentDirectoryPath, HISTORY_DIRECTORY_NAME)
        const compactHistoryPath = path.join(historyDirectoryPath, compactDirname)

        if (!(await pathExists(compactHistoryPath))) {
          await mkdir(compactHistoryPath, { recursive: true })
          await writeFile(
            path.join(compactHistoryPath, "snapshot.json"),
            `${JSON.stringify(baselineVersion.snapshot, null, 2)}\n`,
            "utf8",
          )
          await writeFile(
            path.join(compactHistoryPath, CONTENT_MAIN_FILE_NAME),
            baselineVersion.mainContent,
            "utf8",
          )
          await writeFile(
            path.join(compactHistoryPath, CONTENT_ATTACHMENTS_FILE_NAME),
            `${JSON.stringify(baselineVersion.attachments, null, 2)}\n`,
            "utf8",
          )
        }

        for (const version of oldVersions) {
          await rm(path.join(historyDirectoryPath, version.dirname), { recursive: true, force: true })
        }

        gitPaths.add(contentDirectoryPath)
        compactedCount += 1
      }
    }

    return {
      compactedCount,
      gitPaths: Array.from(gitPaths),
    }
  }

  private async runAttachmentsGc(
    repository: SynapseRepositoryConfig,
    onProgress?: MaintenanceProgressListener,
  ): Promise<AttachmentsGcResult> {
    onProgress?.("正在检查附件池...")

    const referencedShaSet = await this.collectReferencedAttachmentShas(repository)
    const poolFiles = await this.listAttachmentPoolFiles(repository.localPath)
    const gitPaths = new Set<string>()
    let deletedCount = 0

    for (const poolFilePath of poolFiles) {
      const sha256 = path.basename(poolFilePath)

      if (referencedShaSet.has(sha256)) {
        continue
      }

      const fileStat = await stat(poolFilePath)

      if (Date.now() - fileStat.mtimeMs < ATTACHMENT_GC_WINDOW_MS) {
        continue
      }

      await rm(poolFilePath, { force: true })
      gitPaths.add(path.join(repository.localPath, BLOBS_DIRECTORY_PATH))
      deletedCount += 1

      await removeEmptyDirectoryIfNeeded(path.dirname(poolFilePath))
      await removeEmptyDirectoryIfNeeded(path.dirname(path.dirname(poolFilePath)))
    }

    return {
      deletedCount,
      gitPaths: Array.from(gitPaths),
    }
  }

  private async listContentIds(
    repository: SynapseRepositoryConfig,
    contentType: SynapseContentType,
    allowedIds: Set<string> | null,
  ): Promise<string[]> {
    const rootPath = resolveContentRootPath(repository, contentType)
    const entries = await readDirectoryEntries(rootPath)

    return entries
      .filter((entry) => entry.isDirectory())
      .map((entry) => entry.name)
      .filter((contentId) => !allowedIds || allowedIds.has(contentId))
  }

  private async readHistoryVersions(
    repository: SynapseRepositoryConfig,
    contentType: SynapseContentType,
    contentId: string,
  ): Promise<CompactionHistoryVersion[]> {
    const historyRootPath = path.join(
      resolveContentDirectoryPath(repository, contentType, contentId),
      HISTORY_DIRECTORY_NAME,
    )
    const entries = await readDirectoryEntries(historyRootPath)
    const versions: CompactionHistoryVersion[] = []

    for (const entry of entries) {
      if (!entry.isDirectory()) {
        continue
      }

      const historyDirectoryPath = path.join(historyRootPath, entry.name)
      const snapshot = parseSnapshotRecord(
        await readJsonFile<unknown>(path.join(historyDirectoryPath, "snapshot.json")),
      )

      if (!snapshot) {
        continue
      }

      try {
        const [mainContent, attachmentsRaw] = await Promise.all([
          readFile(path.join(historyDirectoryPath, CONTENT_MAIN_FILE_NAME), "utf8"),
          readJsonFile<unknown>(path.join(historyDirectoryPath, CONTENT_ATTACHMENTS_FILE_NAME)),
        ])

        versions.push({
          dirname: entry.name,
          mainContent,
          snapshot,
          attachments: parseAttachmentsRecord(attachmentsRaw),
        })
      } catch (error) {
        if (isFileNotFoundError(error)) {
          logger.warn("Skipped malformed history version during compaction.", {
            contentId,
            contentType,
            dirname: entry.name,
            repositoryUuid: repository.uuid,
          })
          continue
        }

        throw error
      }
    }

    return versions.sort((left, right) => left.snapshot.modifiedAt.localeCompare(right.snapshot.modifiedAt))
  }

  private async collectReferencedAttachmentShas(
    repository: SynapseRepositoryConfig,
  ): Promise<Set<string>> {
    const referencedShaSet = new Set<string>()

    for (const contentType of ["rule", "skill", "prompt"] as const) {
      const contentIds = await this.listContentIds(repository, contentType, null)

      for (const contentId of contentIds) {
        const historyRootPath = path.join(
          resolveContentDirectoryPath(repository, contentType, contentId),
          HISTORY_DIRECTORY_NAME,
        )
        const entries = await readDirectoryEntries(historyRootPath)

        for (const entry of entries) {
          if (!entry.isDirectory()) {
            continue
          }

          const attachmentsRecord = parseAttachmentsRecord(
            await readJsonFile<unknown>(
              path.join(historyRootPath, entry.name, CONTENT_ATTACHMENTS_FILE_NAME),
            ),
          )

          for (const file of attachmentsRecord.files) {
            referencedShaSet.add(file.sha256)
          }
        }
      }
    }

    return referencedShaSet
  }

  private async listAttachmentPoolFiles(repositoryRootPath: string): Promise<string[]> {
    const poolRootPath = path.join(repositoryRootPath, BLOBS_DIRECTORY_PATH)
    const firstLevelEntries = await readDirectoryEntries(poolRootPath)
    const files: string[] = []

    for (const firstLevelEntry of firstLevelEntries) {
      if (!firstLevelEntry.isDirectory()) {
        continue
      }

      const secondLevelPath = path.join(poolRootPath, firstLevelEntry.name)
      const secondLevelEntries = await readDirectoryEntries(secondLevelPath)

      for (const secondLevelEntry of secondLevelEntries) {
        if (!secondLevelEntry.isDirectory()) {
          continue
        }

        const shardPath = path.join(secondLevelPath, secondLevelEntry.name)
        const shardEntries = await readDirectoryEntries(shardPath)

        for (const shardEntry of shardEntries) {
          if (shardEntry.isFile()) {
            files.push(path.join(shardPath, shardEntry.name))
          }
        }
      }
    }

    return files
  }
}

const repositoryMaintenanceService = new RepositoryMaintenanceService()

export {
  repositoryMaintenanceService,
}
