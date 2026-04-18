import { randomBytes, randomUUID } from "node:crypto"
import { mkdir, mkdtemp, rename, rm, writeFile } from "node:fs/promises"
import path from "node:path"
import { getActiveRepositoryConfig } from "../../src/lib/config"
import type { SynapseRepositoryConfig } from "../../src/types/config"
import type {
  SynapseContentAttachmentRecord,
  SynapseContentAttachmentsRecord,
  SynapseContentDetail,
  SynapseContentMetaRecord,
  SynapseContentSnapshotRecord,
  SynapseContentType,
  SynapseCreateRulePayload,
  SynapseCreateSkillPayload,
  SynapseUpdateRulePayload,
  SynapseUpdateSkillPayload,
} from "../../src/types/content"
import type { SynapseUserIdentity } from "../../src/types/identity"
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
const logger = createMainLogger("service.content-write")

type ActiveRepositoryWriteContext = {
  gitRootPath: string
  identity: SynapseUserIdentity
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

type ContentCreatePayload = SynapseCreateRulePayload | SynapseCreateSkillPayload
type ContentUpdatePayload = SynapseUpdateRulePayload | SynapseUpdateSkillPayload

function normalizeMarkdownContent(content: string): string {
  return content.endsWith("\n") ? content : `${content}\n`
}

function isNonEmptyString(value: string): boolean {
  return value.trim().length > 0
}

function assertRequiredCreateFields(payload: ContentCreatePayload | ContentUpdatePayload): void {
  const requiredFields = [
    payload.title,
    payload.description,
    payload.category,
    payload.icon,
    payload.iconBg,
    payload.content,
  ]

  if (requiredFields.some((value) => !isNonEmptyString(value))) {
    throw new Error("创建内容缺少必要字段，请先补全表单。")
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
  identity: SynapseUserIdentity,
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
  identity: SynapseUserIdentity,
  modifiedAt: string,
  deleted: boolean,
): SynapseContentSnapshotRecord {
  return {
    schemaVersion: 1,
    title: payload.title.trim(),
    description: payload.description.trim(),
    category: payload.category.trim(),
    icon: payload.icon.trim(),
    iconBg: payload.iconBg.trim(),
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
  identity: SynapseUserIdentity,
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

  if (!repositoryState.isGitRepository || !repositoryState.gitRootPath) {
    throw new Error("当前目录不是 Git 仓库，不能写入内容。")
  }

  return {
    gitRootPath: repositoryState.gitRootPath,
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
  if (contentType === "rule") {
    return {
      attachments: baseline?.attachments ?? [],
      createdPaths: [],
    }
  }

  const skillPayload = payload as SynapseCreateSkillPayload | SynapseUpdateSkillPayload
  const written = await attachmentsPoolService.writeAttachments(context.gitRootPath, skillPayload.files)

  return {
    attachments: written.records,
    createdPaths: written.createdPaths,
  }
}

class ContentWriteService {
  async createRule(
    payload: SynapseCreateRulePayload,
    identity: SynapseUserIdentity,
  ): Promise<ContentWriteResult> {
    assertRequiredCreateFields(payload)
    return this.createContent("rule", payload, identity)
  }

  async createSkill(
    payload: SynapseCreateSkillPayload,
    identity: SynapseUserIdentity,
  ): Promise<ContentWriteResult> {
    assertRequiredCreateFields(payload)
    return this.createContent("skill", payload, identity)
  }

  async updateRule(
    payload: SynapseUpdateRulePayload,
    identity: SynapseUserIdentity,
  ): Promise<ContentWriteResult> {
    assertRequiredCreateFields(payload)
    return this.writeNextHistory("rule", payload.id, payload, identity, false)
  }

  async updateSkill(
    payload: SynapseUpdateSkillPayload,
    identity: SynapseUserIdentity,
  ): Promise<ContentWriteResult> {
    assertRequiredCreateFields(payload)
    return this.writeNextHistory("skill", payload.id, payload, identity, false)
  }

  async deleteContent(
    contentType: SynapseContentType,
    contentId: string,
    identity: SynapseUserIdentity,
  ): Promise<ContentWriteResult> {
    const context = await getActiveRepositoryWriteContext(identity)
    const baseline = await contentHistoryService.readCurrentDetail(
      context.repository,
      contentType,
      contentId,
    )

    if (!baseline) {
      throw new Error(contentType === "rule" ? "找不到对应的 Rule 内容。" : "找不到对应的 Skill 内容。")
    }

    const modifiedAt = new Date().toISOString()
    const historyDirname = buildHistoryDirname(identity.userId, new Date(modifiedAt))
    const contentDirectoryPath = resolveContentDirectoryPath(context.repository, contentType, contentId)
    const snapshot = createSnapshotRecord(
      {
        title: baseline.title,
        description: baseline.description,
        category: baseline.category,
        icon: baseline.icon,
        iconBg: baseline.iconBg,
        content: baseline.content,
      },
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
    identity: SynapseUserIdentity,
  ): Promise<string | null> {
    const context = await getActiveRepositoryWriteContext(identity)
    const summary = await contentHistoryService.readCurrentSummary(
      context.repository,
      contentType,
      contentId,
    )

    return summary?.latestHistoryDirname ?? null
  }

  private async createContent(
    contentType: SynapseContentType,
    payload: ContentCreatePayload,
    identity: SynapseUserIdentity,
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

    logger.info("Created new content snapshot.", {
      contentId,
      contentType,
      historyDirname,
      repositoryUuid: context.repository.uuid,
    })

    return {
      gitPaths: [targetDirectoryPath, ...attachmentsResult.createdPaths],
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
    identity: SynapseUserIdentity,
    deleted: boolean,
  ): Promise<ContentWriteResult> {
    const context = await getActiveRepositoryWriteContext(identity)
    const baseline = await contentHistoryService.readCurrentDetail(
      context.repository,
      contentType,
      contentId,
    )

    if (!baseline) {
      throw new Error(contentType === "rule" ? "找不到对应的 Rule 内容。" : "找不到对应的 Skill 内容。")
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

    return {
      gitPaths: [historyPath, ...attachmentsResult.createdPaths],
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
