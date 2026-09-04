import { describe, expect, it } from "vitest"

import {
  filterAgentSlashCandidates,
  findAgentSlashFragment,
  groupAgentSlashCandidates,
  nextRecentSlashSkills,
  orderAgentSlashCandidates,
  replaceAgentSlashFragment,
  submittedSlashSkillName,
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
    skillOrigin: "synapse-installed",
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

  it("does not treat path separators as slash fragments", () => {
    expect(findAgentSlashFragment("prefix/path", 11)).toBeNull()
    expect(findAgentSlashFragment("/Users/liyang/Documents/project", 31)).toBeNull()
    expect(findAgentSlashFragment("/Users/liyang/Documents/project", 6)).toBeNull()
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

  it("groups installed Skills, other Skills, and commands in order", () => {
    expect(groupAgentSlashCandidates(candidates)).toEqual([
      {
        kind: "installedSkill",
        label: "我的 Skills",
        items: [candidates[0]],
      },
      {
        kind: "otherSkill",
        label: "其它 Skills",
        items: [candidates[1]],
      },
      {
        kind: "command",
        label: "其它命令",
        items: [candidates[2], candidates[3]],
      },
    ])
  })

  it("puts up to three available recent Skills first without duplicates", () => {
    const knowledgeBase = toKnowledgeBaseSlashCandidates([{
      name: "wiki-query",
      description: "查询知识库",
      slashText: "/wiki-query ",
    }])[0]
    const input = [knowledgeBase, ...candidates]
    const groups = groupAgentSlashCandidates(input, ["openai-docs", "missing", "openai-docs", "review-code"])

    expect(groups.map((group) => [group.label, group.items.map((item) => item.name)])).toEqual([
      ["最近使用", ["openai-docs", "review-code"]],
      ["知识库", ["wiki-query"]],
      ["其它命令", ["status", "model"]],
    ])
    expect(orderAgentSlashCandidates(input, ["openai-docs", "review-code"]).map((item) => item.name))
      .toEqual(["openai-docs", "review-code", "wiki-query", "status", "model"])
  })

  it("keeps grouped order after Slash search filtering", () => {
    const filtered = filterAgentSlashCandidates(candidates, "code")
    expect(orderAgentSlashCandidates(filtered, ["review-code"]).map((item) => item.name))
      .toEqual(["review-code"])
  })

  it("recognizes only available leading Skill invocations for recent usage", () => {
    expect(submittedSlashSkillName(" /Review-Code src/app.ts ", candidates)).toBe("review-code")
    expect(submittedSlashSkillName("Please /review-code", candidates)).toBeNull()
    expect(submittedSlashSkillName("/status", candidates)).toBeNull()
    expect(submittedSlashSkillName("/missing", candidates)).toBeNull()
  })

  it("updates the three-item recent Skill MRU list", () => {
    expect(nextRecentSlashSkills(["one", "two", "three"], "/TWO"))
      .toEqual(["two", "one", "three"])
    expect(nextRecentSlashSkills(["one", "two", "three"], "four"))
      .toEqual(["four", "one", "two"])
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

  it("groups knowledge base candidates after Skills and before commands", () => {
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
          kind: "installedSkill",
          label: "我的 Skills",
          items: [candidates[0]],
        },
        {
          kind: "knowledgeBase",
          label: "知识库",
          items: [knowledgeBase],
        },
        {
          kind: "command",
          label: "其它命令",
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
