import { describe, expect, it } from "vitest"
import { buildContentTools } from "./content-domain"

describe("Content capability domain", () => {
  it("expresses validator-required appearance fields in create and update schemas", () => {
    const tools = new Map(buildContentTools().map((tool) => [tool.name, tool]))

    expect(tools.get("content_rule_create")?.inputSchema).toMatchObject({
      required: ["name", "title", "description", "category", "content"],
      anyOf: expect.arrayContaining([
        expect.objectContaining({ required: ["icon"] }),
        expect.objectContaining({ required: ["iconType", "iconImagePath"] }),
        expect.objectContaining({ required: ["iconType", "iconImageBase64"] }),
      ]),
    })
    expect(tools.get("content_prompt_update")?.inputSchema).toMatchObject({
      required: ["id", "baseHistoryDirname", "title", "description", "category", "content"],
      anyOf: expect.arrayContaining([
        expect.objectContaining({ required: ["icon"] }),
        expect.objectContaining({ required: ["iconType", "iconImagePath"] }),
        expect.objectContaining({ required: ["iconType", "iconImageBase64"] }),
      ]),
    })
  })

  it("keeps skill schemas strict-client compatible while documenting inline and source directory inputs", () => {
    const tools = new Map(buildContentTools().map((tool) => [tool.name, tool]))
    const create = tools.get("content_skill_create")
    const update = tools.get("content_skill_update")

    expect(create?.inputSchema.required).toBeUndefined()
    expect(create?.inputSchema).not.toHaveProperty("anyOf")
    expect(create?.inputSchema.properties).toMatchObject({
      name: expect.any(Object),
      files: expect.any(Object),
      sourceDirectoryPath: expect.any(Object),
    })
    expect(create?.description).toContain("inline")
    expect(create?.description).toContain("sourceDirectoryPath")
    expect(create?.description).toContain("200 attachment directories")
    expect(JSON.stringify(create?.inputSchema.properties.sourceDirectoryPath)).toContain("depth 8")
    expect(update?.inputSchema).toMatchObject({
      required: ["id", "baseHistoryDirname"],
    })
    expect(update?.inputSchema).not.toHaveProperty("anyOf")
    expect(update?.description).toContain("sourceDirectoryPath")
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
})
