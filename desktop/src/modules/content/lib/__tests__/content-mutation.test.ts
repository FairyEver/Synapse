import { describe, expect, it } from "vitest"

import {
  canManageContentDeletion,
  canUpdateContent,
  countSavedContentMutations,
  isContentMutationSaved,
  summarizeContentMutationConflictTitles,
} from "../content-mutation"
import type { SynapseContentMeta, SynapseContentMutationResult } from "@/types/content"

const savedResult: SynapseContentMutationResult = {
  id: "rule-1",
  type: "rule",
  status: "saved",
  title: "Rule",
  latestHistoryDirname: "20260428000000",
  modifiedAt: "2026-04-28T00:00:00.000Z",
  pushed: false,
  pendingPushCount: 1,
  message: "已保存",
}

const conflictResult: SynapseContentMutationResult = {
  id: "rule-1",
  type: "rule",
  status: "conflict",
  latestHistoryDirname: "20260428010101",
  latestModifiedAt: "2026-04-28T01:01:01.000Z",
  latestModifiedByDisplayName: "User",
}

function contentItem(id: string, title: string): SynapseContentMeta {
  return {
    id,
    type: "rule",
    name: title,
    title,
    description: "",
    category: "general",
    icon: "FileText",
    iconBg: "gray",
    iconType: "icon",
    createdAt: "2026-04-28T00:00:00.000Z",
    createdBy: "user",
    createdByDisplayName: "User",
    deleted: false,
    attachmentCount: 0,
    latestHistoryDirname: "20260428000000",
    modifiedAt: "2026-04-28T00:00:00.000Z",
    modifiedBy: "user",
    modifiedByDisplayName: "User",
  }
}

describe("content mutation helpers", () => {
  it("restricts every deletion lifecycle to its creator", () => {
    const skill = { ...contentItem("skill-1", "Skill"), type: "skill" as const }
    const rule = contentItem("rule-1", "Rule")

    expect(canManageContentDeletion(skill, "user")).toBe(true)
    expect(canManageContentDeletion(skill, "other-user")).toBe(false)
    expect(canManageContentDeletion(rule, "user")).toBe(true)
    expect(canManageContentDeletion(rule, "other-user")).toBe(false)
  })

  it("allows collaborative Skill updates but restricts Rule updates to the creator", () => {
    const skill = { ...contentItem("skill-1", "Skill"), type: "skill" as const }
    const rule = contentItem("rule-1", "Rule")

    expect(canUpdateContent(skill, "other-user")).toBe(true)
    expect(canUpdateContent(rule, "user")).toBe(true)
    expect(canUpdateContent(rule, "other-user")).toBe(false)
  })

  it("treats conflict results as not saved", () => {
    expect(isContentMutationSaved(savedResult)).toBe(true)
    expect(isContentMutationSaved(conflictResult)).toBe(false)
  })

  it("counts only saved mutation results", () => {
    expect(countSavedContentMutations([savedResult, conflictResult])).toBe(1)
  })

  it("summarizes conflict item titles", () => {
    expect(summarizeContentMutationConflictTitles([
      contentItem("rule-1", "日报"),
      contentItem("rule-2", "周报"),
    ])).toBe("「日报」、「周报」")
  })

  it("limits long conflict title summaries", () => {
    expect(summarizeContentMutationConflictTitles([
      contentItem("rule-1", "一"),
      contentItem("rule-2", "二"),
      contentItem("rule-3", "三"),
      contentItem("rule-4", "四"),
    ])).toBe("「一」、「二」、「三」 等 4 项")
  })
})
