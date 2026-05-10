import { readFile } from "node:fs/promises"
import { describe, expect, it } from "vitest"

describe("content browser page edit-overwrite plumbing", () => {
  it("widens the detail dialog props with overwritePrefill", async () => {
    const source = await readFile(
      new URL("../components/content-browser-page.tsx", import.meta.url),
      "utf8",
    )

    expect(source).toContain("overwritePrefill")
    expect(source).toContain("EditOverwriteRulePrefill | EditOverwriteSkillPrefill")
  })

  it("opens the matching item when receiving an edit-overwrite request", async () => {
    const source = await readFile(
      new URL("../components/content-browser-page.tsx", import.meta.url),
      "utf8",
    )

    expect(source).toContain('request.kind === "detail" || request.kind === "edit-overwrite"')
    expect(source).toContain("setOverwritePrefill")
  })

  it("forwards overwritePrefill from createContentModule to the detail dialog", async () => {
    const source = await readFile(
      new URL("../create-content-module.tsx", import.meta.url),
      "utf8",
    )

    expect(source).toContain("overwritePrefill")
    expect(source).toContain("config.DetailDialog")
  })
})
