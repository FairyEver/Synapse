import { randomBytes, randomUUID } from "node:crypto"
import { mkdir, mkdtemp, rename, rm, writeFile } from "node:fs/promises"
import path from "node:path"
import { getContentTypeDefinition } from "../../src/config/content-types"
import { getActiveRepositoryConfig } from "../../src/lib/config"
import type { SynapseRepositoryConfig } from "../../src/types/config"
import type {
  SynapseContentAttachmentRecord,
  SynapseContentAttachmentsRecord,
  SynapseContentDetail,
  SynapseContentMetaRecord,
  SynapseContentSnapshotRecord,
  SynapseContentType,
  SynapseCreateContentRequest,
  SynapseCreateContentPayload,
  SynapseCreateRulePayload,
  SynapseCreateSkillPayload,
  SynapseUpdateContentPayload,
  SynapseUpdateContentRequest,
  SynapseUpdateRulePayload,
  SynapseUpdateSkillPayload,
} from "../../src/types/content"
import { attachmentsPoolService } from "./attachments-pool-service"
import {
  CONTENT_ATTACHMENTS_FILE_NAME,
  CONTENT_MAIN_FILE_NAME,
  CONTENT_META_FILE_NAME,
  HISTORY_DIRECTORY_NAME,
  contentHistoryService,
  resolveContentDirectoryPath,
  resolveContentRootPath,
} from "./content-history-service"
import { configStore } from "./config-store"
import { createMainLogger } from "./log-store"
import { repositoryStore } from "./repository-store"

const SNAPSHOT_FILE_NAME = "snapshot.json"
const ICON_IMAGE_FILE_NAME = "icon.png"
const logger = createMainLogger("service.content-write")

type SynapseContentAuthor = {
  displayName: string
  userId: string
}

type ActiveRepositoryWriteContext = {
  repositoryRootPath: string
  identity: SynapseContentAuthor
  repository: SynapseRepositoryConfig
}

type ContentWriteResult = {
  gitPaths: string[]
  id: string
  latestHistoryDirname: string
  modifiedAt: string
  title: string
  type: SynapseContentType
}

type ContentCreatePayload = SynapseCreateContentPayload
type ContentUpdatePayload = SynapseUpdateContentPayload

function normalizeMarkdownContent(content: string): string {
  return content.endsWith("\n") ? content : `${content}\n`
}

function isNonEmptyString(value: string): boolean {
  return value.trim().length > 0
}

function assertRequiredCreateFields(payload: ContentCreatePayload | ContentUpdatePayload): void {
  const baseFields = [
    payload.title,
    payload.description,
    payload.category,
    payload.content,
  ]

  if (payload.iconType === "image") {
    if (baseFields.some((value) => !isNonEmptyString(value))) {
      throw new Error("创建内容缺少必要字段，请先补全表单。")
    }
  } else {
    const requiredFields = [
      ...baseFields,
      payload.icon,
      payload.iconBg,
    ]

    if (requiredFields.some((value) => !isNonEmptyString(value))) {
      throw new Error("创建内容缺少必要字段，请先补全表单。")
    }
  }
}

function buildHistoryDirname(userId: string, at: Date): string {
  const compactTimestamp = `${at.toISOString().replace(/[-:]/g, "").slice(0, 15)}Z`
  const rand6 = randomBytes(3).toString("hex")

  return `${compactTimestamp}__${userId}__${rand6}`
}

function createMetaRecord(
  contentId: string,
  contentType: SynapseContentType,
  identity: SynapseContentAuthor,
  createdAt: string,
): SynapseContentMetaRecord {
  return {
    schemaVersion: 1,
    id: contentId,
    type: contentType,
    createdBy: identity.userId,
    createdByDisplayName: identity.displayName,
    createdAt,
  }
}

function createSnapshotRecord(
  payload: ContentCreatePayload | ContentUpdatePayload,
  identity: SynapseContentAuthor,
  modifiedAt: string,
  deleted: boolean,
): SynapseContentSnapshotRecord {
  const payloadName = (payload as { name?: unknown }).name
  const trimmedName = typeof payloadName === "string" ? payloadName.trim() : ""

  return {
    schemaVersion: 1,
    title: payload.title.trim(),
    ...(trimmedName.length > 0 ? { name: trimmedName } : {}),
    description: payload.description.trim(),
    category: payload.category.trim(),
    icon: payload.icon.trim(),
    iconBg: payload.iconBg.trim(),
    iconType: payload.iconType || "icon",
    ...(payload.iconImage ? { iconImage: payload.iconImage.trim() } : {}),
    modifiedBy: identity.userId,
    modifiedByDisplayName: identity.displayName,
    modifiedAt,
    deleted,
  }
}

