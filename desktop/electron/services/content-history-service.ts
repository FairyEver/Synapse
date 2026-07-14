import { readFile, readdir } from "node:fs/promises"
import type { Dirent } from "node:fs"
import path from "node:path"
import { getContentDir } from "../../src/lib/config"
import {
  normalizeContentAttachmentPath,
  SKILL_ENV_EXAMPLE_PATH,
} from "../../src/lib/content-attachments"
import type { SynapseRepositoryConfig } from "../../src/types/config"
import type {
  SynapseContentAttachmentRecord,
  SynapseContentAttachmentsRecord,
  SynapseContentDetail,
  SynapseContentHistoryEntry,
  SynapseContentHistoryVersion,
  SynapseContentMeta,
  SynapseContentMetaRecord,
  SynapseContentSnapshotRecord,
  SynapseContentType,
} from "../../src/types/content"
import { normalizeAttachmentSha256 } from "./attachments-pool-service"
import { isFileNotFoundError } from "./fs-utils"
import { createMainLogger } from "./log-store"

const CONTENT_META_FILE_NAME = "meta.json"
const CONTENT_MAIN_FILE_NAME = "main.md"
const CONTENT_ATTACHMENTS_FILE_NAME = "attachments.json"
const HISTORY_DIRECTORY_NAME = "history"
const logger = createMainLogger("service.content-history")

type ResolvedContentVersion = {
  attachments: SynapseContentAttachmentRecord[]
  content: string
  historyDirname: string
  meta: SynapseContentMetaRecord
  snapshot: SynapseContentSnapshotRecord
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

function resolveContentRootPath(
  repository: SynapseRepositoryConfig,
  contentType: SynapseContentType,
): string {
  return path.join(repository.localPath, getContentDir(repository, contentType))
}

function resolveContentDirectoryPath(
  repository: SynapseRepositoryConfig,
  contentType: SynapseContentType,
  contentId: string,
): string {
  return path.join(resolveContentRootPath(repository, contentType), contentId)
}

function createEmptyAttachmentsRecord(): SynapseContentAttachmentsRecord {
  return {
    schemaVersion: 1,
    files: [],
  }
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

    if (error instanceof SyntaxError) {
      logger.warn("Failed to parse JSON file.", {
        filePath,
      })
      return null
    }

    throw error
  }
}

function parseMetaRecord(
  rawValue: unknown,
  expectedType: SynapseContentType,
): SynapseContentMetaRecord | null {
  if (!isRecord(rawValue)) {
    return null
  }

  if (
    rawValue.schemaVersion !== 1
    || !isNonEmptyString(rawValue.id)
    || !isNonEmptyString(rawValue.createdBy)
    || !isNonEmptyString(rawValue.createdAt)
    || !isNonEmptyString(rawValue.type)
    || rawValue.type !== expectedType
  ) {
    return null
  }

  return {
    schemaVersion: 1,
    id: rawValue.id.trim(),
    type: rawValue.type,
    createdBy: rawValue.createdBy.trim(),
    createdByDisplayName:
      typeof rawValue.createdByDisplayName === "string" ? rawValue.createdByDisplayName.trim() : "",
    createdAt: rawValue.createdAt.trim(),
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
    return createEmptyAttachmentsRecord()
  }

  const files = rawValue.files
    .filter((file): file is Record<string, unknown> => isRecord(file))
    .map((file) => {
      if (
        !isNonEmptyString(file.originalName)
        || !isNonEmptyString(file.sha256)
        || typeof file.size !== "number"
        || !Number.isFinite(file.size)
      ) {
        return null
      }

      const originalName = normalizeContentAttachmentPath(file.originalName)
      if (!originalName) {
        return null
      }

      let sha256: string
      try {
        sha256 = normalizeAttachmentSha256(file.sha256)
      } catch {
        return null
      }

      return {
        originalName,
        sha256,
        size: file.size,
      }
    })
    .filter((file): file is SynapseContentAttachmentRecord => file !== null)

  return {
    schemaVersion: 1,
    files,
  }
}

