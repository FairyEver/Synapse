import { readFile } from "node:fs/promises"
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
import { builtinContentService } from "./builtin-content-service"
import { contentHistoryService, resolveContentDirectoryPath } from "./content-history-service"
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
    const builtinItems = await builtinContentService.listContent(contentType)
    const context = await getActiveRepositoryContext()

    if (!context) {
      return builtinItems
    }

    await contentIndexService.syncIndex(context.repository)
    const repositoryItems = await contentIndexService.listContent(context.repository, contentType) as SynapseContentMeta<T>[]

    return [...builtinItems, ...repositoryItems]
  }

  async listDeletedContent<T extends SynapseContentType>(contentType: T): Promise<SynapseContentMeta<T>[]> {
    const context = await getActiveRepositoryContext()

    if (!context) {
      return []
    }

    await contentIndexService.syncIndex(context.repository)
    return contentIndexService.listDeletedContent(context.repository, contentType) as Promise<SynapseContentMeta<T>[]>
  }

  async getContent(contentType: SynapseContentType, contentId: string): Promise<SynapseTextContentFile> {
    if (builtinContentService.isBuiltinContentId(contentId)) {
      return builtinContentService.getContent(contentType, contentId)
    }

    const detail = await readCurrentDetail(contentType, contentId)

    return createTextFile("main.md", detail.content)
  }

  async getDetail(contentType: SynapseContentType, contentId: string): Promise<SynapseContentDetail> {
    if (builtinContentService.isBuiltinContentId(contentId)) {
      return builtinContentService.getDetail(contentType, contentId)
    }

    return readCurrentDetail(contentType, contentId)
  }

  async getHistory(
    contentType: SynapseContentType,
    contentId: string,
  ): Promise<SynapseContentHistoryEntry[]> {
    if (builtinContentService.isBuiltinContentId(contentId)) {
      return builtinContentService.getHistory(contentType, contentId)
    }

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
    if (builtinContentService.isBuiltinContentId(contentId)) {
      return builtinContentService.getHistoryVersion(contentType, contentId, historyDirname)
    }

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

  async readIconImage(
    contentType: SynapseContentType,
    contentId: string,
  ): Promise<string | null> {
    if (builtinContentService.isBuiltinContentId(contentId)) {
      return null
    }

    const context = await getActiveRepositoryContext()

    if (!context) {
      return null
    }

    const contentDir = resolveContentDirectoryPath(context.repository, contentType, contentId)
    const iconPath = path.join(contentDir, "icon.png")

    try {
      const buffer = await readFile(iconPath)
      return `data:image/png;base64,${buffer.toString("base64")}`
    } catch {
      return null
    }
  }

  async getIconPromptTemplate(
    contentType: SynapseContentType,
    contentId: string,
  ): Promise<string | null> {
    // 获取内容详情
    let detail: SynapseContentDetail
    try {
      detail = await this.getDetail(contentType, contentId)
    } catch {
      return null
    }

    // 读取模板文件
    const templatePath = path.join(
      __dirname,
      "..", "..", "..", "src", "config", "content-types", "icon-prompt-templates.md"
    )

    let templateContent: string
    try {
      templateContent = await readFile(templatePath, "utf-8")
    } catch {
      return null
    }

    // 解析对应类型的模板
    const sectionHeader = `请为以下 ${contentType.charAt(0).toUpperCase() + contentType.slice(1)}`
    const sections = templateContent.split(/^---$/m)

    let targetTemplate = ""
    for (const section of sections) {
      if (section.includes(sectionHeader)) {
        targetTemplate = section.trim()
        break
      }
    }

    if (!targetTemplate) {
      return null
    }

    // 替换占位符
    const finalPrompt = targetTemplate
      .replace(/{{TITLE}}/g, detail.title || "")
      .replace(/{{CONTENT}}/g, detail.content || "")

    return finalPrompt
  }
}

const contentService = new ContentService()

export { contentService }