function createAttachmentsRecord(
  files: SynapseContentAttachmentRecord[],
): SynapseContentAttachmentsRecord {
  return {
    schemaVersion: 1,
    files,
  }
}

async function writeJsonFile(filePath: string, value: unknown): Promise<void> {
  await mkdir(path.dirname(filePath), { recursive: true })
  await writeFile(filePath, `${JSON.stringify(value, null, 2)}\n`, "utf8")
}

async function writeIconImageFile(
  contentDirectoryPath: string,
  imageBytes: Uint8Array,
): Promise<string> {
  const filePath = path.join(contentDirectoryPath, ICON_IMAGE_FILE_NAME)
  await mkdir(contentDirectoryPath, { recursive: true })
  await writeFile(filePath, imageBytes)
  return filePath
}

async function createTemporaryDirectory(parentPath: string, prefix: string): Promise<string> {
  await mkdir(parentPath, { recursive: true })
  return mkdtemp(path.join(parentPath, prefix))
}

async function stageHistoryDirectory(
  contentDirectoryPath: string,
  historyDirname: string,
  snapshot: SynapseContentSnapshotRecord,
  mainContent: string,
  attachments: SynapseContentAttachmentRecord[],
): Promise<string> {
  const historyRootPath = path.join(contentDirectoryPath, HISTORY_DIRECTORY_NAME)
  const tempDirectoryPath = await createTemporaryDirectory(historyRootPath, ".synapse-history-")

  try {
    const tempHistoryPath = path.join(tempDirectoryPath, historyDirname)

    await mkdir(tempHistoryPath, { recursive: true })
    await writeJsonFile(path.join(tempHistoryPath, SNAPSHOT_FILE_NAME), snapshot)
    await writeFile(path.join(tempHistoryPath, CONTENT_MAIN_FILE_NAME), normalizeMarkdownContent(mainContent), "utf8")
    await writeJsonFile(
      path.join(tempHistoryPath, CONTENT_ATTACHMENTS_FILE_NAME),
      createAttachmentsRecord(attachments),
    )

    const targetHistoryPath = path.join(historyRootPath, historyDirname)
    await rename(tempHistoryPath, targetHistoryPath)
    await rm(tempDirectoryPath, { recursive: true, force: true })

    return targetHistoryPath
  } catch (error) {
    await rm(tempDirectoryPath, { recursive: true, force: true })
    throw error
  }
}

async function getActiveRepositoryWriteContext(
  identity: SynapseContentAuthor,
): Promise<ActiveRepositoryWriteContext> {
  const config = await configStore.load()
  const repository = getActiveRepositoryConfig(config)

  if (!repository) {
    throw new Error("当前还没有激活的本地目录。")
  }

  const repositoryState = await repositoryStore.getRepositoryState(repository)

  if (repositoryState.status !== "ready") {
    throw new Error("当前目录不存在，不能写入内容。")
  }

  return {
    repositoryRootPath: repositoryState.gitRootPath ?? repository.localPath,
    identity,
    repository,
  }
}

async function resolveAttachmentRecords(
  context: ActiveRepositoryWriteContext,
  contentType: SynapseContentType,
  payload: ContentCreatePayload | ContentUpdatePayload,
  baseline: SynapseContentDetail | null,
): Promise<{
  attachments: SynapseContentAttachmentRecord[]
  createdPaths: string[]
}> {
  if (!getContentTypeDefinition(contentType).capabilities.hasAttachments) {
    return {
      attachments: baseline?.attachments ?? [],
      createdPaths: [],
    }
  }

  const skillPayload = payload as SynapseCreateSkillPayload | SynapseUpdateSkillPayload
  const existingAttachmentsBySha = new Map(
    (baseline?.attachments ?? []).map((attachment) => [attachment.sha256, attachment] as const),
  )
  const nextAttachments: SynapseContentAttachmentRecord[] = []
  const pendingWrites = skillPayload.files.filter((file) => !file.sha256 || file.bytes)
  const written = await attachmentsPoolService.writeAttachments(
    context.repositoryRootPath,
    pendingWrites
      .map((file) => {
        if (!file.bytes) {
          return null
        }

        return {
          originalName: file.originalName,
          size: file.size,
          bytes: file.bytes,
        }
      })
      .filter((file): file is { originalName: string; size: number; bytes: Uint8Array } => file !== null),
  )

  for (const file of skillPayload.files) {
    if (file.sha256 && !file.bytes) {
      const existingAttachment = existingAttachmentsBySha.get(file.sha256)

      if (!existingAttachment) {
        throw new Error(`找不到已有附件：${file.originalName}`)
      }

      nextAttachments.push({
        ...existingAttachment,
        originalName: file.originalName,
        size: file.size,
      })
      continue
    }

    const createdAttachment = written.records.find(
      (attachment) => attachment.originalName === file.originalName,
    )

    if (!createdAttachment) {
      throw new Error(`写入附件失败：${file.originalName}`)
    }

    nextAttachments.push(createdAttachment)
  }

  return {
    attachments: nextAttachments,
    createdPaths: written.createdPaths,
  }
}

