import { describe, expect, it } from "vitest"

import type { ScanItemForDetail } from "@/types/editor-scan"
import {
  buildUploadSkillToSkillRepositoryRequest,
  getUploadSkillToSkillRepositoryDisabledReason,
} from "../skill-repository-upload"

function createSkillItem(overrides: Partial<ScanItemForDetail> = {}): ScanItemForDetail {
  return {
    type: "skill",
    name: "review",
    path: "/tmp/skills/review",
    source: "external",
    preview: "# Review",
    mainFileName: "SKILL.md",
    fileCount: 1,
    synapseContentId: null,
    editorId: "claude-code",
    editorLabel: "Claude Code",
    scope: "global",
    trash: { mode: "path" },
    ...overrides,
  }
}

describe("Skill Repository upload helpers", () => {
  it("allows scanned Skills with a root SKILL.md main file", () => {
    const item = createSkillItem()

    expect(getUploadSkillToSkillRepositoryDisabledReason(item)).toBeNull()
    expect(buildUploadSkillToSkillRepositoryRequest(item)).toMatchObject({
      itemType: "skill",
      itemPath: "/tmp/skills/review",
      itemName: "review",
      mainFileName: "SKILL.md",
    })
  })

  it("blocks fallback Skill main files before upload", () => {
    const item = createSkillItem({ mainFileName: "README.md" })

    expect(getUploadSkillToSkillRepositoryDisabledReason(item)).toBe(
      "上传到 Skill Repository 需要根目录 SKILL.md",
    )
    expect(() => buildUploadSkillToSkillRepositoryRequest(item)).toThrow(
      "上传到 Skill Repository 需要根目录 SKILL.md",
    )
  })
})
