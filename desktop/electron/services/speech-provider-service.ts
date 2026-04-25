export type SpeechProvider = "openai" | "groq" | "qwen" | "gemini"
export type TtsProvider = "openai" | "qwen" | "minimax" | "espeak" | "pico" | "edge"
export type TtsMode = "voice_only" | "always"

export type SpeechProviderConfig = {
  enabled?: boolean
  provider?: SpeechProvider
  language?: string
  apiKey?: string
  apiKeySecretRef?: string
  baseUrl?: string
  model?: string
}

export type TtsProviderConfig = {
  enabled?: boolean
  provider?: TtsProvider
  voice?: string
  ttsMode?: string
  maxTextLen?: number
  apiKey?: string
  apiKeySecretRef?: string
  baseUrl?: string
  model?: string
}

export type ProviderSecretDraft = {
  id: string
  description: string
  value: string
}

export type SpeechProviderPlan = {
  enabled: boolean
  provider: SpeechProvider
  model: string
  baseUrl: string
  language: string | null
  apiKeySecretRef: string | null
  requiresAudioConversion: boolean
  secrets: ProviderSecretDraft[]
  issues: string[]
}

export type TtsProviderPlan = {
  enabled: boolean
  provider: TtsProvider
  model: string | null
  baseUrl: string | null
  voice: string
  ttsMode: TtsMode
  maxTextLen: number
  apiKeySecretRef: string | null
  secrets: ProviderSecretDraft[]
  issues: string[]
  warnings: string[]
}

export type TtsDecision = {
  shouldSynthesize: boolean
  reason: "disabled" | "voice_only" | "max_text_len" | "enabled"
}

const SPEECH_DEFAULTS: Record<SpeechProvider, { model: string; baseUrl: string }> = {
  openai: { model: "whisper-1", baseUrl: "https://api.openai.com/v1" },
  groq: { model: "whisper-large-v3-turbo", baseUrl: "https://api.groq.com/openai/v1" },
  qwen: { model: "qwen3-asr-flash", baseUrl: "https://dashscope.aliyuncs.com/compatible-mode/v1" },
  gemini: { model: "gemini-flash-latest", baseUrl: "https://generativelanguage.googleapis.com/v1beta" },
}

const TTS_DEFAULTS: Record<TtsProvider, { model: string | null; baseUrl: string | null; voice: string }> = {
  openai: { model: "tts-1", baseUrl: "https://api.openai.com/v1", voice: "alloy" },
  qwen: {
    model: "qwen3-tts-flash",
    baseUrl: "https://dashscope.aliyuncs.com/api/v1/services/aigc/multimodal-generation/generation",
    voice: "Cherry",
  },
  minimax: { model: "speech-2.8-hd", baseUrl: "https://api.minimax.io", voice: "English_Graceful_Lady" },
  espeak: { model: null, baseUrl: null, voice: "zh" },
  pico: { model: null, baseUrl: null, voice: "zh-CN" },
  edge: { model: null, baseUrl: null, voice: "zh-CN-XiaoxiaoNeural" },
}

const DIRECT_STT_FORMATS = new Set(["mp3", "mp4", "mpeg", "mpga", "m4a", "wav", "webm"])
const REMOTE_TTS_PROVIDERS = new Set<TtsProvider>(["openai", "qwen", "minimax"])

function trimString(value: string | undefined): string | undefined {
  const trimmed = value?.trim()
  return trimmed ? trimmed : undefined
}

function secretRefFor(kind: "speech" | "tts", provider: string): string {
  return `${kind}:${provider}:api-key`
}

function normalizeTtsMode(value: string | undefined): { mode: TtsMode; warning: string | null } {
  if (value === "always" || value === "voice_only") {
    return { mode: value, warning: null }
  }

  if (!value) {
    return { mode: "voice_only", warning: null }
  }

  return { mode: "voice_only", warning: `invalid tts_mode ${JSON.stringify(value)}, using voice_only` }
}

function runeLength(value: string): number {
  return Array.from(value).length
}

export function audioNeedsConversion(format: string): boolean {
  return !DIRECT_STT_FORMATS.has(format.trim().toLowerCase())
}

export function createSpeechProviderPlan(config: SpeechProviderConfig): SpeechProviderPlan {
  const provider = config.provider ?? "openai"
  const defaults = SPEECH_DEFAULTS[provider]
  const apiKey = trimString(config.apiKey)
  const apiKeySecretRef = trimString(config.apiKeySecretRef) ?? (apiKey ? secretRefFor("speech", provider) : null)
  const issues: string[] = []

  if (config.enabled && !apiKeySecretRef) {
    issues.push(`speech.${provider}.api_key is required`)
  }

  return {
    enabled: config.enabled === true && issues.length === 0,
    provider,
    model: trimString(config.model) ?? defaults.model,
    baseUrl: trimString(config.baseUrl) ?? defaults.baseUrl,
    language: trimString(config.language) ?? null,
    apiKeySecretRef,
    requiresAudioConversion: true,
    secrets: apiKey ? [{ id: apiKeySecretRef ?? secretRefFor("speech", provider), description: `speech ${provider} api_key`, value: apiKey }] : [],
    issues,
  }
}

export function createTtsProviderPlan(config: TtsProviderConfig): TtsProviderPlan {
  const provider = config.provider ?? "openai"
  const defaults = TTS_DEFAULTS[provider]
  const apiKey = trimString(config.apiKey)
  const apiKeySecretRef = trimString(config.apiKeySecretRef) ?? (apiKey ? secretRefFor("tts", provider) : null)
  const mode = normalizeTtsMode(config.ttsMode)
  const issues: string[] = []

  if (config.enabled && REMOTE_TTS_PROVIDERS.has(provider) && !apiKeySecretRef) {
    issues.push(`tts.${provider}.api_key is required`)
  }

  return {
    enabled: config.enabled === true && issues.length === 0,
    provider,
    model: trimString(config.model) ?? defaults.model,
    baseUrl: trimString(config.baseUrl) ?? defaults.baseUrl,
    voice: trimString(config.voice) ?? defaults.voice,
    ttsMode: mode.mode,
    maxTextLen: typeof config.maxTextLen === "number" && config.maxTextLen > 0 ? Math.floor(config.maxTextLen) : 0,
    apiKeySecretRef,
    secrets: apiKey ? [{ id: apiKeySecretRef ?? secretRefFor("tts", provider), description: `tts ${provider} api_key`, value: apiKey }] : [],
    issues,
    warnings: mode.warning ? [mode.warning] : [],
  }
}

export function shouldSynthesizeTts(plan: TtsProviderPlan, text: string, fromVoice: boolean): TtsDecision {
  if (!plan.enabled) {
    return { shouldSynthesize: false, reason: "disabled" }
  }

  if (plan.ttsMode === "voice_only" && !fromVoice) {
    return { shouldSynthesize: false, reason: "voice_only" }
  }

  if (plan.maxTextLen > 0 && runeLength(text) > plan.maxTextLen) {
    return { shouldSynthesize: false, reason: "max_text_len" }
  }

  return { shouldSynthesize: true, reason: "enabled" }
}