class ContentWriteService {
  async createContent(
    request: SynapseCreateContentRequest,
    identity: SynapseContentAuthor,
  ): Promise<ContentWriteResult> {
    assertRequiredCreateFields(request.payload)

    if (getContentTypeDefinition(request.contentType).requiresFilesInPayload && !("files" in request.payload)) {
      throw new Error(`${getContentTypeDefinition(request.contentType).singularLabel} 创建必须带 files 字段。`)
    }

    return this.createContentInternal(request.contentType, request.payload, identity)
  }

  async updateContent(
    request: SynapseUpdateContentRequest,
    identity: SynapseContentAuthor,
  ): Promise<ContentWriteResult> {
    assertRequiredCreateFields(request.payload)

    if (getContentTypeDefinition(request.contentType).requiresFilesInPayload && !("files" in request.payload)) {
      throw new Error(`${getContentTypeDefinition(request.contentType).singularLabel} 更新必须带 files 字段。`)
    }

    return this.writeNextHistory(request.contentType, request.payload.id, request.payload, identity, false)
  }

  async createRule(
    payload: SynapseCreateRulePayload,
    identity: SynapseContentAuthor,
  ): Promise<ContentWriteResult> {
    return this.createContent({
      contentType: "rule",
      payload,
    }, identity)
  }

  async createSkill(
    payload: SynapseCreateSkillPayload,
    identity: SynapseContentAuthor,
  ): Promise<ContentWriteResult> {
    return this.createContent({
      contentType: "skill",
      payload,
    }, identity)
  }

  async updateRule(
    payload: SynapseUpdateRulePayload,
    identity: SynapseContentAuthor,
  ): Promise<ContentWriteResult> {
    return this.updateContent({
      contentType: "rule",
      payload,
    }, identity)
  }

  async updateSkill(
    payload: SynapseUpdateSkillPayload,
    identity: SynapseContentAuthor,
  ): Promise<ContentWriteResult> {
    return this.updateContent({
      contentType: "skill",
      payload,
    }, identity)
  }

  async deleteContent(
    contentType: SynapseContentType,
    contentId: string,
    identity: SynapseContentAuthor,
  ): Promise<ContentWriteResult> {
    const context = await getActiveRepositoryWriteContext(identity)
    const baseline = await contentHistoryService.readCurrentDetail(
      context.repository,
      contentType,
      contentId,
    )

    if (!baseline) {
      throw new Error(`找不到对应的 ${getContentTypeDefinition(contentType).singularLabel} 内容。`)
    }

    const modifiedAt = new Date().toISOString()
    const historyDirname = buildHistoryDirname(identity.userId, new Date(modifiedAt))
    const contentDirectoryPath = resolveContentDirectoryPath(context.repository, contentType, contentId)
    const snapshot = createSnapshotRecord(
      {
        title: baseline.title,
        ...(baseline.name ? { name: baseline.name } : {}),
        description: baseline.description,
        category: baseline.category,
        icon: baseline.icon,
        iconBg: baseline.iconBg,
        content: baseline.content,
      } as ContentCreatePayload,
      identity,
      modifiedAt,
      true,
    )

    const historyPath = await stageHistoryDirectory(
      contentDirectoryPath,
      historyDirname,
      snapshot,
      baseline.content,
      baseline.attachments,
    )

    return {
      gitPaths: [contentDirectoryPath, historyPath],
      id: contentId,
      latestHistoryDirname: historyDirname,
      modifiedAt,
      title: baseline.title,
      type: contentType,
    }
  }

  async readLatestHistoryDirname(
    contentType: SynapseContentType,
    contentId: string,
    identity: SynapseContentAuthor,
  ): Promise<string | null> {
    const context = await getActiveRepositoryWriteContext(identity)
    const summary = await contentHistoryService.readCurrentSummary(
      context.repository,
      contentType,
      contentId,
    )

    return summary?.latestHistoryDirname ?? null
  }

