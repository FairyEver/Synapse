import path from "node:path"
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
    throw new Error(contentType === "rule" ? "找不到对应的 Rule 内容。" : "找不到对应的 Skill 内容。")
  }

  return detail
}

class ContentService {
  async getRules(): Promise<SynapseContentMeta[]> {
    const context = await getActiveRepositoryContext()

    if (!context) {
      return []
    }

    await contentIndexService.syncIndex(context.repository)
    return contentIndexService.listContent(context.repository, "rule")
  }

  async getSkills(): Promise<SynapseContentMeta[]> {
    const context = await getActiveRepositoryContext()

    if (!context) {
      return []
    }

    await contentIndexService.syncIndex(context.repository)
    return contentIndexService.listContent(context.repository, "skill")
  }

  async getRuleContent(ruleId: string): Promise<SynapseTextContentFile> {
    const detail = await readCurrentDetail("rule", ruleId)

    return createTextFile("main.md", detail.content)
  }

  async getSkillContent(skillId: string): Promise<SynapseTextContentFile> {
    const detail = await readCurrentDetail("skill", skillId)

    return createTextFile("main.md", detail.content)
  }

  async getRuleDetail(ruleId: string): Promise<SynapseContentDetail> {
    return readCurrentDetail("rule", ruleId)
  }

  async getSkillDetail(skillId: string): Promise<SynapseContentDetail> {
    return readCurrentDetail("skill", skillId)
  }

  async getRuleHistory(ruleId: string): Promise<SynapseContentHistoryEntry[]> {
    const context = await getActiveRepositoryContext()

    if (!context) {
      return []
    }

    return contentHistoryService.listHistory(context.repository, "rule", ruleId)
  }

  async getSkillHistory(skillId: string): Promise<SynapseContentHistoryEntry[]> {
    const context = await getActiveRepositoryContext()

    if (!context) {
      return []
    }

    return contentHistoryService.listHistory(context.repository, "skill", skillId)
  }

  async getRuleHistoryVersion(
    ruleId: string,
    historyDirname: string,
  ): Promise<SynapseContentHistoryVersion> {
    const context = await getActiveRepositoryContext()

    if (!context) {
      throw new Error("当前还没有激活的本地目录。")
    }

    const version = await contentHistoryService.readHistoryVersion(
      context.repository,
      "rule",
      ruleId,
      historyDirname,
    )

    if (!version) {
      throw new Error("这条历史记录已不可用。")
    }

    return version
  }

  async getSkillHistoryVersion(
    skillId: string,
    historyDirname: string,
  ): Promise<SynapseContentHistoryVersion> {
    const context = await getActiveRepositoryContext()

    if (!context) {
      throw new Error("当前还没有激活的本地目录。")
    }

    const version = await contentHistoryService.readHistoryVersion(
      context.repository,
      "skill",
      skillId,
      historyDirname,
    )

    if (!version) {
      throw new Error("这条历史记录已不可用。")
    }

    return version
  }
}

const contentService = new ContentService()

export { contentService }
