import type {
  ModelPricePreset,
  ModelPricePresetId,
  ModelPricePresetSummary,
  ModelPriceRuleInput,
} from "./types"

const OPENAI_RULES: readonly ModelPriceRuleInput[] = [
  { modelPattern: "gpt-5.5", inputPer1M: 36, outputPer1M: 216, cacheReadPer1M: 3.6, reasoningPer1M: 216 },
  { modelPattern: "gpt-5.4", inputPer1M: 18, outputPer1M: 108, cacheReadPer1M: 1.8, reasoningPer1M: 108 },
  { modelPattern: "gpt-5.3-codex", inputPer1M: 12.6, outputPer1M: 100.8, cacheReadPer1M: 1.26, reasoningPer1M: 100.8 },
  { modelPattern: "gpt-5-codex", inputPer1M: 9, outputPer1M: 72, cacheReadPer1M: 0.9, reasoningPer1M: 72 },
]

const ANTHROPIC_RULES: readonly ModelPriceRuleInput[] = [
  { modelPattern: "claude-fable-5", inputPer1M: 67.75, outputPer1M: 338.75, cacheReadPer1M: 6.775, cacheWritePer1M: 84.6875, reasoningPer1M: 338.75 },
  { modelPattern: "claude-opus-4.8", inputPer1M: 33.875, outputPer1M: 169.375, cacheReadPer1M: 3.3875, cacheWritePer1M: 42.34375, reasoningPer1M: 169.375 },
  { modelPattern: "claude-opus-4-8", inputPer1M: 33.875, outputPer1M: 169.375, cacheReadPer1M: 3.3875, cacheWritePer1M: 42.34375, reasoningPer1M: 169.375 },
  { modelPattern: "claude-opus-4.7", inputPer1M: 33.875, outputPer1M: 169.375, cacheReadPer1M: 3.3875, cacheWritePer1M: 42.34375, reasoningPer1M: 169.375 },
  { modelPattern: "claude-opus-4-7", inputPer1M: 33.875, outputPer1M: 169.375, cacheReadPer1M: 3.3875, cacheWritePer1M: 42.34375, reasoningPer1M: 169.375 },
  { modelPattern: "claude-opus-4.6", inputPer1M: 33.875, outputPer1M: 169.375, cacheReadPer1M: 3.3875, cacheWritePer1M: 42.34375, reasoningPer1M: 169.375 },
  { modelPattern: "claude-opus-4-6", inputPer1M: 33.875, outputPer1M: 169.375, cacheReadPer1M: 3.3875, cacheWritePer1M: 42.34375, reasoningPer1M: 169.375 },
  { modelPattern: "claude-opus-4.5", inputPer1M: 33.875, outputPer1M: 169.375, cacheReadPer1M: 3.3875, cacheWritePer1M: 42.34375, reasoningPer1M: 169.375 },
  { modelPattern: "claude-opus-4-5", inputPer1M: 33.875, outputPer1M: 169.375, cacheReadPer1M: 3.3875, cacheWritePer1M: 42.34375, reasoningPer1M: 169.375 },
  { modelPattern: "claude-opus-4", inputPer1M: 101.625, outputPer1M: 508.125, cacheReadPer1M: 10.1625, cacheWritePer1M: 127.03125, reasoningPer1M: 508.125 },
  { modelPattern: "claude-sonnet-4.6", inputPer1M: 20.325, outputPer1M: 101.625, cacheReadPer1M: 2.0325, cacheWritePer1M: 25.40625, reasoningPer1M: 101.625 },
  { modelPattern: "claude-sonnet-4-6", inputPer1M: 20.325, outputPer1M: 101.625, cacheReadPer1M: 2.0325, cacheWritePer1M: 25.40625, reasoningPer1M: 101.625 },
  { modelPattern: "claude-sonnet-4.5", inputPer1M: 20.325, outputPer1M: 101.625, cacheReadPer1M: 2.0325, cacheWritePer1M: 25.40625, reasoningPer1M: 101.625 },
  { modelPattern: "claude-sonnet-4-5", inputPer1M: 20.325, outputPer1M: 101.625, cacheReadPer1M: 2.0325, cacheWritePer1M: 25.40625, reasoningPer1M: 101.625 },
  { modelPattern: "claude-sonnet-4", inputPer1M: 20.325, outputPer1M: 101.625, cacheReadPer1M: 2.0325, cacheWritePer1M: 25.40625, reasoningPer1M: 101.625 },
  { modelPattern: "claude-haiku-4.5", inputPer1M: 6.775, outputPer1M: 33.875, cacheReadPer1M: 0.6775, cacheWritePer1M: 8.46875, reasoningPer1M: 33.875 },
  { modelPattern: "claude-haiku-4-5", inputPer1M: 6.775, outputPer1M: 33.875, cacheReadPer1M: 0.6775, cacheWritePer1M: 8.46875, reasoningPer1M: 33.875 },
  { modelPattern: "claude-haiku-4-5-20251001", inputPer1M: 6.775, outputPer1M: 33.875, cacheReadPer1M: 0.6775, cacheWritePer1M: 8.46875, reasoningPer1M: 33.875 },
  { modelPattern: "claude-haiku-4", inputPer1M: 6.775, outputPer1M: 33.875, cacheReadPer1M: 0.6775, cacheWritePer1M: 8.46875, reasoningPer1M: 33.875 },
]

