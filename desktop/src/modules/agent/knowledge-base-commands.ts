import type { SynapseAgentPublishedCommand } from "@/types/agent"
import type { KnowledgeBaseComposerAction } from "./components/knowledge-base-action-menu"
import type { AgentSlashCandidate } from "./slash-menu"

type KnowledgeBaseQuickAction = {
  readonly label: string
  readonly action: "send" | "insert"
  readonly insertText?: string
}

export type KnowledgeBaseAgentCapability = {
  readonly name: string
  readonly description: string
  readonly slashText?: string
  readonly quickActions?: readonly KnowledgeBaseQuickAction[]
}

export const KNOWLEDGE_BASE_AGENT_CAPABILITIES: readonly KnowledgeBaseAgentCapability[] = [
  knowledgeBaseCapability("autoresearch", "围绕主题研究并写入知识库", {
    label: "研究主题",
    action: "insert",
  }),
  knowledgeBaseCapability("canvas", "创建或更新知识库画布"),
  knowledgeBaseCapability("defuddle", "清理网页正文后用于入库"),
  knowledgeBaseCapability("obsidian-bases", "创建或编辑 Obsidian Bases"),
  knowledgeBaseCapability("obsidian-markdown", "按 Obsidian 语法编写页面"),
  knowledgeBaseCapability("save", "保存当前对话或关键结论", {
    label: "保存对话",
    action: "insert",
  }),
  knowledgeBaseCapability("wiki", "管理知识库结构与热缓存"),
  knowledgeBaseCapability("wiki-fold", "折叠整理知识库日志"),
  knowledgeBaseCapability("wiki-ingest", "汲取资料，整理 .raw 中的新内容", [
    {
      label: "汲取新资料",
      action: "send",
      insertText: "/wiki-ingest ingest all of these .raw sources",
    },
    {
      label: "汲取指定资料",
      action: "insert",
      insertText: "/wiki-ingest .raw/",
    },
  ]),
  knowledgeBaseCapability("wiki-lint", "检查链接、索引、孤立页面和结构问题", {
    label: "检查知识库",
    action: "send",
  }),
  knowledgeBaseCapability("wiki-query", "查询知识库并基于已有页面回答", {
    label: "查询知识库",
    action: "insert",
  }),
]

const KNOWLEDGE_BASE_QUICK_ACTION_ORDER = [
  "wiki-ingest",
  "wiki-query",
  "save",
  "autoresearch",
  "wiki-lint",
] as const

export function toKnowledgeBaseSlashCandidates(
  capabilities: readonly KnowledgeBaseAgentCapability[] = KNOWLEDGE_BASE_AGENT_CAPABILITIES,
): AgentSlashCandidate[] {
  return capabilities.flatMap((item) => {
    const name = item.name.trim().replace(/^\/+/, "")
    const description = item.description.trim()
    const insertText = knowledgeBaseSlashText(item)
    if (!name || !description || !insertText.trim()) return []
    return [{
      name,
      description,
      kind: "knowledgeBase" as const,
      insertText,
    }]
  })
}

export function toKnowledgeBaseComposerActions(
  capabilities: readonly KnowledgeBaseAgentCapability[] = KNOWLEDGE_BASE_AGENT_CAPABILITIES,
): KnowledgeBaseComposerAction[] {
  const byName = new Map(capabilities.map((item) => [item.name, item]))
  return KNOWLEDGE_BASE_QUICK_ACTION_ORDER.flatMap((name) => {
    const item = byName.get(name)
    if (!item?.quickActions) return []
    return item.quickActions.flatMap((quickAction) => {
      const label = quickAction.label.trim()
      const commandText = (quickAction.insertText ?? knowledgeBaseSlashText(item)).trimEnd()
      if (!label || !commandText) return []
      return [{
        label,
        description: item.description,
        action: quickAction.action,
        commandText: `${commandText} `,
      }]
    })
  })
}

export function knowledgeBaseStaticCommands(): SynapseAgentPublishedCommand[] {
  return KNOWLEDGE_BASE_AGENT_CAPABILITIES.map((item) => ({
    name: item.name,
    description: item.description,
    source: "builtin",
    kind: "prompt",
    adminOnly: false,
    ui: item.quickActions?.[0]
      ? {
          group: "knowledge-base",
          label: item.quickActions[0].label,
          action: item.quickActions[0].action,
          insertText: item.quickActions[0].insertText ?? knowledgeBaseSlashText(item),
        }
      : {
          group: "knowledge-base",
          insertText: knowledgeBaseSlashText(item),
        },
  }))
}

function knowledgeBaseCapability(
  name: string,
  description: string,
  quickActions?: KnowledgeBaseQuickAction | readonly KnowledgeBaseQuickAction[],
): KnowledgeBaseAgentCapability {
  return {
    name,
    description,
    slashText: `/${name} `,
    quickActions: normalizeKnowledgeBaseQuickActions(quickActions),
  }
}

function normalizeKnowledgeBaseQuickActions(
  quickActions?: KnowledgeBaseQuickAction | readonly KnowledgeBaseQuickAction[],
): readonly KnowledgeBaseQuickAction[] | undefined {
  if (!quickActions) return undefined
  return Array.isArray(quickActions) ? quickActions : [quickActions]
}

function knowledgeBaseSlashText(item: KnowledgeBaseAgentCapability): string {
  return item.slashText ?? `/${item.name.replace(/^\/+/, "")} `
}
