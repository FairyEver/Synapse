import { readFile } from "node:fs/promises"
import { describe, expect, it } from "vitest"

describe("content detail dialog overwrite prefill", () => {
  it("declares the overwritePrefill prop", async () => {
    const source = await readFile(
      new URL("../components/content-detail-dialog.tsx", import.meta.url),
      "utf8",
    )

    expect(source).toContain("overwritePrefill")
    expect(source).toContain("EditOverwriteRulePrefill | EditOverwriteSkillPrefill")
  })

  it("auto enters edit mode once detail loaded with prefill", async () => {
    const source = await readFile(
      new URL("../components/content-detail-dialog.tsx", import.meta.url),
      "utf8",
    )

    expect(source).toContain("consumedOverwriteRequestIdRef")
    expect(source).toContain("setIsEditOpen(true)")
  })

  it("merges Rule prefill content into initialValue", async () => {
    const source = await readFile(
      new URL("../components/content-detail-dialog.tsx", import.meta.url),
      "utf8",
    )

    expect(source).toMatch(/overwritePrefill[\s\S]{0,80}contentType === "rule"/)
    expect(source).toContain("content: overwritePrefill.prefill.content")
  })

  it("merges Skill prefill content and files into initialValue", async () => {
    const source = await readFile(
      new URL("../components/content-detail-dialog.tsx", import.meta.url),
      "utf8",
    )

    expect(source).toMatch(/overwritePrefill[\s\S]{0,80}contentType === "skill"/)
    expect(source).toContain("files: overwritePrefill.prefill.files")
  })
})
