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

  it("documents skill inline and source directory schema alternatives", () => {
    const tools = new Map(buildContentTools().map((tool) => [tool.name, tool]))
    const create = tools.get("content_skill_create")
    const update = tools.get("content_skill_update")

    expect(create?.inputSchema.required).toBeUndefined()
    expect(create?.inputSchema.anyOf).toEqual(expect.arrayContaining([
      expect.objectContaining({ required: expect.arrayContaining(["name", "title", "description", "category", "content", "icon"]) }),
      expect.objectContaining({ required: expect.arrayContaining(["sourceDirectoryPath", "icon"]) }),
    ]))
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
      anyOf: expect.arrayContaining([
        expect.objectContaining({ required: expect.arrayContaining(["name", "title", "description", "category", "content", "icon"]) }),
        expect.objectContaining({ required: ["sourceDirectoryPath"] }),
      ]),
    })
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

  it("expresses validator-enforced mutual exclusions in schemas", () => {
    const tools = new Map(buildContentTools().map((tool) => [tool.name, tool]))
    const ruleCreateSchema = tools.get("content_rule_create")?.inputSchema
    const skillCreateSchema = tools.get("content_skill_create")?.inputSchema
    const skillUpdateSchema = tools.get("content_skill_update")?.inputSchema
    const filesProperty = skillCreateSchema?.properties?.files as { readonly items?: unknown } | undefined

    expect(ruleCreateSchema).toMatchObject({
      allOf: expect.arrayContaining([
        { not: { required: ["iconImagePath", "iconImageBase64"] } },
      ]),
    })
    expect(skillCreateSchema).toMatchObject({
      allOf: expect.arrayContaining([
        { not: { required: ["iconImagePath", "iconImageBase64"] } },
        {
          not: {
            properties: {
              files: { type: "array", minItems: 1 },
            },
            required: ["files", "sourceDirectoryPath"],
          },
        },
      ]),
    })
    expect(skillUpdateSchema).toMatchObject({
      allOf: expect.arrayContaining([
        {
          not: {
            properties: {
              files: { type: "array", minItems: 1 },
            },
            required: ["files", "sourceDirectoryPath"],
          },
        },
      ]),
    })
    expect(filesProperty?.items).toMatchObject({
      allOf: [
        { not: { required: ["contentText", "contentBase64"] } },
      ],
    })
  })
})