function buildSummary(
  contentType: SynapseContentType,
  meta: SynapseContentMetaRecord,
  snapshot: SynapseContentSnapshotRecord,
  historyDirname: string,
  attachments: SynapseContentAttachmentRecord[],
): SynapseContentMeta {
  const baseSummary = {
    id: meta.id,
    title: snapshot.title,
    ...(snapshot.name ? { name: snapshot.name } : {}),
    ...(snapshot.usage ? { usage: snapshot.usage } : {}),
    description: snapshot.description,
    category: snapshot.category,
    icon: snapshot.icon,
    iconBg: snapshot.iconBg,
    iconType: snapshot.iconType,
    ...(snapshot.iconImage ? { iconImage: snapshot.iconImage } : {}),
    createdBy: meta.createdBy,
    createdByDisplayName: meta.createdByDisplayName,
    createdAt: meta.createdAt,
    modifiedBy: snapshot.modifiedBy,
    modifiedByDisplayName: snapshot.modifiedByDisplayName,
    modifiedAt: snapshot.modifiedAt,
    deleted: snapshot.deleted,
    latestHistoryDirname: historyDirname,
    attachmentCount: attachments.length,
    hasEnv: contentType === "skill" && attachments.some(
      (attachment) => attachment.originalName === SKILL_ENV_EXAMPLE_PATH,
    ),
    source: "repository",
    isReadonly: false,
  }

  return {
    ...baseSummary,
    type: contentType,
  } as SynapseContentMeta
}

async function readContentMetaRecord(
  directoryPath: string,
  expectedType: SynapseContentType,
): Promise<SynapseContentMetaRecord | null> {
  const rawValue = await readJsonFile<unknown>(path.join(directoryPath, CONTENT_META_FILE_NAME))

  return parseMetaRecord(rawValue, expectedType)
}

async function readAttachmentsRecord(historyDirectoryPath: string): Promise<SynapseContentAttachmentsRecord> {
  const rawValue = await readJsonFile<unknown>(
    path.join(historyDirectoryPath, CONTENT_ATTACHMENTS_FILE_NAME),
  )

  return parseAttachmentsRecord(rawValue)
}

class ContentHistoryService {
  async listContent(
    repository: SynapseRepositoryConfig,
    contentType: SynapseContentType,
  ): Promise<SynapseContentMeta[]> {
    const rootPath = resolveContentRootPath(repository, contentType)
    const entries = await readDirectoryEntries(rootPath)
    const summaries: SynapseContentMeta[] = []

    for (const entry of entries) {
      if (!entry.isDirectory()) {
        continue
      }

      const summary = await this.readCurrentSummary(repository, contentType, entry.name)

      if (summary) {
        summaries.push(summary)
      }
    }

    return summaries.sort((left, right) => right.modifiedAt.localeCompare(left.modifiedAt))
  }

  async readCurrentSummary(
    repository: SynapseRepositoryConfig,
    contentType: SynapseContentType,
    contentId: string,
  ): Promise<SynapseContentMeta | null> {
    const resolvedVersion = await this.readResolvedVersion(repository, contentType, contentId)

    if (!resolvedVersion) {
      return null
    }

    return buildSummary(
      contentType,
      resolvedVersion.meta,
      resolvedVersion.snapshot,
      resolvedVersion.historyDirname,
      resolvedVersion.attachments,
    )
  }

  async readCurrentDetail(
    repository: SynapseRepositoryConfig,
    contentType: SynapseContentType,
    contentId: string,
  ): Promise<SynapseContentDetail | null> {
    const resolvedVersion = await this.readResolvedVersion(repository, contentType, contentId)

    if (!resolvedVersion) {
      return null
    }

    return {
      ...buildSummary(
        contentType,
        resolvedVersion.meta,
        resolvedVersion.snapshot,
        resolvedVersion.historyDirname,
        resolvedVersion.attachments,
      ),
      content: resolvedVersion.content,
      attachments: resolvedVersion.attachments,
    } as SynapseContentDetail
  }

