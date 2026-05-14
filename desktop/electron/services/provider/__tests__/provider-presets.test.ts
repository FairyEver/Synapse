import { describe, expect, it } from "vitest"

import {
  getClaudeProviderPreset,
  isClaudeProviderPresetSupported,
  listClaudeProviderPresets,
} from "../claude-provider-presets"

describe("Claude provider presets", () => {
  it("lists supported copied Claude presets without OAuth or proxy-conversion presets", () => {
    const presets = listClaudeProviderPresets()
    const names = presets.map((preset) => preset.name)

    expect(names).toContain("Claude Official")
    expect(names).toContain("Baidu Qianfan Coding Plan")
    expect(names).toContain("Compshare Coding Plan")
    expect(names).toContain("DeepSeek")
    expect(names).toContain("PackyCode")
    expect(names).toContain("AWS Bedrock (AKSK)")
    expect(names).not.toContain("GitHub Copilot")
    expect(names).not.toContain("Codex")
    expect(names).not.toContain("Gemini Native")
    expect(names).not.toContain("Nvidia")
  })

  it("keeps useful source metadata for supported presets", () => {
    const preset = getClaudeProviderPreset("KAT-Coder")

    expect(preset).toEqual(expect.objectContaining({
      name: "KAT-Coder",
      websiteUrl: "https://console.streamlake.ai",
      apiKeyUrl: "https://console.streamlake.ai/console/api-key",
      category: "cn_official",
    }))
    expect(preset?.templateValues?.ENDPOINT_ID).toEqual(expect.objectContaining({
      label: "Vanchin Endpoint ID",
    }))
  })

  it("reports unsupported presets explicitly", () => {
    expect(isClaudeProviderPresetSupported({
      name: "GitHub Copilot",
      websiteUrl: "https://github.com/features/copilot",
      settingsConfig: { env: {} },
      category: "third_party",
      providerType: "github_copilot",
      requiresOAuth: true,
    })).toBe(false)
    expect(isClaudeProviderPresetSupported({
      name: "Nvidia",
      websiteUrl: "https://build.nvidia.com",
      settingsConfig: { env: {} },
      category: "aggregator",
      apiFormat: "openai_chat",
    })).toBe(false)
    expect(isClaudeProviderPresetSupported({
      name: "PackyCode",
      websiteUrl: "https://www.packyapi.com",
      settingsConfig: { env: { ANTHROPIC_BASE_URL: "https://www.packyapi.com" } },
      category: "third_party",
    })).toBe(true)
  })
})
