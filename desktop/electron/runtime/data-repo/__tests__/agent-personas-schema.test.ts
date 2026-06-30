import { describe, expect, it } from "vitest"
import {
  agentPersonaItemsSchema,
  type AgentPersonaItemEntryV1,
} from "../schemas/agent-personas"
import { allSchemas } from "../schemas"
import { sqliteIndexesFor } from "../factory"

describe("agent persona DataRepository schema", () => {
  it("accepts user persona records", () => {
    const entry: AgentPersonaItemEntryV1 = {
      id: "persona-1",
      schemaVersion: 1,
      name: "产品顾问",
      description: "整理产品判断和下一步。",
      systemPrompt: "你是产品顾问，先给结论，再列原因。",
      providerModel: { providerId: "claude", modelTier: "sonnet" },
      source: "user",
      createdAt: "2026-06-30T00:00:00.000Z",
      updatedAt: "2026-06-30T00:00:00.000Z",
    }

    expect(agentPersonaItemsSchema.validate(entry)).toBe(true)
  })

  it("rejects blank required fields and builtin records", () => {
    expect(agentPersonaItemsSchema.validate({
      id: "persona-1",
      schemaVersion: 1,
      name: " ",
      description: "简介",
      systemPrompt: "提示词",
      providerModel: null,
      source: "user",
      createdAt: "2026-06-30T00:00:00.000Z",
      updatedAt: "2026-06-30T00:00:00.000Z",
    })).toBe(false)

    expect(agentPersonaItemsSchema.validate({
      id: "builtin-zh-en-translator",
      schemaVersion: 1,
      name: "中英翻译",
      description: "在中文和英文之间互译，保留原意、语气和格式。",
      systemPrompt: "你是中英翻译智能体。",
      providerModel: null,
      source: "builtin",
      createdAt: "2026-06-30T00:00:00.000Z",
      updatedAt: "2026-06-30T00:00:00.000Z",
    })).toBe(false)
  })

  it("registers the namespace and sqlite index", () => {
    expect(allSchemas.some((schema) => schema.name === "app.agent-personas.items")).toBe(true)
    expect(sqliteIndexesFor("app.agent-personas.items")).toEqual([
      "json_extract(value, '$.createdAt'), id",
    ])
  })
})