  async listHistory(
    repository: SynapseRepositoryConfig,
    contentType: SynapseContentType,
    contentId: string,
  ): Promise<SynapseContentHistoryEntry[]> {
    const directoryPath = resolveContentDirectoryPath(repository, contentType, contentId)
    const latestVersion = await this.readResolvedVersion(repository, contentType, contentId)

    if (!latestVersion) {
      return []
    }

    const historyEntries = await readDirectoryEntries(path.join(directoryPath, HISTORY_DIRECTORY_NAME))

    // 并行读取所有历史版本的 snapshot
    const snapshots = await Promise.all(
      historyEntries
        .filter((entry) => entry.isDirectory())
        .map(async (entry) => {
          const snapshot = parseSnapshotRecord(
            await readJsonFile<unknown>(
              path.join(directoryPath, HISTORY_DIRECTORY_NAME, entry.name, "snapshot.json"),
            ),
          )
          return snapshot ? { dirname: entry.name, snapshot } : null
        }),
    )

    return snapshots
      .filter((item): item is { dirname: string; snapshot: NonNullable<ReturnType<typeof parseSnapshotRecord>> } => item !== null)
      .map(({ dirname, snapshot }) => ({
        dirname,
        modifiedAt: snapshot.modifiedAt,
        modifiedBy: snapshot.modifiedBy,
        modifiedByDisplayName: snapshot.modifiedByDisplayName,
        deleted: snapshot.deleted,
        isCurrent: dirname === latestVersion.historyDirname,
      }))
      .sort((left, right) => right.dirname.localeCompare(left.dirname))
  }

  async readHistoryVersion(
    repository: SynapseRepositoryConfig,
    contentType: SynapseContentType,
    contentId: string,
    historyDirname: string,
  ): Promise<SynapseContentHistoryVersion | null> {
    const directoryPath = resolveContentDirectoryPath(repository, contentType, contentId)
    const meta = await readContentMetaRecord(directoryPath, contentType)

    if (!meta) {
      return null
    }

    const historyDirectoryPath = path.join(directoryPath, HISTORY_DIRECTORY_NAME, historyDirname)
    const snapshot = parseSnapshotRecord(
      await readJsonFile<unknown>(path.join(historyDirectoryPath, "snapshot.json")),
    )

    if (!snapshot) {
      return null
    }

    let mainContent: string
    try {
      mainContent = await readFile(path.join(historyDirectoryPath, CONTENT_MAIN_FILE_NAME), "utf8")
    } catch (error) {
      if (isFileNotFoundError(error)) return null
      throw error
    }
    const attachmentsRecord = await readAttachmentsRecord(historyDirectoryPath)
    const currentVersion = await this.readResolvedVersion(repository, contentType, contentId)

    return {
      ...buildSummary(contentType, meta, snapshot, historyDirname, attachmentsRecord.files),
      content: mainContent,
      attachments: attachmentsRecord.files,
      historyDirname,
      isCurrent: currentVersion?.historyDirname === historyDirname,
    } as SynapseContentHistoryVersion
  }

  async readResolvedVersion(
    repository: SynapseRepositoryConfig,
    contentType: SynapseContentType,
    contentId: string,
  ): Promise<ResolvedContentVersion | null> {
    const directoryPath = resolveContentDirectoryPath(repository, contentType, contentId)
    const meta = await readContentMetaRecord(directoryPath, contentType)

    if (!meta) {
      return null
    }

    const historyEntries = await readDirectoryEntries(path.join(directoryPath, HISTORY_DIRECTORY_NAME))

    // 过滤有效目录并按名字倒序（目录名是时间戳，字典序即时间序）
    const sortedDirs = historyEntries
      .filter((entry) => entry.isDirectory())
      .sort((left, right) => right.name.localeCompare(left.name))

    // 只读取最新版本，避免遍历所有历史版本
    for (const entry of sortedDirs) {
      const historyDirectoryPath = path.join(directoryPath, HISTORY_DIRECTORY_NAME, entry.name)
      const snapshot = parseSnapshotRecord(
        await readJsonFile<unknown>(path.join(historyDirectoryPath, "snapshot.json")),
      )

      if (!snapshot) {
        continue
      }

      try {
        const [content, attachmentsRecord] = await Promise.all([
          readFile(path.join(historyDirectoryPath, CONTENT_MAIN_FILE_NAME), "utf8"),
          readAttachmentsRecord(historyDirectoryPath),
        ])

        return {
          attachments: attachmentsRecord.files,
          content,
          historyDirname: entry.name,
          meta,
          snapshot,
        }
      } catch (error) {
        if (isFileNotFoundError(error)) {
          continue
        }

        throw error
      }
    }

    return null
  }
}

const contentHistoryService = new ContentHistoryService()

export {
  CONTENT_ATTACHMENTS_FILE_NAME,
  CONTENT_MAIN_FILE_NAME,
  CONTENT_META_FILE_NAME,
  HISTORY_DIRECTORY_NAME,
  contentHistoryService,
  resolveContentDirectoryPath,
  resolveContentRootPath,
}
