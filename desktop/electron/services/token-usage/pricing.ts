interface ModelPricing {
  pattern: RegExp
  inputPer1M: number
  outputPer1M: number
  cacheReadPer1M?: number
  cacheWritePer1M?: number
}

const PRICING_TABLE: ModelPricing[] = [
  // Anthropic (opus 4.5+ repriced to $5/$25 in late 2025)
  { pattern: /claude-opus-4-[5-9]|claude-opus-4\.[5-9]/i, inputPer1M: 5, outputPer1M: 25, cacheReadPer1M: 0.5, cacheWritePer1M: 6.25 },
  { pattern: /claude-opus-4/i, inputPer1M: 15, outputPer1M: 75, cacheReadPer1M: 1.5, cacheWritePer1M: 18.75 },
  { pattern: /claude-sonnet-4/i, inputPer1M: 3, outputPer1M: 15, cacheReadPer1M: 0.3, cacheWritePer1M: 3.75 },
  { pattern: /claude-haiku-4/i, inputPer1M: 1, outputPer1M: 5, cacheReadPer1M: 0.1, cacheWritePer1M: 1.25 },
  { pattern: /claude-3[._-]?5-sonnet/i, inputPer1M: 3, outputPer1M: 15, cacheReadPer1M: 0.3, cacheWritePer1M: 3.75 },
  { pattern: /claude-3[._-]?5-haiku/i, inputPer1M: 0.8, outputPer1M: 4, cacheReadPer1M: 0.08, cacheWritePer1M: 1 },
  { pattern: /claude-3-opus/i, inputPer1M: 15, outputPer1M: 75, cacheReadPer1M: 1.5, cacheWritePer1M: 18.75 },
  { pattern: /claude-3-haiku/i, inputPer1M: 0.25, outputPer1M: 1.25, cacheReadPer1M: 0.03, cacheWritePer1M: 0.3 },
  { pattern: /claude/i, inputPer1M: 3, outputPer1M: 15 },

  // OpenAI
  { pattern: /gpt-5\.?5/i, inputPer1M: 5, outputPer1M: 30, cacheReadPer1M: 0.5 },
  { pattern: /gpt-5\.?4/i, inputPer1M: 2.5, outputPer1M: 15, cacheReadPer1M: 0.25 },
  { pattern: /gpt-5\.?[23]/i, inputPer1M: 1.75, outputPer1M: 14, cacheReadPer1M: 0.175 },
  { pattern: /gpt-5/i, inputPer1M: 1.25, outputPer1M: 10, cacheReadPer1M: 0.125 },
  { pattern: /o4-mini/i, inputPer1M: 1.1, outputPer1M: 4.4, cacheReadPer1M: 0.275 },
  { pattern: /o3-mini/i, inputPer1M: 1.1, outputPer1M: 4.4, cacheReadPer1M: 0.55 },
  { pattern: /o3-pro/i, inputPer1M: 20, outputPer1M: 80 },
  { pattern: /o3(?!-)/i, inputPer1M: 2, outputPer1M: 8, cacheReadPer1M: 0.5 },
  { pattern: /o1-mini/i, inputPer1M: 1.1, outputPer1M: 4.4, cacheReadPer1M: 0.275 },
  { pattern: /o1(?!-)/i, inputPer1M: 15, outputPer1M: 60, cacheReadPer1M: 7.5 },
  { pattern: /gpt-4\.?1-mini/i, inputPer1M: 0.4, outputPer1M: 1.6, cacheReadPer1M: 0.1 },
  { pattern: /gpt-4\.?1-nano/i, inputPer1M: 0.1, outputPer1M: 0.4, cacheReadPer1M: 0.025 },
  { pattern: /gpt-4\.?1/i, inputPer1M: 2, outputPer1M: 8, cacheReadPer1M: 0.5 },
  { pattern: /gpt-4o-mini/i, inputPer1M: 0.15, outputPer1M: 0.6, cacheReadPer1M: 0.075 },
  { pattern: /gpt-4o/i, inputPer1M: 2.5, outputPer1M: 10, cacheReadPer1M: 1.25 },
  { pattern: /gpt-4-turbo/i, inputPer1M: 10, outputPer1M: 30 },
  { pattern: /gpt-4/i, inputPer1M: 30, outputPer1M: 60 },

  // Google
  { pattern: /gemini-2\.?5-pro/i, inputPer1M: 1.25, outputPer1M: 10, cacheReadPer1M: 0.315 },
  { pattern: /gemini-2\.?5-flash/i, inputPer1M: 0.15, outputPer1M: 0.6, cacheReadPer1M: 0.0375 },
  { pattern: /gemini-2\.?0-flash/i, inputPer1M: 0.1, outputPer1M: 0.4, cacheReadPer1M: 0.025 },
  { pattern: /gemini-1\.?5-pro/i, inputPer1M: 1.25, outputPer1M: 5, cacheReadPer1M: 0.315 },
  { pattern: /gemini-1\.?5-flash/i, inputPer1M: 0.075, outputPer1M: 0.3, cacheReadPer1M: 0.01875 },
  { pattern: /gemini/i, inputPer1M: 0.15, outputPer1M: 0.6 },

  // DeepSeek
  { pattern: /deepseek-r1/i, inputPer1M: 0.55, outputPer1M: 2.19, cacheReadPer1M: 0.14 },
  { pattern: /deepseek-v3/i, inputPer1M: 0.27, outputPer1M: 1.1, cacheReadPer1M: 0.07 },
  { pattern: /deepseek/i, inputPer1M: 0.27, outputPer1M: 1.1 },

  // xAI
  { pattern: /grok-3/i, inputPer1M: 3, outputPer1M: 15 },
  { pattern: /grok/i, inputPer1M: 3, outputPer1M: 15 },

  // Moonshot
  { pattern: /kimi-k2\.?5/i, inputPer1M: 0.6, outputPer1M: 3, cacheReadPer1M: 0.1 },
  { pattern: /kimi-k2/i, inputPer1M: 0.57, outputPer1M: 2.3 },
  { pattern: /kimi/i, inputPer1M: 0.57, outputPer1M: 2.3 },
]

export function estimateCost(
  modelId: string,
  tokens: { input: number; output: number; cacheRead: number; cacheWrite: number },
): number {
  const pricing = PRICING_TABLE.find((p) => p.pattern.test(modelId))
  if (!pricing) return 0

  const inputCost = (tokens.input / 1_000_000) * pricing.inputPer1M
  const outputCost = (tokens.output / 1_000_000) * pricing.outputPer1M
  const cacheReadCost = (tokens.cacheRead / 1_000_000) * (pricing.cacheReadPer1M ?? pricing.inputPer1M * 0.1)
  const cacheWriteCost = (tokens.cacheWrite / 1_000_000) * (pricing.cacheWritePer1M ?? pricing.inputPer1M * 1.25)

  return inputCost + outputCost + cacheReadCost + cacheWriteCost
}
