import { describe, expect, it } from "vitest"

import {
  mergeCreateSkillFiles,
  serializeCreateSkillFiles,
  validateCreateSkillPayload,
} from "@/modules/skills/utils"
import type { SkillCreateFilePayloadDraft } from "@/modules/skills/types"
import type { SynapseCreateSkillPayload } from "@/types/content"

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

  it("rejects case-only duplicate attachment paths while merging files", () => {
    const result = mergeCreateSkillFiles([
      createFile("assets/Readme.md", 1),
    ], [
      createFile("assets/readme.md", 1),
    ])

    expect(result.files.map((file) => file.originalName)).toEqual(["assets/Readme.md"])
    expect(result.rejectedMessages).toEqual(["以下附件文件名重复，已跳过：assets/readme.md。"])
  })

  it("rejects case-only duplicate attachment paths during payload validation", () => {
    const errors = validateCreateSkillPayload({
      title: "Skill",
      name: "skill",
      description: "Description",
      category: "test",
      icon: "wrench",
      iconBg: "default",
      iconType: "icon",
      iconImage: "",
      content: "# Skill",
      files: [
        createFile("assets/Readme.md", 1),
        createFile("assets/readme.md", 1),
      ],
    } satisfies SynapseCreateSkillPayload)

    expect(errors.files).toContain("附件文件名重复：assets/Readme.md。")
  })
})

describe("serializeCreateSkillFiles", () => {
  it("serializes edited text attachments as fresh bytes", async () => {
    const [file] = await serializeCreateSkillFiles([
      {
        originalName: "scripts/run.js",
        sha256: "old-sha",
        size: 0,
        textContent: "console.log('ok')\n",
        textDirty: true,
      },
    ])

    expect(file).toEqual({
      originalName: "scripts/run.js",
      size: 18,
      bytes: new TextEncoder().encode("console.log('ok')\n"),
    })
  })
})
