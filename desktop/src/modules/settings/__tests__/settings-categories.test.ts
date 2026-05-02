import { describe, expect, it } from "vitest"

import { settingsCategories } from "@/modules/settings/data"

describe("settingsCategories", () => {
  it("keeps MCP as a standalone settings category", () => {
    const categories = settingsCategories.map((category) => ({
      id: category.id,
      label: category.label,
    }))

    expect(categories).toContainEqual({ id: "data-store", label: "数据服务" })
    expect(categories).toContainEqual({ id: "mcp", label: "MCP" })
  })
})
