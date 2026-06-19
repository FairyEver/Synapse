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

  it("keeps skill schema alternatives for inline fields and source directory imports", () => {
    const tools = new Map(buildContentTools().map((tool) => [tool.name, tool]))

    expect(tools.get("content_skill_create")?.inputSchema).toMatchObject({
      anyOf: expect.arrayContaining([
        expect.objectContaining({
          required: ["name", "title", "description", "category", "content", "icon"],
        }),
        expect.objectContaining({
          required: ["sourceDirectoryPath", "icon"],
        }),
        expect.objectContaining({
          required: ["sourceDirectoryPath", "iconType", "iconImagePath"],
        }),
      ]),
    })
    expect(tools.get("content_skill_update")?.inputSchema).toMatchObject({
      required: ["id", "baseHistoryDirname"],
      anyOf: expect.arrayContaining([
        expect.objectContaining({
          required: ["name", "title", "description", "category", "content", "icon"],
        }),
        expect.objectContaining({
          required: ["sourceDirectoryPath"],
        }),
      ]),
    })
  })
})
