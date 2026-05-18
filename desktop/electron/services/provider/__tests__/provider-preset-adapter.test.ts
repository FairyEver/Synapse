import { describe, expect, it } from "vitest"

import { getClaudeProviderPreset } from "../claude-provider-presets"
import {
  buildProviderInputFromClaudePreset,
  providerIdFromPresetName,
} from "../provider-preset-adapter"

describe("provider preset adapter", () => {
  it("maps Anthropic env fields into CreateProviderInput", () => {
    const preset = getClaudeProviderPreset("PackyCode")
    if (!preset) throw new Error("PackyCode preset missing")

    const input = buildProviderInputFromClaudePreset({
      preset,
      apiKey: "sk-packy",
      existingIds: new Set(),
    })

    expect(input).toEqual(expect.objectContaining({
      id: "packycode",
      name: "PackyCode",
      category: "third_party",
      baseUrl: "https://www.packyapi.com",
      apiKeyField: "ANTHROPIC_AUTH_TOKEN",
      apiKey: "sk-packy",
      env: {},
    }))
  })

  it("maps DeepSeek using cc-switch model defaults", () => {
    const preset = getClaudeProviderPreset("DeepSeek")
    if (!preset) throw new Error("DeepSeek preset missing")

    const input = buildProviderInputFromClaudePreset({
      preset,
      apiKey: "sk-deepseek",
      existingIds: new Set(),
    })

    expect(input.baseUrl).toBe("https://api.deepseek.com/anthropic")
    expect(input.model).toBe("deepseek-v4-pro")
    expect(input.haikuModel).toBe("deepseek-v4-flash")
    expect(input.sonnetModel).toBe("deepseek-v4-pro")
    expect(input.opusModel).toBe("deepseek-v4-pro")
  })

  it("maps Baidu Qianfan Coding Plan from cc-switch presets", () => {
    const preset = getClaudeProviderPreset("Baidu Qianfan Coding Plan")
    if (!preset) throw new Error("Baidu Qianfan Coding Plan preset missing")

    const input = buildProviderInputFromClaudePreset({
      preset,
      apiKey: "sk-qianfan",
      existingIds: new Set(),
    })

    expect(input).toEqual(expect.objectContaining({
      id: "baidu-qianfan-coding-plan",
      name: "Baidu Qianfan Coding Plan",
      category: "cn_official",
      baseUrl: "https://qianfan.baidubce.com/anthropic/coding",
      apiKeyField: "ANTHROPIC_AUTH_TOKEN",
      model: "qianfan-code-latest",
      haikuModel: "qianfan-code-latest",
      sonnetModel: "qianfan-code-latest",
      opusModel: "qianfan-code-latest",
    }))
  })

  it("maps Compshare Coding Plan from cc-switch presets", () => {
    const preset = getClaudeProviderPreset("Compshare Coding Plan")
    if (!preset) throw new Error("Compshare Coding Plan preset missing")

    const input = buildProviderInputFromClaudePreset({
      preset,
      apiKey: "sk-compshare-coding",
      existingIds: new Set(),
    })

    expect(input).toEqual(expect.objectContaining({
      id: "compshare-coding-plan",
      name: "Compshare Coding Plan",
      category: "aggregator",
      baseUrl: "https://cp.compshare.cn",
      apiKeyField: "ANTHROPIC_AUTH_TOKEN",
    }))
  })

  it("applies template values before mapping", () => {
    const preset = getClaudeProviderPreset("KAT-Coder")
    if (!preset) throw new Error("KAT-Coder preset missing")

    const input = buildProviderInputFromClaudePreset({
      preset,
      apiKey: "sk-kat",
      templateValues: { ENDPOINT_ID: "ep-123" },
      existingIds: new Set(),
    })

    expect(input.baseUrl).toBe("https://vanchin.streamlake.ai/api/gateway/v1/endpoints/ep-123/claude-code-proxy")
    expect(input.model).toBe("KAT-Coder-Pro V1")
  })

  it("stores sensitive template values as secret env values", () => {
    const preset = getClaudeProviderPreset("AWS Bedrock (AKSK)")
    if (!preset) throw new Error("AWS Bedrock (AKSK) preset missing")

    const input = buildProviderInputFromClaudePreset({
      preset,
      templateValues: {
        AWS_REGION: "us-west-2",
        AWS_ACCESS_KEY_ID: "AKIA_TEST",
        AWS_SECRET_ACCESS_KEY: "secret-access-key",
      },
      existingIds: new Set(),
    })

    expect(input.baseUrl).toBe("https://bedrock-runtime.us-west-2.amazonaws.com")
    expect(input.env).toMatchObject({
      AWS_REGION: "us-west-2",
      AWS_ACCESS_KEY_ID: "AKIA_TEST",
      CLAUDE_CODE_USE_BEDROCK: "1",
    })
    expect(input.secretEnv).toEqual({
      AWS_SECRET_ACCESS_KEY: "secret-access-key",
    })
  })

  it("generates deterministic ids and resolves conflicts", () => {
    expect(providerIdFromPresetName("AWS Bedrock (API Key)", new Set())).toBe("aws-bedrock-api-key")
    expect(providerIdFromPresetName("PackyCode", new Set(["packycode"]))).toBe("packycode-2")
    expect(providerIdFromPresetName("PackyCode", new Set(["packycode", "packycode-2"]))).toBe("packycode-3")
  })
})
