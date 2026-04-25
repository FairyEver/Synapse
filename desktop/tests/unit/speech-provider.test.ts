import { describe, expect, it } from "vitest"
import {
  audioNeedsConversion,
  createSpeechProviderPlan,
  createTtsProviderPlan,
  shouldSynthesizeTts,
} from "../../electron/services/speech-provider-service"

describe("speech provider service", () => {
  it("maps CC speech defaults and keeps API keys in secret drafts", () => {
    const plan = createSpeechProviderPlan({
      enabled: true,
      provider: "gemini",
      apiKey: "gemini-secret",
      language: "zh",
    })

    expect(plan).toMatchObject({
      enabled: true,
      provider: "gemini",
      model: "gemini-flash-latest",
      baseUrl: "https://generativelanguage.googleapis.com/v1beta",
      language: "zh",
      apiKeySecretRef: "speech:gemini:api-key",
      requiresAudioConversion: true,
      issues: [],
    })
    expect(plan.secrets).toEqual([{
      id: "speech:gemini:api-key",
      description: "speech gemini api_key",
      value: "gemini-secret",
    }])
    expect(JSON.stringify({ ...plan, secrets: [] })).not.toContain("gemini-secret")
    expect(audioNeedsConversion("silk")).toBe(true)
    expect(audioNeedsConversion("wav")).toBe(false)
  })

  it("requires remote TTS secrets while allowing local provider defaults", () => {
    expect(createTtsProviderPlan({ enabled: true, provider: "qwen" })).toMatchObject({
      enabled: false,
      provider: "qwen",
      model: "qwen3-tts-flash",
      voice: "Cherry",
      issues: ["tts.qwen.api_key is required"],
    })

    expect(createTtsProviderPlan({ enabled: true, provider: "edge" })).toMatchObject({
      enabled: true,
      provider: "edge",
      model: null,
      voice: "zh-CN-XiaoxiaoNeural",
      issues: [],
    })
  })

  it("uses voice_only fallback and max_text_len skip rules", () => {
    const plan = createTtsProviderPlan({
      enabled: true,
      provider: "openai",
      apiKey: "openai-secret",
      ttsMode: "bad",
      maxTextLen: 5,
    })

    expect(plan.ttsMode).toBe("voice_only")
    expect(plan.warnings).toEqual(['invalid tts_mode "bad", using voice_only'])
    expect(shouldSynthesizeTts(plan, "hello", false)).toEqual({
      shouldSynthesize: false,
      reason: "voice_only",
    })
    expect(shouldSynthesizeTts(plan, "你好世界！！", true)).toEqual({
      shouldSynthesize: false,
      reason: "max_text_len",
    })
    expect(shouldSynthesizeTts(plan, "你好", true)).toEqual({
      shouldSynthesize: true,
      reason: "enabled",
    })
  })
})
