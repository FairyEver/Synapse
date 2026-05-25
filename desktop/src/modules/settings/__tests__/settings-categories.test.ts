import { describe, expect, it } from "vitest"

import { settingsCategories } from "@/modules/settings/data"

describe("settingsCategories", () => {
  it("has the expected merged category structure", () => {
    const ids = settingsCategories.map((c) => c.id)

    expect(ids).toEqual([
      "general",
      "repositories",
      "projects",
      "quick-inputs",
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

  it("uses clear user-facing category names", () => {
    const labels = new Map(settingsCategories.map((category) => [category.id, category.label]))

    expect(labels.get("general")).toBe("基础设置")
    expect(labels.get("repositories")).toBe("本地仓库")
    expect(labels.get("projects")).toBe("本地项目")
    expect(labels.get("quick-inputs")).toBe("片段")
    expect(labels.get("tools")).toBe("编辑器")
    expect(labels.get("claude-code")).toBe("模型与供应商")
    expect(labels.get("variables")).toBe("变量替换")
    expect(labels.get("services")).toBe("数据服务")
    expect(labels.get("troubleshooting")).toBe("诊断日志")
    expect(labels.get("about")).toBe("关于 Synapse")
    expect(labels.get("admin")).toBe("仓库维护")
  })
})
