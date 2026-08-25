import {
  getModelCapabilityCatalog,
  matchModelCapability,
  normalizeProviderBaseUrl,
  resolveModelContextConfiguration,
  validateModelCapabilityCatalog,
} from "../catalog"
import { describe, expect, it } from "vitest"

describe("model capability catalog", () => {
  it("ships a validated catalog with broad Bailian and direct-provider coverage", () => {
    const catalog = getModelCapabilityCatalog()
    const bailianModels = catalog.models.filter((model) => model.providerScopeId === "bailian-cn")
    const directScopes = new Set(catalog.models.map((model) => model.providerScopeId))

    expect(bailianModels.length).toBeGreaterThanOrEqual(90)
    expect([...directScopes]).toEqual(expect.arrayContaining([
      "anthropic-official",
      "deepseek-official",
      "gemini-official",
      "kimi-code-official",
      "minimax-official",
      "moonshot-official",
      "stepfun-official",
      "xiaomi-mimo-official",
      "zhipu-official",
    ]))
    expect(catalog.models).toEqual([...catalog.models].sort((left, right) =>
      `${left.providerScopeId}\u0000${left.modelId}`.localeCompare(
        `${right.providerScopeId}\u0000${right.modelId}`,
        "en",
      )))
  })

  it("keeps total context and maximum input separate for qwen3.7-plus", () => {
    const model = matchModelCapability({
      baseUrl: "https://dashscope.aliyuncs.com/apps/anthropic/",
      modelId: "qwen3.7-plus",
    })

    expect(model).toMatchObject({
      providerScopeId: "bailian-cn",
      contextWindowTokens: 1_000_000,
      maxInputTokens: 991_808,
      maxOutputTokens: 131_072,
      reasoningMaxInputTokens: 983_616,
      reasoningMaxOutputTokens: 131_072,
      maxReasoningTokens: 262_144,
      inputModalities: ["image", "text", "video"],
      outputModalities: ["text"],
      sourceId: "aliyun-qwen3-7-plus",
    })
  })

  it.each([
    ["https://api.anthropic.com", "claude-sonnet-5", 1_000_000],
    ["https://generativelanguage.googleapis.com", "gemini-3.1-pro-preview", 1_048_576],
    ["https://api.deepseek.com/anthropic", "deepseek-v4-pro", 1_000_000],
    ["https://api.kimi.com/coding/", "kimi-for-coding", 262_144],
    ["https://open.bigmodel.cn/api/anthropic", "glm-5.2", 1_000_000],
    ["https://api.minimaxi.com/anthropic", "MiniMax-M3", 1_000_000],
    ["https://api.stepfun.com/step_plan", "step-3.5-flash", 262_144],
    ["https://api.xiaomimimo.com/anthropic", "mimo-v2.5-pro", 1_000_000],
  ])("matches representative official model %s %s", (baseUrl, modelId, contextWindowTokens) => {
    expect(matchModelCapability({ baseUrl, modelId })?.contextWindowTokens)
      .toBe(contextWindowTokens)
  })

  it("normalizes host, duplicate slashes and trailing slashes without weakening exact path matching", () => {
    expect(normalizeProviderBaseUrl(" HTTPS://API.MINIMAXI.COM//anthropic/// "))
      .toBe("https://api.minimaxi.com/anthropic")
    expect(matchModelCapability({
      baseUrl: "https://api.minimaxi.com/anthropic/",
      modelId: "MiniMax-M3",
    })?.contextWindowTokens).toBe(1_000_000)
    expect(matchModelCapability({
      baseUrl: "https://api.minimaxi.com/v1",
      modelId: "MiniMax-M3",
    })).toBeUndefined()
  })

  it("matches official aliases exactly and never guesses a family or truncated version", () => {
    expect(matchModelCapability({
      baseUrl: "https://generativelanguage.googleapis.com",
      modelId: "gemini-3.1-pro",
    })?.modelId).toBe("gemini-3.1-pro-preview")
    expect(matchModelCapability({
      baseUrl: "https://generativelanguage.googleapis.com",
      modelId: "gemini-3.1",
    })).toBeUndefined()
    expect(matchModelCapability({
      baseUrl: "https://unknown.example.com/anthropic",
      modelId: "qwen3.7-plus",
    })).toBeUndefined()
  })

  it("lets an explicit Provider environment value win over catalog injection", () => {
    const explicit = resolveModelContextConfiguration({
      baseUrl: "https://dashscope.aliyuncs.com/apps/anthropic",
      modelId: "qwen3.7-plus",
      configuredContextWindow: "200000",
    })
    const derived = resolveModelContextConfiguration({
      baseUrl: "https://dashscope.aliyuncs.com/apps/anthropic",
      modelId: "qwen3.7-plus",
    })

    expect(explicit).toMatchObject({
      configurationSource: "provider-env",
      modelContext: { contextWindowTokens: 1_000_000 },
    })
    expect(explicit.contextWindowTokens).toBeUndefined()
    expect(derived).toMatchObject({
      configurationSource: "catalog",
      contextWindowTokens: 1_000_000,
    })
  })

  it("rejects an alias collision", () => {
    const catalog = getModelCapabilityCatalog()
    const first = catalog.models[0]!
    const second = catalog.models.find((model) => model.providerScopeId === first.providerScopeId
      && model.modelId !== first.modelId)!
    const invalid = {
      ...catalog,
      models: catalog.models.map((model) => model === first
        ? { ...model, aliases: [second.modelId] }
        : model),
    }

    expect(() => validateModelCapabilityCatalog(invalid)).toThrow("Duplicate model id or alias")
  })
})
