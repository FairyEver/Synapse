import { describe, expect, it } from "vitest"

import { settingsCategories } from "@/modules/settings/data"

describe("settingsCategories", () => {
  it("has the expected merged category structure", () => {
    const ids = settingsCategories.map((c) => c.id)

    expect(ids).toEqual([
      "general",
      "repositories",
      "projects",
      "tools",
      "claude-code",
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

  it("has separate repositories and projects categories", () => {
    const ids = settingsCategories.map((c) => c.id)

    expect(ids).toContain("repositories")
    expect(ids).toContain("projects")
  })
})
