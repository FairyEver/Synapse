import { normalizeModelPriceRules } from "./matching"
import type { ModelPriceRuleInput } from "./types"

const DEFAULT_MODEL_PRICE_RULE_INPUTS: readonly ModelPriceRuleInput[] = [
  { id: "gpt-5-5", modelPattern: "gpt-5.5", inputPer1M: 36, outputPer1M: 216, cacheReadPer1M: 3.6, reasoningPer1M: 216, source: "builtin" },
  { id: "gpt-5-4", modelPattern: "gpt-5.4", inputPer1M: 18, outputPer1M: 108, cacheReadPer1M: 1.8, reasoningPer1M: 108, source: "builtin" },
  { id: "gpt-5-3-codex", modelPattern: "gpt-5.3-codex", inputPer1M: 9, outputPer1M: 72, cacheReadPer1M: 0.9, reasoningPer1M: 72, source: "builtin" },
  { id: "gpt-5-codex", modelPattern: "gpt-5-codex", inputPer1M: 9, outputPer1M: 72, cacheReadPer1M: 0.9, reasoningPer1M: 72, source: "builtin" },
  { id: "claude-opus-4-7", modelPattern: "claude-opus-4.7", inputPer1M: 36, outputPer1M: 180, cacheReadPer1M: 3.6, cacheWritePer1M: 45, reasoningPer1M: 180, source: "builtin" },
  { id: "claude-opus-4-7-hyphen", modelPattern: "claude-opus-4-7", inputPer1M: 36, outputPer1M: 180, cacheReadPer1M: 3.6, cacheWritePer1M: 45, reasoningPer1M: 180, source: "builtin" },
  { id: "claude-opus-4-6", modelPattern: "claude-opus-4.6", inputPer1M: 36, outputPer1M: 180, cacheReadPer1M: 3.6, cacheWritePer1M: 45, reasoningPer1M: 180, source: "builtin" },
  { id: "claude-opus-4-6-hyphen", modelPattern: "claude-opus-4-6", inputPer1M: 36, outputPer1M: 180, cacheReadPer1M: 3.6, cacheWritePer1M: 45, reasoningPer1M: 180, source: "builtin" },
  { id: "claude-opus-4", modelPattern: "claude-opus-4", inputPer1M: 108, outputPer1M: 540, cacheReadPer1M: 10.8, cacheWritePer1M: 135, reasoningPer1M: 540, source: "builtin" },
  { id: "claude-sonnet-4-6", modelPattern: "claude-sonnet-4.6", inputPer1M: 21.6, outputPer1M: 108, cacheReadPer1M: 2.16, cacheWritePer1M: 27, reasoningPer1M: 108, source: "builtin" },
  { id: "claude-sonnet-4", modelPattern: "claude-sonnet-4", inputPer1M: 21.6, outputPer1M: 108, cacheReadPer1M: 2.16, cacheWritePer1M: 27, reasoningPer1M: 108, source: "builtin" },
  { id: "claude-haiku-4-5", modelPattern: "claude-haiku-4.5", inputPer1M: 7.2, outputPer1M: 36, cacheReadPer1M: 0.72, cacheWritePer1M: 9, reasoningPer1M: 36, source: "builtin" },
  { id: "claude-haiku-4", modelPattern: "claude-haiku-4", inputPer1M: 7.2, outputPer1M: 36, cacheReadPer1M: 0.72, cacheWritePer1M: 9, reasoningPer1M: 36, source: "builtin" },
  { id: "deepseek-v4-pro", modelPattern: "deepseek-v4-pro", inputPer1M: 3.132, outputPer1M: 6.264, cacheReadPer1M: 0.0261, reasoningPer1M: 6.264, source: "builtin" },
  { id: "deepseek-v4-flash", modelPattern: "deepseek-v4-flash", inputPer1M: 1.008, outputPer1M: 2.016, cacheReadPer1M: 0.02016, reasoningPer1M: 2.016, source: "builtin" },
  { id: "kimi-k2-5", modelPattern: "kimi-k2.5", inputPer1M: 4.32, outputPer1M: 21.6, cacheReadPer1M: 0.72, reasoningPer1M: 21.6, source: "builtin" },
  { id: "kimi-k2-6", modelPattern: "kimi-k2.6", inputPer1M: 6.84, outputPer1M: 28.8, cacheReadPer1M: 1.152, reasoningPer1M: 28.8, source: "builtin" },
  { id: "glm-5-1", modelPattern: "glm-5.1", inputPer1M: 8, outputPer1M: 28, cacheReadPer1M: 8, reasoningPer1M: 28, source: "builtin" },
  { id: "minimax-m2-5", modelPattern: "MiniMax-M2.5", inputPer1M: 2.16, outputPer1M: 8.64, cacheReadPer1M: 0.216, cacheWritePer1M: 2.7, reasoningPer1M: 8.64, source: "builtin" },
]

export const DEFAULT_MODEL_PRICE_RULES = normalizeModelPriceRules(DEFAULT_MODEL_PRICE_RULE_INPUTS)
