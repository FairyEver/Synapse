import { describe, expect, it } from "vitest"
import { hasDuplicateContentTitle } from "../lib/content-title-duplicates"

describe("content title duplicate checks", () => {
  it("compares normalized titles instead of content names", () => {
    expect(hasDuplicateContentTitle([
      { title: "Gitee API" },
      { title: "Release Notes" },
    ], " Gitee API ")).toBe(true)
  })

  it("ignores empty titles before form validation handles them", () => {
    expect(hasDuplicateContentTitle([
      { title: "Gitee API" },
    ], "  ")).toBe(false)
  })
})