const DEEPSEEK_OFFICIAL_RULES: readonly ModelPriceRuleInput[] = [
  { modelPattern: "deepseek-v4-flash", inputPer1M: 1, outputPer1M: 2, cacheReadPer1M: 0.02, reasoningPer1M: 2 },
  { modelPattern: "deepseek-v4-pro", inputPer1M: 3, outputPer1M: 6, cacheReadPer1M: 0.025, reasoningPer1M: 6 },
]

function withAliyunExplicitContextCache(rule: ModelPriceRuleInput): ModelPriceRuleInput {
  const inputPrice = rule.inputPer1M ?? 0
  return {
    ...rule,
    cacheReadPer1M: Number((inputPrice * 0.1).toFixed(6)),
    cacheWritePer1M: Number((inputPrice * 1.25).toFixed(6)),
  }
}

function withAliyunImplicitContextCache(rule: ModelPriceRuleInput, ratio = 0.2): ModelPriceRuleInput {
  const inputPrice = rule.inputPer1M ?? 0
  return {
    ...rule,
    cacheReadPer1M: Number((inputPrice * ratio).toFixed(6)),
  }
}

// China mainland / 华北 2（北京） prices. Tiered models use the highest listed text-generation tier.
const ALIYUN_BAILIAN_RULES: readonly ModelPriceRuleInput[] = [
  withAliyunExplicitContextCache({ modelPattern: "qwen3.7-max", inputPer1M: 12, outputPer1M: 36, reasoningPer1M: 36 }),
  withAliyunExplicitContextCache({ modelPattern: "qwen3.7-max-2026-06-08", inputPer1M: 12, outputPer1M: 36, reasoningPer1M: 36 }),
  withAliyunExplicitContextCache({ modelPattern: "qwen3.7-max-2026-05-20", inputPer1M: 12, outputPer1M: 36, reasoningPer1M: 36 }),
  { modelPattern: "qwen3.7-max-preview", inputPer1M: 12, outputPer1M: 36, reasoningPer1M: 36 },
  { modelPattern: "qwen3.7-max-2026-05-17", inputPer1M: 12, outputPer1M: 36, reasoningPer1M: 36 },
  withAliyunExplicitContextCache({ modelPattern: "qwen3.6-max-preview", inputPer1M: 15, outputPer1M: 90, reasoningPer1M: 90 }),
  withAliyunExplicitContextCache({ modelPattern: "qwen3-max", inputPer1M: 7, outputPer1M: 28, reasoningPer1M: 28 }),
  { modelPattern: "qwen3-max-2026-01-23", inputPer1M: 7, outputPer1M: 28, reasoningPer1M: 28 },
  withAliyunImplicitContextCache({ modelPattern: "qwen-max", inputPer1M: 2.4, outputPer1M: 9.6, reasoningPer1M: 9.6 }),
  { modelPattern: "qwen3-max-2025-09-23", inputPer1M: 15, outputPer1M: 60, reasoningPer1M: 60 },
  withAliyunImplicitContextCache({ modelPattern: "qwen3-max-preview", inputPer1M: 15, outputPer1M: 60, reasoningPer1M: 60 }),
  withAliyunExplicitContextCache({ modelPattern: "qwen3.7-plus", inputPer1M: 6, outputPer1M: 24, reasoningPer1M: 24 }),
  withAliyunExplicitContextCache({ modelPattern: "qwen3.7-plus-2026-05-26", inputPer1M: 6, outputPer1M: 24, reasoningPer1M: 24 }),
  withAliyunExplicitContextCache({ modelPattern: "qwen3.6-plus", inputPer1M: 8, outputPer1M: 48, reasoningPer1M: 48 }),
  { modelPattern: "qwen3.6-plus-2026-04-02", inputPer1M: 8, outputPer1M: 48, reasoningPer1M: 48 },
  withAliyunExplicitContextCache({ modelPattern: "qwen3.5-plus", inputPer1M: 4, outputPer1M: 24, reasoningPer1M: 24 }),
  withAliyunExplicitContextCache({ modelPattern: "qwen3.5-plus-2026-04-20", inputPer1M: 4, outputPer1M: 24, reasoningPer1M: 24 }),
  { modelPattern: "qwen3.5-plus-2026-02-15", inputPer1M: 4, outputPer1M: 24, reasoningPer1M: 24 },
  withAliyunExplicitContextCache({ modelPattern: "qwen-plus", inputPer1M: 4.8, outputPer1M: 48, reasoningPer1M: 64 }),
  { modelPattern: "qwen-plus-latest", inputPer1M: 4.8, outputPer1M: 48, reasoningPer1M: 64 },
  { modelPattern: "qwen-plus-2025-12-01", inputPer1M: 4.8, outputPer1M: 48, reasoningPer1M: 64 },
  { modelPattern: "qwen-plus-2025-09-11", inputPer1M: 4.8, outputPer1M: 48, reasoningPer1M: 64 },
  { modelPattern: "qwen-plus-2025-07-28", inputPer1M: 4.8, outputPer1M: 48, reasoningPer1M: 64 },
  { modelPattern: "qwen-plus-2025-07-14", inputPer1M: 0.8, outputPer1M: 2, reasoningPer1M: 8 },
  { modelPattern: "qwen-plus-2025-04-28", inputPer1M: 0.8, outputPer1M: 2, reasoningPer1M: 8 },
  { modelPattern: "qwen-plus-2025-01-25", inputPer1M: 0.8, outputPer1M: 2, reasoningPer1M: 2 },
  { modelPattern: "qwen-plus-2025-01-12", inputPer1M: 0.8, outputPer1M: 2, reasoningPer1M: 2 },
  { modelPattern: "qwen-plus-2024-12-20", inputPer1M: 0.8, outputPer1M: 2, reasoningPer1M: 2 },
  withAliyunExplicitContextCache({ modelPattern: "qwen3.6-flash", inputPer1M: 4.8, outputPer1M: 28.8, reasoningPer1M: 28.8 }),
  { modelPattern: "qwen3.6-flash-2026-04-16", inputPer1M: 4.8, outputPer1M: 28.8, reasoningPer1M: 28.8 },
  withAliyunExplicitContextCache({ modelPattern: "qwen3.5-flash", inputPer1M: 1.2, outputPer1M: 12, reasoningPer1M: 12 }),
  { modelPattern: "qwen3.5-flash-2026-02-23", inputPer1M: 1.2, outputPer1M: 12, reasoningPer1M: 12 },
  withAliyunExplicitContextCache({ modelPattern: "qwen-flash", inputPer1M: 1.2, outputPer1M: 12, reasoningPer1M: 12 }),
  { modelPattern: "qwen-flash-2025-07-28", inputPer1M: 1.2, outputPer1M: 12, reasoningPer1M: 12 },
  withAliyunImplicitContextCache({ modelPattern: "qwen-turbo", inputPer1M: 0.3, outputPer1M: 0.6, reasoningPer1M: 3 }),
  { modelPattern: "qwq-plus", inputPer1M: 1.6, outputPer1M: 4, reasoningPer1M: 4 },
  { modelPattern: "qwen-long", inputPer1M: 0.5, outputPer1M: 2, reasoningPer1M: 2 },
  { modelPattern: "qwen-long-latest", inputPer1M: 0.5, outputPer1M: 2, reasoningPer1M: 2 },
  { modelPattern: "qwen-long-2025-01-25", inputPer1M: 0.5, outputPer1M: 2, reasoningPer1M: 2 },
  withAliyunExplicitContextCache({ modelPattern: "qwen3-coder-plus", inputPer1M: 20, outputPer1M: 200, reasoningPer1M: 200 }),
  { modelPattern: "qwen3-coder-plus-2025-09-23", inputPer1M: 20, outputPer1M: 200, reasoningPer1M: 200 },
  { modelPattern: "qwen3-coder-plus-2025-07-22", inputPer1M: 20, outputPer1M: 200, reasoningPer1M: 200 },
  withAliyunExplicitContextCache({ modelPattern: "qwen3-coder-flash", inputPer1M: 5, outputPer1M: 25, reasoningPer1M: 25 }),
  { modelPattern: "qwen3-coder-flash-2025-07-28", inputPer1M: 5, outputPer1M: 25, reasoningPer1M: 25 },
  { modelPattern: "qwen3-coder-next", inputPer1M: 2.5, outputPer1M: 10, reasoningPer1M: 10 },
  { modelPattern: "qwen3-coder-480b-a35b-instruct", inputPer1M: 15, outputPer1M: 60, reasoningPer1M: 60 },
  { modelPattern: "qwen3-coder-30b-a3b-instruct", inputPer1M: 3.75, outputPer1M: 15, reasoningPer1M: 15 },
  { modelPattern: "qwen-coder-plus", inputPer1M: 3.5, outputPer1M: 7, reasoningPer1M: 7 },
  { modelPattern: "qwen-coder-turbo", inputPer1M: 2, outputPer1M: 6, reasoningPer1M: 6 },
  { modelPattern: "deepseek-v4-pro", inputPer1M: 12, outputPer1M: 24, cacheReadPer1M: 1, reasoningPer1M: 24 },
  { modelPattern: "deepseek-v4-flash", inputPer1M: 1, outputPer1M: 2, cacheReadPer1M: 0.2, reasoningPer1M: 2 },
  withAliyunExplicitContextCache({ modelPattern: "deepseek-v3.2", inputPer1M: 2, outputPer1M: 3, reasoningPer1M: 3 }),
  { modelPattern: "deepseek-v3.2-exp", inputPer1M: 2, outputPer1M: 3, reasoningPer1M: 3 },
  { modelPattern: "deepseek-v3.1", inputPer1M: 4, outputPer1M: 12, cacheReadPer1M: 0.8, reasoningPer1M: 12 },
  { modelPattern: "deepseek-r1", inputPer1M: 4, outputPer1M: 16, cacheReadPer1M: 0.8, reasoningPer1M: 16 },
  { modelPattern: "deepseek-r1-0528", inputPer1M: 4, outputPer1M: 16, reasoningPer1M: 16 },
  { modelPattern: "deepseek-v3", inputPer1M: 2, outputPer1M: 8, cacheReadPer1M: 0.4, reasoningPer1M: 8 },
  { modelPattern: "deepseek-r1-distill-qwen-1.5b", inputPer1M: 0, outputPer1M: 0, reasoningPer1M: 0 },
  { modelPattern: "deepseek-r1-distill-qwen-7b", inputPer1M: 0.5, outputPer1M: 1, reasoningPer1M: 1 },
  { modelPattern: "deepseek-r1-distill-qwen-14b", inputPer1M: 1, outputPer1M: 3, reasoningPer1M: 3 },
  { modelPattern: "deepseek-r1-distill-qwen-32b", inputPer1M: 2, outputPer1M: 6, reasoningPer1M: 6 },
  { modelPattern: "deepseek-r1-distill-llama-8b", inputPer1M: 0, outputPer1M: 0, reasoningPer1M: 0 },
  { modelPattern: "deepseek-r1-distill-llama-70b", inputPer1M: 0, outputPer1M: 0, reasoningPer1M: 0 },
  { modelPattern: "siliconflow/deepseek-v3.2", inputPer1M: 2, outputPer1M: 3, reasoningPer1M: 3 },
  { modelPattern: "siliconflow/deepseek-v3.1-terminus", inputPer1M: 4, outputPer1M: 12, reasoningPer1M: 12 },
  { modelPattern: "siliconflow/deepseek-r1-0528", inputPer1M: 4, outputPer1M: 16, reasoningPer1M: 16 },
  { modelPattern: "siliconflow/deepseek-v3-0324", inputPer1M: 2, outputPer1M: 8, reasoningPer1M: 8 },
  { modelPattern: "vanchin/deepseek-v3.2-think", inputPer1M: 2, outputPer1M: 3, cacheReadPer1M: 0.2, reasoningPer1M: 3 },
  { modelPattern: "vanchin/deepseek-v3.1-terminus", inputPer1M: 4, outputPer1M: 12, cacheReadPer1M: 1.6, reasoningPer1M: 12 },
  { modelPattern: "vanchin/deepseek-r1", inputPer1M: 4, outputPer1M: 16, cacheReadPer1M: 1.6, reasoningPer1M: 16 },
  { modelPattern: "vanchin/deepseek-v3", inputPer1M: 2, outputPer1M: 8, cacheReadPer1M: 0.8, reasoningPer1M: 8 },
  { modelPattern: "kimi-k2.6", inputPer1M: 6.5, outputPer1M: 27, cacheReadPer1M: 0.65, cacheWritePer1M: 8.125, reasoningPer1M: 27 },
  { modelPattern: "kimi-k2.5", inputPer1M: 4, outputPer1M: 21, cacheReadPer1M: 0.4, cacheWritePer1M: 5, reasoningPer1M: 21 },
  { modelPattern: "kimi-k2-thinking", inputPer1M: 4, outputPer1M: 16, cacheReadPer1M: 0.8, reasoningPer1M: 16 },
  { modelPattern: "Moonshot-Kimi-K2-Instruct", inputPer1M: 4, outputPer1M: 16, cacheReadPer1M: 0.8, reasoningPer1M: 16 },
  { modelPattern: "kimi/kimi-k2.6", inputPer1M: 6.5, outputPer1M: 27, cacheReadPer1M: 1.1, reasoningPer1M: 27 },
  { modelPattern: "kimi/kimi-k2.5", inputPer1M: 4, outputPer1M: 21, cacheReadPer1M: 0.7, reasoningPer1M: 21 },
  { modelPattern: "glm-5.1", inputPer1M: 8, outputPer1M: 28, cacheReadPer1M: 0.8, cacheWritePer1M: 10, reasoningPer1M: 28 },
  { modelPattern: "glm-5", inputPer1M: 6, outputPer1M: 22, cacheReadPer1M: 1.2, reasoningPer1M: 22 },
  { modelPattern: "glm-4.7", inputPer1M: 4, outputPer1M: 16, cacheReadPer1M: 0.8, reasoningPer1M: 16 },
  { modelPattern: "glm-4.6", inputPer1M: 4, outputPer1M: 16, cacheReadPer1M: 0.8, reasoningPer1M: 16 },
  { modelPattern: "glm-4.5", inputPer1M: 4, outputPer1M: 16, reasoningPer1M: 16 },
  { modelPattern: "glm-4.5-air", inputPer1M: 1.2, outputPer1M: 8, reasoningPer1M: 8 },
  { modelPattern: "ZHIPU/GLM-5.1", inputPer1M: 8, outputPer1M: 28, cacheReadPer1M: 2, reasoningPer1M: 28 },
  { modelPattern: "ZHIPU/GLM-5", inputPer1M: 6, outputPer1M: 22, cacheReadPer1M: 1.5, reasoningPer1M: 22 },
  { modelPattern: "MiniMax-M2.5", inputPer1M: 2.1, outputPer1M: 8.4, cacheReadPer1M: 0.42, reasoningPer1M: 8.4 },
  { modelPattern: "MiniMax-M2.1", inputPer1M: 2.1, outputPer1M: 8.4, cacheReadPer1M: 0.42, reasoningPer1M: 8.4 },
  { modelPattern: "MiniMax/MiniMax-M3", inputPer1M: 4.2, outputPer1M: 16.8, cacheReadPer1M: 0.84, reasoningPer1M: 16.8 },
  { modelPattern: "MiniMax/MiniMax-M2.7", inputPer1M: 2.1, outputPer1M: 8.4, cacheReadPer1M: 0.42, reasoningPer1M: 8.4 },
  { modelPattern: "MiniMax/MiniMax-M2.5", inputPer1M: 2.1, outputPer1M: 8.4, cacheReadPer1M: 0.21, reasoningPer1M: 8.4 },
  { modelPattern: "MiniMax/MiniMax-M2.1", inputPer1M: 2.1, outputPer1M: 8.4, cacheReadPer1M: 0.21, reasoningPer1M: 8.4 },
  withAliyunImplicitContextCache({ modelPattern: "xiaomi/mimo-v2.5-pro", inputPer1M: 14, outputPer1M: 42, reasoningPer1M: 42 }),
  withAliyunImplicitContextCache({ modelPattern: "stepfun/step-3.7-flash", inputPer1M: 1.35, outputPer1M: 8.1, reasoningPer1M: 8.1 }),
]

