import { describe, expect, it } from "vitest"

import { mergeCreateSkillFiles } from "@/modules/skills/utils"
import type { SkillCreateFilePayloadDraft } from "@/modules/skills/types"

function createFile(originalName: string, size: number): SkillCreateFilePayloadDraft {
  return {
    originalName,
    size,
  }
}

describe("mergeCreateSkillFiles", () => {
  it("allows attachment totals above the single-file limit when they stay within 50MB", () => {
    const tenMegabytes = 10 * 1024 * 1024

    const result = mergeCreateSkillFiles([], [
      createFile("a.md", tenMegabytes),
      createFile("b.md", tenMegabytes),
      createFile("c.md", tenMegabytes),
      createFile("d.md", tenMegabytes),
      createFile("e.md", tenMegabytes),
    ])

    expect(result.files).toHaveLength(5)
    expect(result.rejectedMessages).toEqual([])
  })
})
