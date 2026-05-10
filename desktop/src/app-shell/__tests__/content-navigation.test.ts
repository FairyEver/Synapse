import { readFile } from "node:fs/promises"
import { describe, expect, it } from "vitest"

describe("content navigation edit-overwrite request", () => {
  it("declares the edit-overwrite kind on the union", async () => {
    const source = await readFile(
      new URL("../content-navigation.ts", import.meta.url),
      "utf8",
    )

    expect(source).toContain('kind: "edit-overwrite"')
    expect(source).toContain("contentId: string")
    expect(source).toContain("prefill")
    expect(source).toContain("sourceLabel: string")
  })

  it("exports a dispatcher for the edit-overwrite kind", async () => {
    const source = await readFile(
      new URL("../content-navigation.ts", import.meta.url),
      "utf8",
    )

    expect(source).toContain("function requestOpenContentEditOverwrite")
    expect(source).toContain("requestOpenContentEditOverwrite,")
    expect(source).toContain('kind: "edit-overwrite"')
  })

  it("exposes a Rule prefill shape with content", async () => {
    const source = await readFile(
      new URL("../content-navigation.ts", import.meta.url),
      "utf8",
    )

    expect(source).toContain("EditOverwriteRulePrefill")
    expect(source).toContain('contentType: "rule"')
    expect(source).toContain("content: string")
  })

  it("exposes a Skill prefill shape with files", async () => {
    const source = await readFile(
      new URL("../content-navigation.ts", import.meta.url),
      "utf8",
    )

    expect(source).toContain("EditOverwriteSkillPrefill")
    expect(source).toContain('contentType: "skill"')
    expect(source).toContain("files: SkillCreateFilePayloadDraft[]")
  })
})
