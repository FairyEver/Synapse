import path from "node:path"
import { getContentTypeDefinition } from "../../src/config/content-types"
import { getActiveRepositoryConfig } from "../../src/lib/config"
import type { SynapseRepositoryConfig } from "../../src/types/config"
import type {
  SynapseContentDetail,
  SynapseContentHistoryEntry,
  SynapseContentHistoryVersion,
  SynapseContentMeta,
  SynapseContentType,
  SynapseTextContentFile,
} from "../../src/types/content"
import { contentHistoryService } from "./content-history-service"
import { contentIndexService } from "./content-index-service"
import { configStore } from "./config-store"

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
    throw new Error("当前还没有激活的本地目录。")
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

    await contentIndexService.syncIndex(context.repository)
    return contentIndexService.listContent(context.repository, contentType) as Promise<SynapseContentMeta<T>[]>
  }

  async getContent(contentType: SynapseContentType, contentId: string): Promise<SynapseTextContentFile> {
    const detail = await readCurrentDetail(contentType, contentId)

    return createTextFile("main.md", detail.content)
  }

  async getDetail(contentType: SynapseContentType, contentId: string): Promise<SynapseContentDetail> {
    return readCurrentDetail(contentType, contentId)
  }

  async getHistory(
    contentType: SynapseContentType,
    contentId: string,
  ): Promise<SynapseContentHistoryEntry[]> {
    const context = await getActiveRepositoryContext()

    if (!context) {
      return []
    }

    return contentHistoryService.listHistory(context.repository, contentType, contentId)
  }

  async getHistoryVersion(
    contentType: SynapseContentType,
    contentId: string,
    historyDirname: string,
  ): Promise<SynapseContentHistoryVersion> {
    const context = await getActiveRepositoryContext()

    if (!context) {
      throw new Error("当前还没有激活的本地目录。")
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

    return version
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

  async getRuleHistory(ruleId: string): Promise<SynapseContentHistoryEntry[]> {
    return this.getHistory("rule", ruleId)
  }

  async getSkillHistory(skillId: string): Promise<SynapseContentHistoryEntry[]> {
    return this.getHistory("skill", skillId)
  }

  async getRuleHistoryVersion(
    ruleId: string,
    historyDirname: string,
  ): Promise<SynapseContentHistoryVersion> {
    return this.getHistoryVersion("rule", ruleId, historyDirname)
  }

  async getSkillHistoryVersion(
    skillId: string,
    historyDirname: string,
  ): Promise<SynapseContentHistoryVersion> {
    return this.getHistoryVersion("skill", skillId, historyDirname)
  }
}

const contentService = new ContentService()

export { contentService }
