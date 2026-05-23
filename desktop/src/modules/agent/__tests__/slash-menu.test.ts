import { describe, expect, it } from "vitest"

import {
  filterAgentSlashCandidates,
  findAgentSlashFragment,
  groupAgentSlashCandidates,
  replaceAgentSlashFragment,
  type AgentSlashCandidate,
} from "../slash-menu"

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
})
