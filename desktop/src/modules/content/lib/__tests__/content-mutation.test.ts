import { describe, expect, it } from "vitest"

import {
  countSavedContentMutations,
  isContentMutationSaved,
} from "../content-mutation"
import type { SynapseContentMutationResult } from "@/types/content"

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

describe("content mutation helpers", () => {
  it("treats conflict results as not saved", () => {
    expect(isContentMutationSaved(savedResult)).toBe(true)
    expect(isContentMutationSaved(conflictResult)).toBe(false)
  })

  it("counts only saved mutation results", () => {
    expect(countSavedContentMutations([savedResult, conflictResult])).toBe(1)
  })
})
