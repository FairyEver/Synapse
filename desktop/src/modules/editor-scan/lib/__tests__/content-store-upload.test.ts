import { describe, expect, it } from "vitest"

import type { ScanItemForDetail } from "@/types/editor-scan"
import {
  buildUploadSkillDraftErrorMessage,
  buildUploadSkillDraftRequest,
  buildUploadSkillDraftSuccessMessage,
  canUploadSkillToContentStore,
  getUploadSkillToContentStoreDisabledReason,
} from "../content-store-upload"

describe("content store upload helpers", () => {
  it("enables upload only for Skill scan items with a path", () => {
    expect(canUploadSkillToContentStore(skillItem({ path: "/tmp/skill" }))).toBe(true)
    expect(canUploadSkillToContentStore(skillItem({ path: "" }))).toBe(false)
    expect(canUploadSkillToContentStore(ruleItem())).toBe(false)
    expect(canUploadSkillToContentStore({ ...ruleItem(), type: "prompt" } as unknown as ScanItemForDetail)).toBe(false)

    expect(getUploadSkillToContentStoreDisabledReason(skillItem({ path: "" }))).toBe("本地路径为空")
    expect(getUploadSkillToContentStoreDisabledReason(ruleItem())).toBe("只有 Skill 可以上传到 Skill Repository")
  })

  it("builds IPC payloads without UI state", () => {
    expect(buildUploadSkillDraftRequest(skillItem(), { projectPath: "/tmp/project-override" })).toEqual({
      itemType: "skill",
      itemPath: "/tmp/skill",
      itemName: "review",
      editorId: "claude-code",
      scope: "project",
      projectPath: "/tmp/project-override",
    })
  })

  it("throws disabled reasons when building invalid upload payloads", () => {
    expect(() => buildUploadSkillDraftRequest(ruleItem())).toThrow("只有 Skill 可以上传到 Skill Repository")
  })

  it("builds concise result messages", () => {
    expect(buildUploadSkillDraftSuccessMessage()).toBe("Skill 仓库已保存。")
    expect(buildUploadSkillDraftErrorMessage(new Error("账号未登录。"))).toBe("请先登录账号。")
    expect(buildUploadSkillDraftErrorMessage(new Error("SKILL.md 是必需文件。"))).toBe("SKILL.md 是必需文件。")
  })
})

function skillItem(overrides: Partial<ScanItemForDetail> = {}): ScanItemForDetail {
  return {
    type: "skill",
    name: "review",
    path: "/tmp/skill",
    source: "external",
    preview: "",
    fileCount: 1,
    editorId: "claude-code",
    editorLabel: "Claude Code",
    scope: "project",
    projectPath: "/tmp/project",
    trash: { mode: "path" },
    ...overrides,
  }
}

function ruleItem(): ScanItemForDetail {
  return {
    type: "rule",
    name: "review",
    path: "/tmp/rule.md",
    source: "external",
    preview: "",
    metadata: {},
    editorId: "claude-code",
    editorLabel: "Claude Code",
    scope: "global",
    trash: { mode: "path" },
  }
}
