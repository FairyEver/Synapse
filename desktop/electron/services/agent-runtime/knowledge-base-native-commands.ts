import type { PublishedAgentCommand } from "./command-registry"

export const MANAGED_KNOWLEDGE_BASE_NATIVE_SLASH_COMMAND_NAMES = [
  "autoresearch",
  "canvas",
  "defuddle",
  "obsidian-bases",
  "obsidian-markdown",
  "save",
  "wiki",
  "wiki-fold",
  "wiki-ingest",
  "wiki-lint",
  "wiki-query",
] as const

export const MANAGED_KNOWLEDGE_BASE_NATIVE_SLASH_COMMANDS = new Set<string>(
  MANAGED_KNOWLEDGE_BASE_NATIVE_SLASH_COMMAND_NAMES,
)

export const MANAGED_KNOWLEDGE_BASE_NATIVE_SLASH_PUBLISHED_COMMANDS: readonly PublishedAgentCommand[] = [
  knowledgeBaseNativeCommand("autoresearch", "围绕主题研究并写入知识库"),
  knowledgeBaseNativeCommand("canvas", "创建或更新知识库画布"),
  knowledgeBaseNativeCommand("defuddle", "清理网页正文后用于入库"),
  knowledgeBaseNativeCommand("obsidian-bases", "创建或编辑知识库表格视图"),
  knowledgeBaseNativeCommand("obsidian-markdown", "按知识库 Markdown 语法编写页面"),
  knowledgeBaseNativeCommand("save", "保存当前对话或关键结论"),
  knowledgeBaseNativeCommand("wiki", "管理知识库结构与热缓存"),
  knowledgeBaseNativeCommand("wiki-fold", "折叠整理知识库日志"),
  knowledgeBaseNativeCommand("wiki-ingest", "汲取资料，整理 .raw 中的新内容"),
  knowledgeBaseNativeCommand("wiki-lint", "检查链接、索引、孤立页面和结构问题"),
  knowledgeBaseNativeCommand("wiki-query", "查询知识库并基于已有页面回答"),
]

function knowledgeBaseNativeCommand(
  name: string,
  description: string,
): PublishedAgentCommand {
  return {
    name,
    description,
    source: "agent-native",
    kind: "agent-native",
    adminOnly: false,
    allowedPlatforms: ["local-renderer", "workflow"],
    ui: {
      group: "knowledge-base",
      insertText: `/${name} `,
    },
  }
}
