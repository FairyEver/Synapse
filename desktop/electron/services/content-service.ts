import { readFile, stat } from "node:fs/promises"
import path from "node:path"
import { getContentTypeDefinition } from "../../src/config/content-types"
import {
  iconPromptTemplateForRule,
  iconPromptTemplateForSkill,
  iconPromptTemplateForPrompt,
} from "../../src/config/content-types/icon-prompt-templates"
import { normalizeContentAttachmentPath } from "../../src/lib/content-attachments"
import { getActiveRepositoryConfig } from "../../src/lib/config"
import type { SynapseRepositoryConfig } from "../../src/types/config"
import type {
  SynapseContentFile,
  SynapseContentDetail,
  SynapseContentMeta,
  SynapseContentType,
  SynapseTextContentFile,
} from "../../src/types/content"
import { attachmentsPoolService } from "./attachments-pool-service"
import { contentHistoryService, resolveContentDirectoryPath } from "./content-history-service"
import { contentIndexService } from "./content-index-service"
import { configStore } from "./config-store"
import { CONTENT_ICON_IMAGE_MAX_BYTES } from "./content-capability-validator"
import { createMainLogger } from "./log-store"
import { repositoryStore } from "./repository-store"

const logger = createMainLogger("service.content")

type ActiveRepositoryContext = {
  repository: SynapseRepositoryConfig
}

function createTextFile(relativePath: string, content: string): SynapseTextContentFile {
  return {
    relativePath,
    name: path.basename(relativePath),
    size: Buffer.byteLength(content),
    kind: "text",
    content,
  }
}

async function getActiveRepositoryContext(): Promise<ActiveRepositoryContext | null> {
  const config = await configStore.load()
  const repository = getActiveRepositoryConfig(config)

  if (!repository) {
    return null
  }

  return {
    repository,
  }
}

async function readCurrentDetail(
  contentType: SynapseContentType,
  contentId: string,
): Promise<SynapseContentDetail> {
  const context = await getActiveRepositoryContext()

  if (!context) {
    throw new Error("当前还没有选中的本地目录。")
  }

  const detail = await contentHistoryService.readCurrentDetail(
    context.repository,
    contentType,
    contentId,
  )

  if (!detail) {
    throw new Error(`找不到对应的 ${getContentTypeDefinition(contentType).singularLabel} 内容。`)
  }

  return detail
}

class ContentService {
  async listContent<T extends SynapseContentType>(contentType: T): Promise<SynapseContentMeta<T>[]> {
    const context = await getActiveRepositoryContext()

    if (!context) {
      return []
    }

    try {
      await contentIndexService.syncIndex(context.repository)
      return contentIndexService.listContent(context.repository, contentType) as Promise<SynapseContentMeta<T>[]>
    } catch (error) {
      logger.warn("Failed to load repository content, returning empty list.", { contentType, error })
      return []
    }
  }

  async listDeletedContent<T extends SynapseContentType>(contentType: T): Promise<SynapseContentMeta<T>[]> {
    const context = await getActiveRepositoryContext()

    if (!context) {
      return []
    }

    try {
      await contentIndexService.syncIndex(context.repository)
      return contentIndexService.listDeletedContent(context.repository, contentType) as Promise<SynapseContentMeta<T>[]>
    } catch (error) {
      logger.warn("Failed to load deleted repository content, returning empty list.", { contentType, error })
      return []
    }
  }

  async getContent(contentType: SynapseContentType, contentId: string): Promise<SynapseTextContentFile> {
    const detail = await readCurrentDetail(contentType, contentId)

    return createTextFile("main.md", detail.content)
  }

  async getDetail(contentType: SynapseContentType, contentId: string): Promise<SynapseContentDetail> {
    return readCurrentDetail(contentType, contentId)
  }

  async getAttachmentFile(
    contentType: SynapseContentType,
    contentId: string,
    historyDirname: string,
    originalName: string,
  ): Promise<SynapseContentFile | null> {
    const context = await getActiveRepositoryContext()

    if (!context) {
      throw new Error("当前还没有选中的本地目录。")
    }

    const version = await contentHistoryService.readHistoryVersion(
      context.repository,
      contentType,
      contentId,
      historyDirname,
    )

    if (!version) {
      throw new Error("这条历史记录已不可用。")
    }

    const normalizedName = normalizeContentAttachmentPath(originalName)
    const attachment = version.attachments.find((candidate) => (
      normalizeContentAttachmentPath(candidate.originalName) === normalizedName
    ))

    if (!attachment) {
      return null
    }

    const repositoryState = await repositoryStore.getRepositoryState(context.repository)

    if (repositoryState.status !== "ready") {
      throw new Error("当前目录不存在，请先在 Settings 里重新选择本地目录。")
    }

    return attachmentsPoolService.readAttachmentFile(repositoryState.gitRootPath ?? context.repository.localPath, attachment)
  }

  async getRules(): Promise<SynapseContentMeta<"rule">[]> {
    return this.listContent("rule")
  }

  async getSkills(): Promise<SynapseContentMeta<"skill">[]> {
    return this.listContent("skill")
  }

  async getRuleContent(ruleId: string): Promise<SynapseTextContentFile> {
    return this.getContent("rule", ruleId)
  }

  async getSkillContent(skillId: string): Promise<SynapseTextContentFile> {
    return this.getContent("skill", skillId)
  }

  async getRuleDetail(ruleId: string): Promise<SynapseContentDetail<"rule">> {
    return this.getDetail("rule", ruleId) as Promise<SynapseContentDetail<"rule">>
  }

  async getSkillDetail(skillId: string): Promise<SynapseContentDetail<"skill">> {
    return this.getDetail("skill", skillId) as Promise<SynapseContentDetail<"skill">>
  }

  async readIconImage(
    contentType: SynapseContentType,
    contentId: string,
  ): Promise<string | null> {
    const context = await getActiveRepositoryContext()

    if (!context) {
      return null
    }

    const contentDir = resolveContentDirectoryPath(context.repository, contentType, contentId)
    const iconPath = path.join(contentDir, "icon.png")

    try {
      const info = await stat(iconPath)
      if (!info.isFile()) {
        logger.warn("Skipped content icon image because icon.png is not a file.", { contentType, contentId })
        return null
      }
      if (info.size > CONTENT_ICON_IMAGE_MAX_BYTES) {
        logger.warn("Skipped oversized content icon image.", {
          contentType,
          contentId,
          maxBytes: CONTENT_ICON_IMAGE_MAX_BYTES,
          size: info.size,
        })
        return null
      }
      const buffer = await readFile(iconPath)
      return `data:image/png;base64,${buffer.toString("base64")}`
    } catch {
      return null
    }
  }

  private static readonly ICON_PROMPT_TEMPLATES: Record<SynapseContentType, string> = {
    rule: iconPromptTemplateForRule,
    skill: iconPromptTemplateForSkill,
    prompt: iconPromptTemplateForPrompt,
  }

  async getIconPromptTemplate(
    contentType: SynapseContentType,
    contentId: string,
  ): Promise<string | null> {
    const template = ContentService.ICON_PROMPT_TEMPLATES[contentType]
    if (!template) {
      return null
    }

    let detail: SynapseContentDetail
    try {
      detail = await this.getDetail(contentType, contentId)
    } catch {
      return null
    }

    return template
      .replace(/{{TITLE}}/g, detail.title || "")
      .replace(/{{CONTENT}}/g, detail.content || "")
  }
}

const contentService = new ContentService()

export { contentService }
