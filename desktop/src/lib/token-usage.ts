export interface TokenUsageField {
  readonly label: string
  readonly value?: number
}

export interface ClaudeSdkUsageSummary {
  readonly inputTokens: number
  readonly outputTokens: number
  readonly cacheReadInputTokens: number
  readonly cacheCreationInputTokens: number
  readonly reasoningOutputTokens?: number
  readonly totalTokens: number
}

type ClaudeSdkUsageSummaryInput = Omit<ClaudeSdkUsageSummary, "totalTokens">

export interface TokenUsageFieldsOptions {
  readonly prefix?: string
}

const TOKEN_USAGE_DEFINITIONS: readonly {
  readonly label: string
  readonly keys: readonly string[]
  readonly optional?: boolean
}[] = [
  { label: "输入", keys: ["input_tokens", "inputTokens"] },
  { label: "输出", keys: ["output_tokens", "outputTokens"] },
  { label: "缓存读", keys: ["cache_read_input_tokens", "cacheReadInputTokens", "cacheRead"] },
  { label: "缓存写", keys: ["cache_creation_input_tokens", "cacheCreationInputTokens", "cacheWrite"] },
  { label: "思考", keys: ["reasoning_output_tokens", "reasoningOutputTokens", "reasoning_tokens", "reasoningTokens"], optional: true },
]

const tokenNumberFormatter = new Intl.NumberFormat("en-US", {
  maximumFractionDigits: 0,
})

export function tokenUsageFields(
  usage: Record<string, unknown> | undefined,
  options: TokenUsageFieldsOptions = {},
): readonly TokenUsageField[] | undefined {
  if (!usage) return undefined
  const fields = TOKEN_USAGE_DEFINITIONS.map((definition) => ({
    label: definition.label,
    value: tokenNumber(usage, definition.keys),
    optional: definition.optional,
  }))
  if (!fields.some((field) => field.value !== undefined)) return undefined
  const usageFields = fields.flatMap((field) => {
    if (field.optional && field.value === undefined) return []
    return [{ label: field.label, value: field.value ?? 0 }]
  })
  if (!options.prefix) return usageFields
  return [{ label: options.prefix }, ...usageFields]
}

export function normalizeClaudeSdkUsage(
  usage: Record<string, unknown> | undefined,
): ClaudeSdkUsageSummary | undefined {
  if (!usage) return undefined
  const inputTokens = tokenNumber(usage, ["input_tokens", "inputTokens"])
  const outputTokens = tokenNumber(usage, ["output_tokens", "outputTokens"])
  const cacheReadInputTokens = tokenNumber(usage, ["cache_read_input_tokens", "cacheReadInputTokens", "cacheRead"])
  const cacheCreationInputTokens = tokenNumber(usage, ["cache_creation_input_tokens", "cacheCreationInputTokens", "cacheWrite"])
  const reasoningOutputTokens = tokenNumber(usage, [
    "reasoning_output_tokens",
    "reasoningOutputTokens",
    "reasoning_tokens",
    "reasoningTokens",
  ])
  if (
    inputTokens === undefined
    && outputTokens === undefined
    && cacheReadInputTokens === undefined
    && cacheCreationInputTokens === undefined
    && reasoningOutputTokens === undefined
  ) {
    return undefined
  }
  return usageSummary({
    inputTokens: inputTokens ?? 0,
    outputTokens: outputTokens ?? 0,
    cacheReadInputTokens: cacheReadInputTokens ?? 0,
    cacheCreationInputTokens: cacheCreationInputTokens ?? 0,
    ...(reasoningOutputTokens !== undefined ? { reasoningOutputTokens } : {}),
  })
}

export function sumClaudeSdkUsage(
  usages: readonly (Record<string, unknown> | undefined)[],
): ClaudeSdkUsageSummary | undefined {
  return sumClaudeSdkUsageSummaries(usages.flatMap((usage) => {
    const summary = normalizeClaudeSdkUsage(usage)
    return summary ? [summary] : []
  }))
}

export function sumClaudeSdkUsageSummaries(
  summaries: readonly ClaudeSdkUsageSummary[],
): ClaudeSdkUsageSummary | undefined {
  if (summaries.length === 0) return undefined
  const emptySummary: ClaudeSdkUsageSummaryInput = {
    inputTokens: 0,
    outputTokens: 0,
    cacheReadInputTokens: 0,
    cacheCreationInputTokens: 0,
  }
  return usageSummary(summaries.reduce<ClaudeSdkUsageSummaryInput>((total, summary) => ({
    inputTokens: total.inputTokens + summary.inputTokens,
    outputTokens: total.outputTokens + summary.outputTokens,
    cacheReadInputTokens: total.cacheReadInputTokens + summary.cacheReadInputTokens,
    cacheCreationInputTokens: total.cacheCreationInputTokens + summary.cacheCreationInputTokens,
    reasoningOutputTokens: sumOptionalTokens(total.reasoningOutputTokens, summary.reasoningOutputTokens),
  }), emptySummary))
}

export function formatTokenUsageValue(value: number): string {
  return tokenNumberFormatter.format(value)
}

function tokenNumber(usage: Record<string, unknown>, keys: readonly string[]): number | undefined {
  for (const key of keys) {
    const value = usage[key]
    if (typeof value === "number" && Number.isFinite(value)) return Math.max(0, value)
  }
  return undefined
}

function sumOptionalTokens(a: number | undefined, b: number | undefined): number | undefined {
  if (a === undefined && b === undefined) return undefined
  return (a ?? 0) + (b ?? 0)
}

function usageSummary(input: ClaudeSdkUsageSummaryInput): ClaudeSdkUsageSummary {
  return {
    ...input,
    totalTokens: input.inputTokens
      + input.outputTokens
      + input.cacheReadInputTokens
      + input.cacheCreationInputTokens
      + (input.reasoningOutputTokens ?? 0),
  }
}
