import { describe, expect, it } from "vitest"
import { buildContentTools } from "./content-domain"

describe("Content capability domain", () => {
  it("uses resource repository app tool names with content aliases", () => {
    const tools = new Map(buildContentTools().map((tool) => [tool.name, tool]))

    expect(tools.has("app_resource_repository_skill_create")).toBe(true)
    expect(tools.has("content_skill_create")).toBe(true)
  })

  it("keeps required content fields in create and update schemas", () => {
    const tools = new Map(buildContentTools().map((tool) => [tool.name, tool]))

    expect(tools.get("content_rule_create")?.inputSchema).toMatchObject({
      required: ["name", "title", "description", "category", "content"],
    })
    expect(tools.get("content_prompt_update")?.inputSchema).toMatchObject({
      required: ["id", "baseHistoryDirname", "title", "description", "category", "content"],
    })
  })

  it("documents skill inline and source directory schema alternatives", () => {
    const tools = new Map(buildContentTools().map((tool) => [tool.name, tool]))
    const create = tools.get("content_skill_create")
    const update = tools.get("content_skill_update")

    expect(create?.inputSchema.required).toBeUndefined()
    expect(create?.inputSchema).not.toHaveProperty("anyOf")
    expect(create?.inputSchema).not.toHaveProperty("allOf")
    expect(create?.inputSchema.properties).toMatchObject({
      name: expect.any(Object),
      files: expect.any(Object),
      sourceDirectoryPath: expect.any(Object),
    })
    expect(create?.description).toContain("inline")
    expect(create?.description).toContain("sourceDirectoryPath")
    expect(create?.description).toContain("200 attachment directories")
    expect(create?.description).toContain("1,000 entries per directory")
    expect(JSON.stringify(create?.inputSchema.properties.sourceDirectoryPath)).toContain("depth 8")
    expect(JSON.stringify(create?.inputSchema.properties.sourceDirectoryPath)).toContain("without reading excluded runtime env files")
    expect(JSON.stringify(create?.inputSchema.properties.sourceDirectoryPath)).toContain(".synapse.repository.json")
    expect(JSON.stringify(create?.inputSchema.properties.sourceDirectoryPath)).toContain(".env.example must not exceed 1 MiB")
    expect(JSON.stringify(create?.inputSchema.properties.sourceDirectoryPath)).toContain("paths are not trimmed")
    expect(JSON.stringify(create?.inputSchema.properties.sourceDirectoryPath)).not.toContain("high-confidence secrets")
    expect(update?.inputSchema).toMatchObject({
      required: ["id", "baseHistoryDirname"],
    })
    expect(update?.inputSchema).not.toHaveProperty("anyOf")
    expect(update?.inputSchema).not.toHaveProperty("allOf")
    expect(update?.description).toContain("sourceDirectoryPath")
    expect(update?.description).toContain("including a Skill created by another repository profile")
    expect(update?.description).not.toContain("skill created by the current repo profile")
  })

  it("exposes rule and skill name constraints in create schemas", () => {
    const tools = new Map(buildContentTools().map((tool) => [tool.name, tool]))

    expect(tools.get("content_rule_create")?.inputSchema.properties.name).toMatchObject({
      maxLength: 64,
      pattern: "^[a-z0-9](?:[a-z0-9.-]{0,62}[a-z0-9])?$",
    })
    expect(JSON.stringify(tools.get("content_rule_create")?.inputSchema.properties.name))
      .toContain("Windows reserved")
    expect(tools.get("content_skill_create")?.inputSchema.properties.name).toMatchObject({
      maxLength: 64,
      pattern: "^[a-z0-9](?:[a-z0-9-]{0,62}[a-z0-9])?$",
    })
    expect(JSON.stringify(tools.get("content_skill_create")?.inputSchema.properties.name))
      .toContain("dots")
  })

  it("documents validator-enforced mutual exclusions without top-level combinators", () => {
    const tools = new Map(buildContentTools().map((tool) => [tool.name, tool]))
    const ruleCreateSchema = tools.get("content_rule_create")?.inputSchema
    const skillCreateSchema = tools.get("content_skill_create")?.inputSchema
    const skillUpdateSchema = tools.get("content_skill_update")?.inputSchema
    const filesProperty = skillCreateSchema?.properties?.files as { readonly items?: unknown } | undefined

    expect(ruleCreateSchema).not.toHaveProperty("allOf")
    expect(skillCreateSchema).not.toHaveProperty("allOf")
    expect(skillUpdateSchema).not.toHaveProperty("allOf")
    expect(JSON.stringify(ruleCreateSchema?.properties)).toContain("Mutually exclusive")
    expect(JSON.stringify(skillCreateSchema?.properties)).toContain("Mutually exclusive")
    expect(filesProperty?.items).not.toHaveProperty("allOf")
    expect(JSON.stringify(filesProperty?.items)).toContain("Mutually exclusive")
  })
})
