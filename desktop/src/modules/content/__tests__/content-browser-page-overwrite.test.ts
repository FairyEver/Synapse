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

  it("refreshes once before consuming an external request whose target is missing", async () => {
    const source = await readFile(
      new URL("../components/content-browser-page.tsx", import.meta.url),
      "utf8",
    )

    expect(source).not.toContain("!item && items.length === 0")
    expect(source).toContain("toast.error(\"找不到内容，请刷新后重试。\")")
  })

  it("forwards overwritePrefill from createContentModule to the detail dialog", async () => {
    const source = await readFile(
      new URL("../create-content-module.tsx", import.meta.url),
      "utf8",
    )

    expect(source).toContain("overwritePrefill")
    expect(source).toContain("config.DetailDialog")
  })

  it("marks recently viewed writes as intentional fire-and-forget calls", async () => {
    const source = await readFile(
      new URL("../components/content-browser-page.tsx", import.meta.url),
      "utf8",
    )

    expect(source).toContain("void addRecentlyViewed(contentType, item.id)")
  })
})