const OTHER_RULES: readonly ModelPriceRuleInput[] = [
  { modelPattern: "kimi-k2.5", inputPer1M: 4.32, outputPer1M: 21.6, cacheReadPer1M: 0.72, reasoningPer1M: 21.6 },
  { modelPattern: "kimi-k2.6", inputPer1M: 6.84, outputPer1M: 28.8, cacheReadPer1M: 1.152, reasoningPer1M: 28.8 },
  { modelPattern: "glm-5.1", inputPer1M: 8, outputPer1M: 28, cacheReadPer1M: 8, reasoningPer1M: 28 },
  { modelPattern: "MiniMax-M2.5", inputPer1M: 2.16, outputPer1M: 8.64, cacheReadPer1M: 0.216, cacheWritePer1M: 2.7, reasoningPer1M: 8.64 },
]

export const MODEL_PRICE_PRESETS: readonly ModelPricePreset[] = [
  { id: "openai", label: "OpenAI", rules: OPENAI_RULES },
  { id: "anthropic", label: "Anthropic", rules: ANTHROPIC_RULES },
  { id: "deepseek-official", label: "DeepSeek 官方", rules: DEEPSEEK_OFFICIAL_RULES },
  { id: "aliyun-bailian", label: "阿里云百炼", rules: ALIYUN_BAILIAN_RULES },
  { id: "other", label: "其他", rules: OTHER_RULES },
]

export function isModelPricePresetId(value: unknown): value is ModelPricePresetId {
  return typeof value === "string" && MODEL_PRICE_PRESETS.some((preset) => preset.id === value)
}

export function getModelPricePreset(presetId: ModelPricePresetId): ModelPricePreset | undefined {
  return MODEL_PRICE_PRESETS.find((preset) => preset.id === presetId)
}

export function listModelPricePresetSummaries(): ModelPricePresetSummary[] {
  return MODEL_PRICE_PRESETS.map((preset) => ({
    id: preset.id,
    label: preset.label,
    ruleCount: preset.rules.length,
  }))
}