  private async createContentInternal(
    contentType: SynapseContentType,
    payload: ContentCreatePayload,
    identity: SynapseContentAuthor,
  ): Promise<ContentWriteResult> {
    const context = await getActiveRepositoryWriteContext(identity)
    const contentId = randomUUID().replace(/-/g, "")
    const createdAt = new Date().toISOString()
    const historyDirname = buildHistoryDirname(identity.userId, new Date(createdAt))
    const contentRootPath = resolveContentRootPath(context.repository, contentType)
    const tempDirectoryPath = await createTemporaryDirectory(contentRootPath, ".synapse-content-")
    const targetDirectoryPath = resolveContentDirectoryPath(context.repository, contentType, contentId)
    const attachmentsResult = await resolveAttachmentRecords(context, contentType, payload, null)

    try {
      await writeJsonFile(
        path.join(tempDirectoryPath, CONTENT_META_FILE_NAME),
        createMetaRecord(contentId, contentType, identity, createdAt),
      )
      await writeJsonFile(
        path.join(tempDirectoryPath, HISTORY_DIRECTORY_NAME, historyDirname, SNAPSHOT_FILE_NAME),
        createSnapshotRecord(payload, identity, createdAt, false),
      )
      await writeFile(
        path.join(tempDirectoryPath, HISTORY_DIRECTORY_NAME, historyDirname, CONTENT_MAIN_FILE_NAME),
        normalizeMarkdownContent(payload.content.trim()),
        "utf8",
      )
      await writeJsonFile(
        path.join(tempDirectoryPath, HISTORY_DIRECTORY_NAME, historyDirname, CONTENT_ATTACHMENTS_FILE_NAME),
        createAttachmentsRecord(attachmentsResult.attachments),
      )

      await rename(tempDirectoryPath, targetDirectoryPath)
    } catch (error) {
      await rm(tempDirectoryPath, { recursive: true, force: true })
      throw error
    }

    const extraGitPaths: string[] = []

    if (payload.iconImageBytes) {
      const iconPath = await writeIconImageFile(targetDirectoryPath, payload.iconImageBytes)
      extraGitPaths.push(iconPath)
    }

    logger.info("Created new content snapshot.", {
      contentId,
      contentType,
      historyDirname,
      repositoryUuid: context.repository.uuid,
    })

    return {
      gitPaths: [targetDirectoryPath, ...attachmentsResult.createdPaths, ...extraGitPaths],
      id: contentId,
      latestHistoryDirname: historyDirname,
      modifiedAt: createdAt,
      title: payload.title.trim(),
      type: contentType,
    }
  }

  private async writeNextHistory(
    contentType: SynapseContentType,
    contentId: string,
    payload: ContentUpdatePayload,
    identity: SynapseContentAuthor,
    deleted: boolean,
  ): Promise<ContentWriteResult> {
    const context = await getActiveRepositoryWriteContext(identity)
    const baseline = await contentHistoryService.readCurrentDetail(
      context.repository,
      contentType,
      contentId,
    )

    if (!baseline) {
      throw new Error(`找不到对应的 ${getContentTypeDefinition(contentType).singularLabel} 内容。`)
    }

    const modifiedAt = new Date().toISOString()
    const historyDirname = buildHistoryDirname(identity.userId, new Date(modifiedAt))
    const contentDirectoryPath = resolveContentDirectoryPath(context.repository, contentType, contentId)
    const snapshot = createSnapshotRecord(payload, identity, modifiedAt, deleted)
    const attachmentsResult = await resolveAttachmentRecords(context, contentType, payload, baseline)
    const historyPath = await stageHistoryDirectory(
      contentDirectoryPath,
      historyDirname,
      snapshot,
      payload.content.trim(),
      attachmentsResult.attachments,
    )

    logger.info("Wrote content history snapshot.", {
      contentId,
      contentType,
      historyDirname,
      repositoryUuid: context.repository.uuid,
    })

    const extraGitPaths: string[] = []

    if (payload.iconImageBytes) {
      const iconPath = await writeIconImageFile(contentDirectoryPath, payload.iconImageBytes)
      extraGitPaths.push(iconPath)
    }

    return {
      gitPaths: [historyPath, ...attachmentsResult.createdPaths, ...extraGitPaths],
      id: contentId,
      latestHistoryDirname: historyDirname,
      modifiedAt,
      title: payload.title.trim(),
      type: contentType,
    }
  }
}

const contentWriteService = new ContentWriteService()

export {
  buildHistoryDirname,
  contentWriteService,
  getActiveRepositoryWriteContext,
  type ActiveRepositoryWriteContext,
  type ContentWriteResult,
}
