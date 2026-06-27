import { describe, expect, it } from "vitest"

import { settingsCategories } from "@/modules/settings/data"

describe("settingsCategories", () => {
  it("has the expected category structure without local IDE settings", () => {
    const ids = settingsCategories.map((c) => c.id)

    expect(ids).toEqual([
      "account",
      "general",
      "dock",
      "repositories",
      "projects",
      "claude-code",
      "variables",
      "troubleshooting",
      "about",
      "admin",
    ])
  })

  it("keeps migrated data services and IDE directories out of settings", () => {
    const ids = settingsCategories.map((c) => c.id)

    expect(ids).not.toContain("services")
    expect(ids).not.toContain("database")
    expect(ids).not.toContain("mcp")
    expect(ids).not.toContain("tools")
    expect(ids).not.toContain("quick-inputs")
  })

  it("has separate repositories and projects categories", () => {
    const ids = settingsCategories.map((c) => c.id)

    expect(ids).toContain("repositories")
    expect(ids).toContain("projects")
  })

  it("uses clear user-facing category names", () => {
    const labels = new Map<string, string>(settingsCategories.map((category) => [category.id, category.label]))

    expect(labels.get("account")).toBe("账号")
    expect(labels.get("general")).toBe("基础设置")
    expect(labels.get("dock")).toBe("Dock 栏")
    expect(labels.get("repositories")).toBe("资源仓库")
    expect(labels.get("projects")).toBe("项目和知识库")
    expect(labels.get("tools")).toBeUndefined()
    expect(labels.get("claude-code")).toBe("模型与供应商")
    expect(labels.get("variables")).toBe("私人令牌")
    expect(labels.get("troubleshooting")).toBe("诊断日志")
    expect(labels.get("about")).toBe("关于 Synapse")
    expect(labels.get("admin")).toBe("仓库维护")
  })
})
