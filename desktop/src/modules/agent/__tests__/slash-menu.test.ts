import { describe, expect, it } from "vitest"

import {
  filterAgentSlashCandidates,
  findAgentSlashFragment,
  groupAgentSlashCandidates,
  replaceAgentSlashFragment,
  toAgentSlashCandidates,
  uniqueAgentSlashCandidates,
  type AgentSlashCandidate,
} from "../slash-menu"
import {
  KNOWLEDGE_BASE_AGENT_CAPABILITIES,
  knowledgeBaseStaticCommands,
  toKnowledgeBaseComposerActions,
  toKnowledgeBaseSlashCandidates,
} from "../knowledge-base-commands"

const candidates: AgentSlashCandidate[] = [
  {
    name: "review-code",
    description: "Review code changes",
    kind: "skill",
    source: "skill",
  },
  {
    name: "openai-docs",
    description: "Use OpenAI docs",
    kind: "skill",
    source: "skill",
  },
  {
    name: "status",
    description: "Show agent status",
    kind: "command",
    source: "builtin",
  },
  {
    name: "model",
    description: "Switch model",
    kind: "command",
    source: "builtin",
  },
]

describe("agent slash menu utilities", () => {
  it("detects a slash fragment at the cursor in the middle of a draft", () => {
    expect(findAgentSlashFragment("Please review /rev in this implementation", 18)).toEqual({
      start: 14,
      end: 18,
      query: "rev",
    })
  })

  it("detects an empty slash fragment immediately after slash", () => {
    expect(findAgentSlashFragment("Please / review", 8)).toEqual({
      start: 7,
      end: 8,
      query: "",
    })
  })

  it("detects a slash fragment even when slash is not preceded by whitespace", () => {
    expect(findAgentSlashFragment("prefix/path", 11)).toEqual({
      start: 6,
      end: 11,
      query: "path",
    })
  })

  it("returns null when the cursor is outside a slash token", () => {
    expect(findAgentSlashFragment("Please /review later", 6)).toBeNull()
    expect(findAgentSlashFragment("Please /review later", 21)).toBeNull()
  })

  it("stops the active fragment at whitespace", () => {
    expect(findAgentSlashFragment("Run /status now", 11)).toEqual({
      start: 4,
      end: 11,
      query: "status",
    })
    expect(findAgentSlashFragment("Run /status now", 13)).toBeNull()
  })

  it("replaces only the active slash fragment", () => {
    const fragment = findAgentSlashFragment("Please review /rev in this implementation", 18)
    expect(fragment).not.toBeNull()
    expect(replaceAgentSlashFragment(
      "Please review /rev in this implementation",
      fragment!,
      "review-code",
    )).toEqual({
      value: "Please review /review-code in this implementation",
      cursor: 26,
    })
  })

  it("filters candidates by name and description", () => {
    expect(filterAgentSlashCandidates(candidates, "rev").map((item) => item.name))
      .toEqual(["review-code"])
    expect(filterAgentSlashCandidates(candidates, "docs").map((item) => item.name))
      .toEqual(["openai-docs"])
  })

  it("prefers name prefix matches over description matches", () => {
    expect(filterAgentSlashCandidates([
      {
        name: "bark-notification",
        description: "Send a Bark phone push notification with a clear title",
        kind: "skill",
        source: "skill",
      },
      {
        name: "better-3in1",
        description: "Review the repository from three expert perspectives",
        kind: "skill",
        source: "skill",
      },
      {
        name: "wiki",
        description: "Create wiki docs",
        kind: "command",
        source: "custom",
      },
    ], "w").map((item) => item.name)).toEqual(["wiki"])
  })

  it("shows all candidates for an empty query", () => {
    expect(filterAgentSlashCandidates(candidates, "").map((item) => item.name))
      .toEqual(["review-code", "openai-docs", "status", "model"])
  })

  it("groups skills before commands", () => {
    expect(groupAgentSlashCandidates(candidates)).toEqual([
      {
        kind: "skill",
        label: "Skills",
        items: [candidates[0], candidates[1]],
      },
      {
        kind: "command",
        label: "Commands",
        items: [candidates[2], candidates[3]],
      },
    ])
  })

  it("keeps command names with spaces for wiki subcommands", () => {
    const items = filterAgentSlashCandidates([
      {
        name: "wiki ingest",
        description: "汲取来源",
        kind: "command",
        source: "custom",
        insertText: "/wiki ingest",
      },
      {
        name: "wiki query",
        description: "查询知识库",
        kind: "command",
        source: "custom",
        insertText: "/wiki query ",
      },
    ], "wiki")

    expect(items.map((item) => item.name)).toEqual(["wiki ingest", "wiki query"])
  })

  it("converts published wiki subcommands with insert text", () => {
    expect(toAgentSlashCandidates([{
      name: "wiki query",
      description: "查询知识库",
      source: "custom",
      kind: "prompt",
      adminOnly: false,
      ui: {
        group: "knowledge-base",
        label: "查询知识库",
        action: "insert",
        insertText: "/wiki query ",
      },
    }])).toEqual([{
      name: "wiki query",
      description: "查询知识库",
      kind: "command",
      source: "custom",
      insertText: "/wiki query ",
    }])
  })

  it("converts the full knowledge base catalog into slash candidates", () => {
    expect(toKnowledgeBaseSlashCandidates().map((item) => ({
      name: item.name,
      description: item.description,
      kind: item.kind,
      insertText: item.insertText,
    }))).toEqual([
      {
        name: "autoresearch",
        description: "围绕主题研究并写入知识库",
        kind: "knowledgeBase",
        insertText: "/autoresearch ",
      },
      {
        name: "canvas",
        description: "创建或更新知识库画布",
        kind: "knowledgeBase",
        insertText: "/canvas ",
      },
      {
        name: "defuddle",
        description: "清理网页正文后用于入库",
        kind: "knowledgeBase",
        insertText: "/defuddle ",
      },
      {
        name: "obsidian-bases",
        description: "创建或编辑知识库表格视图",
        kind: "knowledgeBase",
        insertText: "/obsidian-bases ",
      },
      {
        name: "obsidian-markdown",
        description: "按知识库 Markdown 语法编写页面",
        kind: "knowledgeBase",
        insertText: "/obsidian-markdown ",
      },
      {
        name: "save",
        description: "保存当前对话或关键结论",
        kind: "knowledgeBase",
        insertText: "/save ",
      },
      {
        name: "wiki",
        description: "管理知识库结构与热缓存",
        kind: "knowledgeBase",
        insertText: "/wiki ",
      },
      {
        name: "wiki-fold",
        description: "折叠整理知识库日志",
        kind: "knowledgeBase",
        insertText: "/wiki-fold ",
      },
      {
        name: "wiki-ingest",
        description: "汲取资料，整理 .raw 中的新内容",
        kind: "knowledgeBase",
        insertText: "/wiki-ingest ",
      },
      {
        name: "wiki-lint",
        description: "检查链接、索引、孤立页面和结构问题",
        kind: "knowledgeBase",
        insertText: "/wiki-lint ",
      },
      {
        name: "wiki-query",
        description: "查询知识库并基于已有页面回答",
        kind: "knowledgeBase",
        insertText: "/wiki-query ",
      },
    ])
  })

  it("derives curated knowledge base composer actions from the same catalog", () => {
    expect(toKnowledgeBaseComposerActions().map((item) => ({
      label: item.label,
      action: item.action,
      commandText: item.commandText,
    }))).toEqual([
      {
        label: "汲取新资料",
        action: "send",
        commandText: "/wiki-ingest ingest all of these .raw sources ",
      },
      { label: "汲取指定资料", action: "insert", commandText: "/wiki-ingest .raw/ " },
      { label: "查询知识库", action: "insert", commandText: "/wiki-query " },
      { label: "保存对话", action: "insert", commandText: "/save " },
      { label: "研究主题", action: "insert", commandText: "/autoresearch " },
      { label: "检查知识库", action: "send", commandText: "/wiki-lint " },
    ])
  })

  it("keeps the legacy knowledge base command helper backed by the catalog", () => {
    expect(knowledgeBaseStaticCommands().map((item) => item.name))
      .toEqual(KNOWLEDGE_BASE_AGENT_CAPABILITIES.map((item) => item.name))
  })

  it("uses insertText when replacing slash fragments", () => {
    const fragment = findAgentSlashFragment("Ask /wiki", 9)
    expect(fragment).not.toBeNull()

    expect(replaceAgentSlashFragment(
      "Ask /wiki",
      fragment!,
      "wiki query",
      "/wiki query ",
    )).toEqual({
      value: "Ask /wiki query ",
      cursor: 16,
    })
  })

  it("groups knowledge base candidates before skills", () => {
    const knowledgeBase = toKnowledgeBaseSlashCandidates([
      {
        name: "wiki-query",
        description: "查询知识库并基于已有页面回答",
        slashText: "/wiki-query ",
      },
    ])[0]

    expect(groupAgentSlashCandidates([candidates[0], candidates[2], knowledgeBase]))
      .toEqual([
        {
          kind: "knowledgeBase",
          label: "知识库",
          items: [knowledgeBase],
        },
        {
          kind: "skill",
          label: "Skills",
          items: [candidates[0]],
        },
        {
          kind: "command",
          label: "Commands",
          items: [candidates[2]],
        },
      ])
  })

  it("deduplicates slash candidates by name while keeping the first source", () => {
    const knowledgeBase = toKnowledgeBaseSlashCandidates([
      {
        name: "wiki-ingest",
        description: "汲取资料，整理 .raw 中的新内容",
        slashText: "/wiki-ingest ",
      },
    ])[0]
    const runtimeNative = toAgentSlashCandidates([{
      name: "wiki-ingest",
      description: "汲取资料，整理 .raw 中的新内容",
      source: "agent-native",
      kind: "agent-native",
      adminOnly: false,
      ui: {
        group: "knowledge-base",
        insertText: "/wiki-ingest ",
      },
    }])[0]

    expect(uniqueAgentSlashCandidates([knowledgeBase, runtimeNative])).toEqual([knowledgeBase])
  })

})
