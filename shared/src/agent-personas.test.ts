import { describe, expect, it } from "vitest"
import {
  agentPersonaCreateInputSchema,
  agentPersonaDtoSchema,
  agentPersonaListResponseSchema,
  agentPersonaPreferenceUpdateInputSchema,
} from "./agent-personas"

describe("agent persona shared contracts", () => {
  it("accepts merged persona list responses", () => {
    expect(agentPersonaListResponseSchema.parse({
      items: [{
        id: "builtin-zh-en-translator",
        schemaVersion: 1,
        name: "中英翻译",
        description: "在中文和英文之间互译。",
        systemPrompt: "你是中英翻译智能体。",
        providerModel: null,
        toolPolicy: { mode: "disabled" },
        source: "builtin",
        readonly: true,
        version: 1,
        updatedAt: "2026-07-01T00:00:00.000Z",
      }],
    }).items[0]?.readonly).toBe(true)
  })

  it("normalizes create and preference payloads", () => {
    expect(agentPersonaCreateInputSchema.parse({
      name: "产品顾问",
      description: "整理产品判断。",
      systemPrompt: "你是产品顾问。",
      providerModel: { providerId: "claude", modelTier: "sonnet" },
      toolPolicy: { mode: "allowlist", allowedTools: ["Read", "Grep"] },
    }).toolPolicy).toEqual({ mode: "allowlist", allowedTools: ["Read", "Grep"] })

    expect(agentPersonaPreferenceUpdateInputSchema.parse({
      providerModel: null,
      toolPolicy: { mode: "disabled" },
    })).toEqual({
      providerModel: null,
      toolPolicy: { mode: "disabled" },
    })
  })

  it("rejects editable builtin dto shape", () => {
    expect(agentPersonaDtoSchema.safeParse({
      id: "builtin-zh-en-translator",
      schemaVersion: 1,
      name: "中英翻译",
      description: "在中文和英文之间互译。",
      systemPrompt: "你是中英翻译智能体。",
      providerModel: null,
      toolPolicy: null,
      source: "builtin",
      readonly: false,
      version: 1,
    }).success).toBe(false)
  })
})
