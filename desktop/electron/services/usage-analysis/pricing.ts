import type { UsageTokenBreakdown, UsageTool } from "./types"

interface PriceRule {
  readonly pattern: RegExp
  readonly inputPer1M: number
  readonly outputPer1M: number
  readonly cacheReadPer1M?: number
  readonly cacheWritePer1M?: number
}

export interface EstimatedUsageCost {
  readonly input: number
  readonly output: number
  readonly cacheRead: number
  readonly cacheWrite: number
  readonly reasoning: number
  readonly total: number
}

const OPENAI_RULES: PriceRule[] = [
  { pattern: /gpt-5\.5/i, inputPer1M: 1.25, outputPer1M: 10, cacheReadPer1M: 0.125 },
  { pattern: /gpt-5\.4/i, inputPer1M: 1.25, outputPer1M: 10, cacheReadPer1M: 0.125 },
  { pattern: /gpt-5\.3-codex|gpt-5-codex/i, inputPer1M: 1.25, outputPer1M: 10, cacheReadPer1M: 0.125 },
]

const ANTHROPIC_RULES: PriceRule[] = [
  { pattern: /claude-opus-4[\.-]6|claude-opus-4/i, inputPer1M: 15, outputPer1M: 75, cacheReadPer1M: 1.5, cacheWritePer1M: 18.75 },
  { pattern: /claude-sonnet-4/i, inputPer1M: 3, outputPer1M: 15, cacheReadPer1M: 0.3, cacheWritePer1M: 3.75 },
  { pattern: /claude-haiku-4/i, inputPer1M: 1, outputPer1M: 5, cacheReadPer1M: 0.1, cacheWritePer1M: 1.25 },
]

function findRule(tool: UsageTool, model: string): PriceRule | null {
  const rules = tool === "codex" ? OPENAI_RULES : ANTHROPIC_RULES
  return rules.find((rule) => rule.pattern.test(model)) ?? null
}

function cost(tokens: number, per1M: number | undefined): number {
  if (!per1M || tokens <= 0) return 0
  return (tokens / 1_000_000) * per1M
}

export function estimateUsageCost(tool: UsageTool, model: string, tokens: UsageTokenBreakdown): EstimatedUsageCost {
  const rule = findRule(tool, model)
  if (!rule) {
    return { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, reasoning: 0, total: 0 }
  }

  const input = cost(tokens.input, rule.inputPer1M)
  const output = cost(tokens.output, rule.outputPer1M)
  const cacheRead = cost(tokens.cacheRead, rule.cacheReadPer1M)
  const cacheWrite = cost(tokens.cacheWrite, rule.cacheWritePer1M)
  const reasoning = cost(tokens.reasoning, rule.outputPer1M)

  return {
    input,
    output,
    cacheRead,
    cacheWrite,
    reasoning,
    total: input + output + cacheRead + cacheWrite + reasoning,
  }
}
