import { describe, expect, it } from "vitest"

import { isKnowledgeBaseForceIngestIntent, isKnowledgeBaseIngestIntent } from "../ingest-intent"

describe("isKnowledgeBaseIngestIntent", () => {
  it.each([
    "/wiki ingest",
    "/wiki ingest --force",
    "汲取知识",
    "提取知识",
    "导入这些来源",
    "把这些资料整理进知识库",
    "ingest sources",
    "process these sources",
    "add this to the wiki",
  ])("detects ingest intent: %s", (content) => {
    expect(isKnowledgeBaseIngestIntent(content)).toBe(true)
  })

  it.each([
    "/wiki query",
    "/wiki hot",
    "查询知识库",
    "刷新热点",
    "保存这段对话",
    "what does the wiki say about planning",
  ])("ignores non-ingest intent: %s", (content) => {
    expect(isKnowledgeBaseIngestIntent(content)).toBe(false)
  })

  it("detects only explicit /wiki ingest force turns as force ingest", () => {
    expect(isKnowledgeBaseForceIngestIntent("/wiki ingest --force")).toBe(true)
    expect(isKnowledgeBaseForceIngestIntent("/wiki ingest")).toBe(false)
    expect(isKnowledgeBaseForceIngestIntent("process these sources --force")).toBe(false)
  })
})
