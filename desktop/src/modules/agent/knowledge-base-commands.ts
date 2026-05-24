import type { SynapseAgentPublishedCommand } from "@/types/agent"

export function knowledgeBaseStaticCommands(): SynapseAgentPublishedCommand[] {
  return [
    {
      name: "wiki ingest",
      description: "汲取 .raw 中的资料",
      source: "builtin",
      kind: "prompt",
      adminOnly: false,
      ui: {
        group: "knowledge-base",
        label: "汲取资料",
        action: "send",
        insertText: "ingest all changed sources in .raw",
      },
    },
    {
      name: "wiki query",
      description: "查询知识库",
      source: "builtin",
      kind: "prompt",
      adminOnly: false,
      ui: {
        group: "knowledge-base",
        label: "查询知识库",
        action: "insert",
        insertText: "query: ",
      },
    },
    {
      name: "save",
      description: "保存当前对话",
      source: "builtin",
      kind: "prompt",
      adminOnly: false,
      ui: {
        group: "knowledge-base",
        label: "保存对话",
        action: "insert",
        insertText: "/save ",
      },
    },
    {
      name: "autoresearch",
      description: "研究一个主题",
      source: "builtin",
      kind: "prompt",
      adminOnly: false,
      ui: {
        group: "knowledge-base",
        label: "研究主题",
        action: "insert",
        insertText: "/autoresearch ",
      },
    },
    {
      name: "wiki lint",
      description: "检查知识库",
      source: "builtin",
      kind: "prompt",
      adminOnly: false,
      ui: {
        group: "knowledge-base",
        label: "检查知识库",
        action: "send",
        insertText: "run wiki-lint",
      },
    },
  ]
}
