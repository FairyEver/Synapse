import { describe, expect, it } from "vitest"

import { settingsCategories } from "@/modules/settings/data"

describe("settingsCategories", () => {
  it("has the expected merged category structure", () => {
    const ids = settingsCategories.map((c) => c.id)

    expect(ids).toEqual([
      "general",
      "storage",
      "tools",
      "variables",
      "services",
      "troubleshooting",
      "about",
      "admin",
    ])
  })

  it("merges database and mcp into services", () => {
    const ids = settingsCategories.map((c) => c.id)

    expect(ids).toContain("services")
    expect(ids).not.toContain("database")
    expect(ids).not.toContain("mcp")
  })

  it("merges repositories and projects into storage", () => {
    const ids = settingsCategories.map((c) => c.id)

    expect(ids).toContain("storage")
    expect(ids).not.toContain("repositories")
    expect(ids).not.toContain("projects")
  })
})
